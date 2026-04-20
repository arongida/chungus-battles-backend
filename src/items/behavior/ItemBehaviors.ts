import { ItemBehaviorContext } from './ItemBehaviorContext';
import { OnDamageTriggerCommand } from '../../commands/triggers/OnDamageTriggerCommand';
import { rollTheDice } from '../../common/utils';
import { EquipSlot } from '../types/ItemTypes';

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
    703: ({ attacker, defender, client, commandDispatcher, item }) => {
        if (!attacker || !defender) return;
        const raw = rollTheDice(1, 1 + attacker.income);
        const damage = defender.getDamageAfterDefense(raw);
        commandDispatcher.dispatch(new OnDamageTriggerCommand(), { attacker, defender, damage });
        defender.takeDamage(damage, client);
        client.send('combat_log', `${attacker.name} rolls the dice and deals ${damage} damage!`);
        client.send('trigger_item', { playerId: attacker.playerId, itemId: item.itemId, slot: EquipSlot.OFF_HAND });
    },
};
