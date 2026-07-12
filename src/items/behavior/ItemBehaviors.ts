import { ItemBehaviorContext } from './ItemBehaviorContext';
import { TriggerType } from '../../common/types';
import { EquipSlot, ItemRarity, ItemType } from '../types/ItemTypes';
import { CombatLogMessage, fmt } from '../../common/MessageTypes';
import {
    chungiHpDamageFraction,
    FLOWERING_STAFF_INVULN_COOLDOWN_MS,
    floweringStaffInvulnMs,
    rollMagicRingBonus,
    secondWindHealFraction,
    secondWindInvulnMs,
    SECOND_WIND_THRESHOLD,
    stackMagicRingBonuses,
    wandOfFireBurnStacks,
} from './uniqueItemBalance';
import { rollRandomMythicTierFiveItem } from './ringOfImmortality';
import type { Item } from '../schema/ItemSchema';

// Last invulnerability proc per staff instance (clock-elapsed ms). Keyed by
// item instance so each fight's fresh state starts clean.
const floweringStaffLastProcMs = new WeakMap<Item, number>();

// Band of Vigor (27): whether this ring instance has already procced Second Wind in the
// current fight. Keyed by item instance and cleared on FIGHT_START, same pattern as the
// Flowering Staff's proc-cooldown map above.
const secondWindUsed = new WeakMap<Item, boolean>();

export const ItemBehaviors: Record<number | string, (context: ItemBehaviorContext) => void | Promise<void>> = {
    // All shields — FIGHT_START: grant invulnerability (500 + 500*tier ms).
    [ItemType.SHIELD]: ({ attacker, trigger, clock, client, item }) => {
        // Old enemy snapshots may still carry shields with 'on-attacked'
        // triggers; in that context `attacker` is the opponent, so firing
        // would grant them the invulnerability.
        if (trigger !== TriggerType.FIGHT_START) return;
        if (!attacker || !clock) return;
        const durationMs = 500 + 500 * item.tier;
        attacker.setInvincible(clock, durationMs, client);
        const seconds = (durationMs / 1000).toFixed(1);
        client?.send('combat_log', {
            text: `${attacker.name}'s ${item.name}: ${seconds}s invulnerability!`,
            kind: 'item',
            attackerId: attacker.playerId,
            itemId: item.itemId,
        } as CombatLogMessage);
    },
    // Flowering Staff (8) — AURA: takes both hands. ON_ATTACK: brief invulnerability.
    8: ({ attacker, trigger, clock, client, item }) => {
        if (!attacker) return;
        if (trigger === TriggerType.AURA) {
            let staffSlot: EquipSlot | null = null;
            attacker.equippedItems.forEach((equippedItem, slot) => {
                if (equippedItem.itemId === 8) staffSlot = slot as EquipSlot;
            });
            if (!staffSlot) return;
            const otherSlot = staffSlot === EquipSlot.MAIN_HAND ? EquipSlot.OFF_HAND : EquipSlot.MAIN_HAND;
            const otherItem = attacker.equippedItems.get(otherSlot);
            if (otherItem) attacker.setItemUnequipped(otherItem, otherSlot);
        } else if (trigger === TriggerType.ON_ATTACK) {
            if (!clock || !item) return;
            // Internal cooldown: windows must never overlap, or stacked attack
            // speed would chain shields into permanent invulnerability.
            const lastProcMs = floweringStaffLastProcMs.get(item);
            if (lastProcMs !== undefined && clock.elapsedTime - lastProcMs < FLOWERING_STAFF_INVULN_COOLDOWN_MS) return;
            floweringStaffLastProcMs.set(item, clock.elapsedTime);
            const durationMs = floweringStaffInvulnMs(item.rarity);
            attacker.setInvincible(clock, durationMs, client);
            client?.send('combat_log', {
                text: `${attacker.name}'s ${item.name} blooms: ${(durationMs / 1000).toFixed(1)}s invulnerability!`,
                kind: 'item',
                attackerId: attacker.playerId,
                itemId: item.itemId,
            } as CombatLogMessage);
        }
    },

    // Chungi (7) — AURA: max damage scales with the wielder's max HP.
    7: ({ attacker, trigger, item }) => {
        if (trigger !== TriggerType.AURA || !attacker || !item) return;
        item.baseMaxDamage = Math.round(attacker.maxHp * chungiHpDamageFraction(item.rarity));
    },

    // Wand of Fire (14) — ON_ATTACK: applies burn stacks (flat DoT, expires fast).
    14: ({ defender, client, clock, item }) => {
        if (!defender || !client || !clock || !item) return;
        defender.addBurnStacks(clock, client, wandOfFireBurnStacks(item.rarity));
    },

    // Haste of Dagger (19) — ON_DODGE: instantly counter-attack with this dagger.
    19: ({ attacker, defender, item, client, performWeaponAttack, isCounterAttack }) => {
        // defender is the dodger holding the dagger; never counter a counter.
        if (isCounterAttack || !attacker || !defender || !item || !performWeaponAttack) return;
        let daggerSlot: string | null = null;
        defender.equippedItems.forEach((equipped, slot) => {
            if (equipped === item) daggerSlot = slot;
        });
        if (!daggerSlot) return;
        client?.send('combat_log', {
            text: `${defender.name}'s ${item.name} flashes — counter-attack!`,
            kind: 'counter',
            attackerId: defender.playerId,
            defenderId: attacker.playerId,
            itemId: item.itemId,
        } as CombatLogMessage);
        performWeaponAttack(defender, attacker, item, daggerSlot);
    },

    // Zwei-Hander (4) — AURA: unequips any item in the other hand slot while equipped.
    4: ({ attacker, trigger }) => {
        if (trigger !== TriggerType.AURA || !attacker) return;
        let zweiSlot: EquipSlot | null = null;
        attacker.equippedItems.forEach((equippedItem, slot) => {
            if (equippedItem.itemId === 4) zweiSlot = slot as EquipSlot;
        });
        if (!zweiSlot) return;
        const otherSlot = zweiSlot === EquipSlot.MAIN_HAND ? EquipSlot.OFF_HAND : EquipSlot.MAIN_HAND;
        const otherItem = attacker.equippedItems.get(otherSlot);
        if (otherItem) attacker.setItemUnequipped(otherItem, otherSlot);
    },
    // Dagger of Poison (18) — rarity 2+: applies (rarity-1) poison stacks on hit.
    18: ({ defender, client, clock, item }) => {
        if (!defender || !client || !clock || !item) return;
        defender.addPoisonStacks(clock, client, item.rarity);
    },

    // Soulstealer's Scythe (59) — rarity 2+: heals for (rarity*5+5)% of damage dealt + 1 on hit.
    59: ({ attacker, defender, damage, client, item }) => {
        if (!attacker || !damage || !item) return;
        const heal = Math.floor(damage * (item.rarity * 5 + 5) / 100) + 1;
        const scytheHealed = attacker.heal(heal, defender);
        if (scytheHealed > 0) {
            client?.send('healing', { playerId: attacker.playerId, healing: scytheHealed });
            client?.send('combat_log', { text: `${attacker.name}'s ${item.name} leeches ${fmt(scytheHealed)} health!`, kind: 'leech', attackerId: attacker.playerId, itemId: item.itemId, healing: scytheHealed } as CombatLogMessage)
        }
    },

    // Magic Ring (702) — not a weapon, doesn't attack. Starts Common with one
    // rolled stat that permanently stacks once per second (AURA) while in a
    // fight. LEVEL_UP bumps its rarity and rolls another stat into the mix,
    // until all 5 are active at Mythic (level 5). Rolled stats live directly
    // in affectedStats (no separate tracking needed) — see uniqueItemBalance.ts.
    702: ({ attacker, defender, item, trigger }) => {
        if (!attacker || !item) return;

        if (trigger === TriggerType.LEVEL_UP) {
            if (item.rarity >= ItemRarity.MYTHIC) return;
            item.rarity++;
            rollMagicRingBonus(item);
        } else {
            // AURA fires in the draft/shop too — only stack while actually fighting.
            if (!defender) return;
            stackMagicRingBonuses(item);
        }

        attacker.equippedItems.forEach((equipped, slot) => {
            if (equipped === item) attacker.equippedItems.set(slot, equipped);
        });
    },

    // Gambler's Dice (703) — rarity 2+: max damage equals income * (rarity/2).
    703: ({ attacker, item }) => {
        if (!attacker || !item || item.rarity <= 1) return;
        item.baseMaxDamage = attacker.income * (item.rarity / 2);
        attacker.equippedItems.forEach((equipped, slot) => {
            if (equipped === item) attacker.equippedItems.set(slot, equipped);
        });
    },

    // Ring of Immortality (47) — grants no stats. SHOP_START: if it's still equipped
    // when the next draft phase begins (i.e. it was worn through a fight), it
    // transforms into a random tier-5 item rolled all the way up to Mythic.
    47: async ({ attacker, item, trigger, client }) => {
        if (trigger !== TriggerType.SHOP_START || !attacker || !item) return;

        let ringSlot: EquipSlot | null = null;
        attacker.equippedItems.forEach((equipped, slot) => {
            if (equipped === item) ringSlot = slot as EquipSlot;
        });
        if (!ringSlot) return;

        const newItem = await rollRandomMythicTierFiveItem(attacker);
        if (!newItem) return;

        // The rolled item can be any type (weapon/armor/helmet/shield) — never auto-equip
        // it into the ring's hand slot, since a helmet/armor/shield doesn't belong there.
        // Free the hand slot and drop the reward into inventory for the player to equip.
        attacker.equippedItems.delete(ringSlot);
        attacker.inventory.push(newItem);

        client?.send('draft_log', `Your Ring of Immortality transforms into ${newItem.name} (Mythic)!`);
    },

    // Band of Vigor (27) — a ring, not a weapon. FIGHT_START: resets its once-per-fight proc.
    // ON_DAMAGE (fires on the wearer as `defender`, covers weapon hits and poison/burn DoT): the
    // first time HP drops below SECOND_WIND_THRESHOLD, heal a chunk of max HP and grant a brief
    // window of invulnerability.
    27: ({ defender, item, trigger, clock, client }) => {
        if (!item) return;

        if (trigger === TriggerType.FIGHT_START) {
            secondWindUsed.delete(item);
            return;
        }

        if (trigger !== TriggerType.ON_DAMAGE) return;
        if (!defender || !clock) return;
        if (secondWindUsed.get(item)) return;
        if (defender.hp <= 0 || defender.hp / defender.maxHp >= SECOND_WIND_THRESHOLD) return;

        secondWindUsed.set(item, true);
        const healed = defender.heal(Math.round(defender.maxHp * secondWindHealFraction(item.rarity)));
        const durationMs = secondWindInvulnMs(item.rarity);
        defender.setInvincible(clock, durationMs, client);

        if (healed > 0) {
            client?.send('healing', { playerId: defender.playerId, healing: healed });
        }
        client?.send('combat_log', {
            text: `${defender.name}'s ${item.name} triggers Second Wind: ${fmt(healed)} hp and ${(durationMs / 1000).toFixed(1)}s invulnerability!`,
            kind: 'item',
            defenderId: defender.playerId,
            itemId: item.itemId,
            healing: healed,
        } as CombatLogMessage);
    },

};
