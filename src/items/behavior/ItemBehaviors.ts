import { ItemBehaviorContext } from './ItemBehaviorContext';
import { TriggerType } from '../../common/types';
import { OnDamageTriggerCommand } from '../../commands/triggers/OnDamageTriggerCommand';

export const ItemBehaviors: Record<number, (context: ItemBehaviorContext) => void> = {
    // Dagger of Poison (18) — applies 1 poison stack to defender on every hit.
    18: ({ defender, client, clock }) => {
        if (!defender || !client || !clock) return;
        defender.addPoisonStacks(clock, client, 1);
    },

    // Frozen Blade (29) — each hit reduces enemy attack speed by 2%, stacking down to 50%.
    29: ({ item, trigger }) => {
        if (!item) return;
        if (trigger === TriggerType.ON_ATTACK) {
            const current = item.affectedEnemyStats?.attackSpeed ?? 1;
            item.affectedEnemyStats.attackSpeed = Math.max(0.5, current * 0.98);
        } else if (trigger === TriggerType.FIGHT_END) {
            item.affectedEnemyStats.attackSpeed = 1;
        }
    },

    // Soulstealer's Scythe (59) — heals attacker for 15% of damage dealt + 1 on each hit.
    59: ({ attacker, damage, client }) => {
        if (!attacker || !damage) return;
        const heal = Math.floor(damage * 0.15) + 1;
        attacker.hp += heal;
        client?.send('healing', { playerId: attacker.playerId, healing: heal });
    },

    // Magic Ring Weapon (702) — grows +0.01 strength every time it attacks.
    702: ({ attacker, item }) => {
        if (!attacker || !item) return;
        item.affectedStats.strength += 0.03;
        attacker.equippedItems.forEach((equipped, slot) => {
            if (equipped === item) attacker.equippedItems.set(slot, equipped);
        });
    },

    // Gambler's Dice (703) — on attack + income max damage
    703: ({ attacker, item }) => {
        if (!attacker || !item) return;
        item.baseMaxDamage = attacker.income;
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
