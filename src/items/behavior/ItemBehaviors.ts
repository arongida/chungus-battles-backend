import { ItemBehaviorContext } from './ItemBehaviorContext';

export const ItemBehaviors: Record<number, (context: ItemBehaviorContext) => void> = {
    // Magic Ring Weapon (702) — grows +0.01 strength every time it attacks.
    702: ({ attacker, item }) => {
        if (!attacker || !item) return;
        item.affectedStats.strength += 0.01;
        attacker.equippedItems.forEach((equipped, slot) => {
            if (equipped === item) attacker.equippedItems.set(slot, equipped);
        });
    },

    // Gambler's Dice (703) — fires on AURA, rolls 1..(1+income) damage each second.
    703: ({ attacker, item }) => {
        if (!attacker || !item) return;
        item.baseMaxDamage = attacker.income;
        attacker.equippedItems.forEach((equipped, slot) => {
            if (equipped === item) attacker.equippedItems.set(slot, equipped);
        });
    },
};
