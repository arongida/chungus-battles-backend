import { ItemBehaviorContext } from './ItemBehaviorContext';
import { TriggerType } from '../../common/types';
import { EquipSlot, ItemType } from '../types/ItemTypes';
import { CombatLogMessage, fmt } from '../../common/MessageTypes';
import {
    chungiHpDamageFraction,
    FLOWERING_STAFF_INVULN_COOLDOWN_MS,
    floweringStaffInvulnMs,
    wandOfFireBurnStacks,
} from './uniqueItemBalance';
import type { Item } from '../schema/ItemSchema';

// Last invulnerability proc per staff instance (clock-elapsed ms). Keyed by
// item instance so each fight's fresh state starts clean.
const floweringStaffLastProcMs = new WeakMap<Item, number>();

export const ItemBehaviors: Record<number | string, (context: ItemBehaviorContext) => void> = {
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
        defender.addPoisonStacks(clock, client, item.rarity - 1);
    },

    // Soulstealer's Scythe (59) — rarity 2+: heals for (rarity*5+5)% of damage dealt + 1 on hit.
    59: ({ attacker, defender, damage, client, item }) => {
        if (!attacker || !damage || !item || item.rarity <= 1) return;
        const heal = Math.floor(damage * (item.rarity * 5 + 5) / 100) + 1;
        const scytheHealed = attacker.heal(heal, defender);
        client?.send('healing', { playerId: attacker.playerId, healing: scytheHealed });
        client?.send('combat_log', { text: `${attacker.name}'s ${item.name} leeches ${fmt(scytheHealed)} health!`, kind: 'leech', attackerId: attacker.playerId, itemId: item.itemId, healing: scytheHealed } as CombatLogMessage)
    },

    // Magic Ring Weapon (702) — rarity 2+: gains +(rarity*0.01+0.01) strength per attack.
    702: ({ attacker, item }) => {
        if (!attacker || !item || item.rarity <= 1) return;
        const bonusStrength = attacker.level * item.rarity * 0.05;
        item.affectedStats.strength +=  bonusStrength;
        item.affectedStats.maxHp += bonusStrength;
        item.description = `Gains +${bonusStrength} strength and max HP per attack.`
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

};
