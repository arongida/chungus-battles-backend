import {OnDamageTriggerCommand} from '../../commands/triggers/OnDamageTriggerCommand';
import {ItemCollectionType} from '../types/ItemCollectionTypes';
import {ItemCollectionBehaviorContext} from './ItemCollectionBehaviorContext';

export const ItemCollectionBehaviors = {

    [ItemCollectionType.WARRIOR_1]: (context: ItemCollectionBehaviorContext) => {
        const {attacker, defender, client, itemCollection, commandDispatcher} = context;
        const reflectDamage = itemCollection.base + itemCollection.scaling * defender.level;
        const damageAfterReduction = attacker.getDamageAfterDefense(reflectDamage);
        commandDispatcher.dispatch(new OnDamageTriggerCommand(), {
            defender: attacker,
            damage: damageAfterReduction,
            attacker: attacker,
        });
        attacker.takeDamage(damageAfterReduction, client);
        client.send('combat_log', `${defender.name} reflects ${damageAfterReduction} damage to ${attacker.name}!`);
        client.send('trigger_collection', {
            playerId: defender.playerId,
            collectionId: ItemCollectionType.WARRIOR_1,
        });
    },

    [ItemCollectionType.MERCHANT_1]: (context: ItemCollectionBehaviorContext) => {
        const {attacker, client, itemCollection, shop} = context;
        const discount = itemCollection.base;
        shop.forEach((item) => {
            item.price -= discount;
        });
        client.send('trigger_collection', {
            playerId: attacker.playerId,
            collectionId: ItemCollectionType.MERCHANT_1,
        });
    },

    [ItemCollectionType.ROGUE_1]: (context: ItemCollectionBehaviorContext) => {
        const {defender, client} = context;
        defender.gold += 1;
        client.send('combat_log', `${defender.name} found 1 gold during dodge roll!`);
        client.send('trigger_collection', {
            playerId: defender.playerId,
            collectionId: ItemCollectionType.ROGUE_1,
        });
    },

    [ItemCollectionType.WARRIOR_2]: (context: ItemCollectionBehaviorContext) => {
        const {attacker, defender, client, commandDispatcher} = context;
        const initialDamage = attacker.strength;
        const damageAfterReduction = defender.getDamageAfterDefense(initialDamage);
        commandDispatcher.dispatch(new OnDamageTriggerCommand(), {
            defender: defender,
            damage: damageAfterReduction,
            attacker: attacker,
        });
        defender.takeDamage(damageAfterReduction, client);
        client.send('combat_log', `${attacker.name} throws weapons for ${damageAfterReduction} damage!`);
        client.send('trigger_collection', {
            playerId: attacker.playerId,
            collectionId: ItemCollectionType.WARRIOR_2,
        });
    },

    [ItemCollectionType.ROGUE_2]: (context: ItemCollectionBehaviorContext) => {
        const {attacker, client, itemCollection} = context;

        attacker.baseStats.attackSpeed += attacker.baseStats.attackSpeed * itemCollection.base - attacker.baseStats.attackSpeed;
        client.send('trigger_collection', {
            playerId: attacker.playerId,
            collectionId: ItemCollectionType.ROGUE_2,
        });
    },

    [ItemCollectionType.MERCHANT_2]: (context: ItemCollectionBehaviorContext) => {
        const {attacker, client} = context;
        if (attacker.refreshShopCost !== 1) {
            attacker.refreshShopCost = 1;
            client.send('trigger_collection', {
                playerId: attacker.playerId,
                collectionId: ItemCollectionType.MERCHANT_2,
            });
        }
    },

    [ItemCollectionType.ROGUE_3]: (context: ItemCollectionBehaviorContext) => {
        const {attacker, defender, client, clock} = context;
        defender.addPoisonStacks(clock, client);
        client.send('trigger_collection', {
            playerId: attacker.playerId,
            collectionId: ItemCollectionType.ROGUE_3,
        });
    },

    [ItemCollectionType.WARRIOR_3]: (context: ItemCollectionBehaviorContext) => {
        const {attacker, defender, client, itemCollection} = context;
        if (defender) {
            itemCollection.affectedStats.defense = defender.defense * itemCollection.scaling;
            client.send('trigger_collection', {
                playerId: attacker.playerId,
                collectionId: ItemCollectionType.WARRIOR_3,
            });
        }
    },

    [ItemCollectionType.MERCHANT_4]: (context: ItemCollectionBehaviorContext) => {
        const {attacker, client} = context;
        attacker.baseStats.income += 1;
        client.send('trigger_collection', {
            playerId: attacker.playerId,
            collectionId: ItemCollectionType.MERCHANT_4,
        });
    },

    [ItemCollectionType.WARRIOR_4]: (context: ItemCollectionBehaviorContext) => {
        const {attacker, client, itemCollection} = context;
        const missingHPPercentage = (attacker.maxHp - attacker.hp) / attacker.maxHp;
        itemCollection.affectedStats.strength = attacker.strength * missingHPPercentage;
        client.send('trigger_collection', {
            playerId: attacker.playerId,
            collectionId: ItemCollectionType.WARRIOR_4,
        });
    },

    [ItemCollectionType.ROGUE_4]: (context: ItemCollectionBehaviorContext) => {
        const {attacker, defender, client} = context;
        attacker.gold += 1;
        if (defender.gold > 0) defender.gold -= 1;
        client.send('combat_log', `${attacker.name} stole 1 gold from ${defender.name}!`);
        client.send('trigger_collection', {
            playerId: attacker.playerId,
            collectionId: ItemCollectionType.ROGUE_4,
        });
    },

    [ItemCollectionType.MERCHANT_3]: (context: ItemCollectionBehaviorContext) => {
        const {attacker, client, itemCollection} = context;
        const bonusCoefficent = (attacker.income * itemCollection.scaling + itemCollection.base) / 100;

        const attackBonus = Math.round(attacker.strength * bonusCoefficent);
        itemCollection.affectedStats.strength += attackBonus;

        const accuracyBonus = Math.round(attacker.accuracy * bonusCoefficent);
        itemCollection.affectedStats.accuracy += accuracyBonus;

        const defenseBonus = Math.round(attacker.defense * bonusCoefficent);
        itemCollection.affectedStats.defense += defenseBonus;

        const hpBonus = Math.round(attacker.maxHp * bonusCoefficent);
        itemCollection.affectedStats.maxHp += hpBonus;


        client.send('trigger_collection', {
            playerId: attacker.playerId,
            collectionId: ItemCollectionType.MERCHANT_3,
        });
    },

    [ItemCollectionType.WARRIOR_5]: (context: ItemCollectionBehaviorContext) => {
        const {attacker, defender, damage, client, itemCollection} = context;
        const shouldExecute = itemCollection.base > (defender.hp - damage) / defender.maxHp;
        if (shouldExecute) {
            defender.hp = -9999;
            client.send('combat_log', `${attacker.name} executed ${defender.name}!`);
        }
        client.send('trigger_collection', {
            playerId: attacker.playerId,
            collectionId: ItemCollectionType.WARRIOR_5,
        });
    },

    [ItemCollectionType.ROGUE_5]: (context: ItemCollectionBehaviorContext) => {
        const {attacker, defender, client, itemCollection, commandDispatcher} = context;
        const damage = attacker.gold * itemCollection.scaling + itemCollection.base;
        const damageAfterReduction = defender.getDamageAfterDefense(damage);
        commandDispatcher.dispatch(new OnDamageTriggerCommand(), {
            defender: defender,
            damage: damageAfterReduction,
            attacker: attacker,
        });
        defender.takeDamage(damageAfterReduction, client);
        client.send(
            'combat_log',
            `${attacker.name} engraved gold on their weapon to deal ${damageAfterReduction} damage to ${defender.name}!`
        );
        client.send('trigger_collection', {
            playerId: attacker.playerId,
            collectionId: ItemCollectionType.ROGUE_5,
        });
    },

    [ItemCollectionType.MERCHANT_5]: (context: ItemCollectionBehaviorContext) => {
        const {attacker, client, itemCollection} = context;
        const healingAmount = attacker.income * itemCollection.scaling + itemCollection.base;
        attacker.hp += healingAmount;
        client.send('combat_log', `${attacker.name}: private doctor was paid to heal ${healingAmount}!`);
        client.send('healing', {
            playerId: attacker.playerId,
            healing: healingAmount,
        });
        client.send('trigger_collection', {
            playerId: attacker.playerId,
            collectionId: ItemCollectionType.MERCHANT_5,
        });
    },
};
