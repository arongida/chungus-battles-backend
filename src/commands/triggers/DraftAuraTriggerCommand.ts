import {Command} from '@colyseus/command';
import {TriggerType} from '../../common/types';
import {DraftRoom} from '../../rooms/DraftRoom';
import {Talent} from '../../talents/schema/TalentSchema';
import {TalentBehaviorContext} from "../../talents/behavior/TalentBehaviorContext";
import {triggerEquippedItems} from '../../common/triggerUtils';
import {buildBaseAndItemsSnapshot} from '../../common/statsUtils';
import {baseLuckyFindChance, BASE_REFRESH_SHOP_COST, applyRefreshCostMultiplier} from '../ShopUpgradeUtils';

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

        const auraTalents: Talent[] = player.talents.filter((talent) => talent.triggerTypes?.includes(TriggerType.AURA));

        const attackerSnapshot = buildBaseAndItemsSnapshot(player);

        let behaviorContext: TalentBehaviorContext = {
            client: this.state.playerClient,
            attacker: player,
            shop: this.state.shop,
            questItems: this.state.questItems,
            trigger: TriggerType.AURA,
            attackerSnapshot,
        };

        auraTalents.forEach((talent) => {
            try {
                talent.executeBehavior(behaviorContext);
            } catch (e) {
                console.error(e);
            }
        });

        triggerEquippedItems(this.state.player, behaviorContext, TriggerType.AURA);

        // Applied last (after aura talents and item skills) so Bargain Hunter's halving is
        // order-independent — it always lands on the fully-adjusted cost, not a partial one.
        player.refreshShopCost = applyRefreshCostMultiplier(player.refreshShopCost, player.refreshShopCostMultiplier);
    }
}
