import {Command} from '@colyseus/command';
import {TriggerType} from '../../common/types';
import {DraftRoom} from '../../rooms/DraftRoom';
import {Talent} from '../../talents/schema/TalentSchema';
import {TalentBehaviorContext} from "../../talents/behavior/TalentBehaviorContext";
import {triggerEquippedItems} from '../../common/triggerUtils';
import {buildBaseAndItemsSnapshot} from '../../common/statsUtils';
import {baseLuckyFindChance, BASE_POTION_CAPACITY, BASE_REFRESH_SHOP_COST, applyRefreshCostMultiplier} from '../ShopUpgradeUtils';
import {ensurePotionEffect, ensureShieldSkill, refreshFutureItemSkill} from '../../items/skills/itemSkillRoller';
import {applyBulkDiscount} from '../../items/behavior/ItemSkillBehaviors';

export class DraftAuraTriggerCommand extends Command<DraftRoom> {
    execute() {
        const player = this.state.player;

        // Re-seed the hidden shop-roll stat from level every tick, before aura talents run,
        // so a talent that scales it (e.g. Black Market Contact) composes in the same pass.
        // The permanent Lucky Find Mythic-buy bonus (luckyFindMythicBonus) is folded in here so
        // talent multipliers compose on top of base+bonus, same as they already do for base alone.
        player.luckyFindChance = baseLuckyFindChance(player.level) + player.luckyFindMythicBonus;

        // Re-seed the reroll cost to its base every tick, before aura talents run, so talents
        // that adjust it (Comrade +income, Bargain Hunter x0.5) apply as deltas/multipliers on a
        // clean base instead of accumulating or fighting over a raw overwrite.
        player.refreshShopCost = BASE_REFRESH_SHOP_COST;
        player.refreshShopCostMultiplier = 1;
        // VIP Pass: re-seeded to 1 before aura talents run, same reasoning as
        // refreshShopCostMultiplier above — Black Market Contact contributes a multiplier here
        // instead of mutating luckyFindChance directly, so its x2 composes on top of VIP Pass's
        // flat +10% bonus regardless of which talent runs first in the loop below.
        player.luckyFindChanceMultiplier = 1;
        // Fortune's Fool: re-seeded to false before aura talents run, same reasoning as
        // refreshShopCostMultiplier above — so it can't survive dropping/replacing the talent.
        player.freeRerolls = false;
        // Item-skill draft grants (Haggler 301, Store Credit 302): re-seeded to 0/false before the
        // equipped-item aura pass, same reasoning as freeRerolls above — triggerEquippedItems only
        // visits equippedItems, so without this the last granted value latches forever once the
        // item is unequipped or sold. The skills write them back each tick while still equipped.
        player.hagglerFreeRerolls = 0;
        player.storeCreditFreeClaim = false;
        player.storeCreditFreeClaimCap = 0;
        // Bulk Discount (item skill): same reasoning — re-seeded before the equipped-item aura
        // pass so the rate can't survive dropping/selling the item.
        player.bulkDiscountPercentPerLuckPercent = 0;
        // Active-potion cap: re-seeded to base before aura talents run, same reasoning as
        // refreshShopCost above — Flash Sale (MERCHANT_1) adds to it while owned, on a clean base
        // each tick rather than accumulating.
        player.potionCapacity = BASE_POTION_CAPACITY;

        // Shields roll their skill from Common (no Legendary gate — see ensureShieldSkill), so
        // unlike class-item skills this can't ride on a rarity-upgrade event. Sweep every shield
        // the player can currently see each tick; the `!item.skillId` latch in ensureShieldSkill
        // makes repeat calls free once a shield has one. Covers freshly rolled shop items (this
        // command runs synchronously right after DraftRoom.updateShop builds the shop — see the
        // comment there) as well as inventory/equipped shields carried over from a save.
        player.equippedItems.forEach((item) => ensureShieldSkill(item, player));
        player.inventory.forEach((item) => ensureShieldSkill(item, player));
        this.state.shop.forEach((item) => ensureShieldSkill(item, player));

        // Health Flask brews (see ensurePotionEffect) — same "no rarity gate, sweep every item
        // the player can currently see" reasoning as the shield sweep above. This is what stamps
        // a freshly rolled shop flask with its brew, since DraftRoom.updateShop dispatches this
        // command synchronously right after building the shop.
        player.inventory.forEach((item) => ensurePotionEffect(item, player));
        this.state.shop.forEach((item) => ensurePotionEffect(item, player));

        // Legendary skill preview (item.futureSkill*) — same "every item the player can currently
        // see" sweep as ensureShieldSkill above, so a Common/Rare/Epic class item always shows
        // which skill it's heading toward.
        player.equippedItems.forEach((item) => refreshFutureItemSkill(item, player));
        player.inventory.forEach((item) => refreshFutureItemSkill(item, player));
        this.state.shop.forEach((item) => refreshFutureItemSkill(item, player));

        const auraTalents: Talent[] = player.talents.filter((talent) => talent.triggerTypes?.includes(TriggerType.AURA));

        const attackerSnapshot = buildBaseAndItemsSnapshot(player);

        let behaviorContext: TalentBehaviorContext = {
            client: this.state.playerClient,
            attacker: player,
            shop: this.state.shop,
            questItems: this.state.questItems,
            trigger: TriggerType.AURA,
            attackerSnapshot,
            forceFreeReroll: this.room.forceFreeReroll,
        };

        auraTalents.forEach((talent) => {
            try {
                talent.executeBehavior(behaviorContext);
            } catch (e) {
                console.error(e);
            }
        });

        triggerEquippedItems(this.state.player, behaviorContext, TriggerType.AURA);

        // Applied last (after aura talents), same order-independence reasoning as the reroll-cost
        // multiplier below — Black Market Contact's x2 always lands on VIP Pass's fully-adjusted
        // flat bonus, not a partial one.
        player.luckyFindChance *= player.luckyFindChanceMultiplier;

        // Bulk Discount's actual shop repricing — deliberately not inside the item's own AURA
        // behavior (see ItemSkillBehaviors.applyBulkDiscount's comment): it needs to read
        // luckyFindChance's FINAL value for this tick, which isn't guaranteed yet mid equipped-
        // item iteration if Insider Trading hasn't run first.
        applyBulkDiscount(player, this.state.shop);

        // Snapshot the pre-discount cost so DraftRoom.refreshShop can credit Bargain Hunter with
        // the gold actually saved by the halving below.
        player.refreshShopCostBeforeDiscount = player.refreshShopCost;
        // Applied last (after aura talents and item skills) so Bargain Hunter's halving is
        // order-independent — it always lands on the fully-adjusted cost, not a partial one.
        player.refreshShopCost = applyRefreshCostMultiplier(player.refreshShopCost, player.refreshShopCostMultiplier);
    }
}
