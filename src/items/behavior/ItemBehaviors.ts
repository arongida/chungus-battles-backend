import { ItemBehaviorContext } from './ItemBehaviorContext';
import { TriggerType } from '../../common/types';
import { OnDamageTriggerCommand } from '../../commands/triggers/OnDamageTriggerCommand';
import { EquipSlot } from '../types/ItemTypes';

export const ItemBehaviors: Record<number, (context: ItemBehaviorContext) => void> = {
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
        if (!defender || !client || !clock || !item || item.rarity <= 1) return;
        defender.addPoisonStacks(clock, client, item.rarity - 1);
    },

    // Frozen Blade (29) — rarity 2+: each hit slows enemy attack speed by rarity%, down to 50%.
    29: ({ item, trigger }) => {
        if (!item || item.rarity <= 1) return;
        if (trigger === TriggerType.ON_ATTACK) {
            const current = item.affectedEnemyStats?.attackSpeed ?? 1;
            item.affectedEnemyStats.attackSpeed = Math.max(0.5, current * (1 - item.rarity * 0.01));
        } else if (trigger === TriggerType.FIGHT_END) {
            item.affectedEnemyStats.attackSpeed = 1;
        }
    },

    // Soulstealer's Scythe (59) — rarity 2+: heals for (rarity*5+5)% of damage dealt + 1 on hit.
    59: ({ attacker, damage, client, item }) => {
        if (!attacker || !damage || !item || item.rarity <= 1) return;
        const heal = Math.floor(damage * (item.rarity * 5 + 5) / 100) + 1;
        attacker.hp += heal;
        client?.send('healing', { playerId: attacker.playerId, healing: heal });
    },

    // Magic Ring Weapon (702) — rarity 2+: gains +(rarity*0.01+0.01) strength per attack.
    702: ({ attacker, item }) => {
        if (!attacker || !item || item.rarity <= 1) return;
        item.affectedStats.strength += item.rarity * 0.01 + 0.01;
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

const shieldReflect: (context: ItemBehaviorContext) => void = ({ defender, attacker, item, client, commandDispatcher }) => {
    if (!defender || !item || !attacker || !client || !commandDispatcher || item.rarity <= 1) return;

    const baseDamage = 0.5 * item.rarity * item.tier;
    const damage = attacker.getDamageAfterDefense(baseDamage);
    commandDispatcher.dispatch(new OnDamageTriggerCommand(), {
        defender: defender,
        damage: damage,
        attacker: attacker,
    });
    attacker.takeDamage(damage, client);
    client.send('combat_log', `${defender.name}'s ${item.name} reflects ${damage} damage to ${attacker.name}!`)
    defender.equippedItems.forEach((equipped, slot) => {
        if (equipped === item) client.send('trigger_item', { playerId: defender.playerId, itemId: item.itemId, slot: slot });
    });

};

for (let id = 76; id <= 80; id++) {
    ItemBehaviors[id] = shieldReflect;
}
