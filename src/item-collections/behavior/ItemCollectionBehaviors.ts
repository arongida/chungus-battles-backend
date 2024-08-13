import { ItemCollectionType } from '../types/ItemCollectionTypes';
import { ItemCollectionBehaviorContext } from './ItemCollectionBehaviorContext';

export const ItemCollectionBehaviors = {
	[ItemCollectionType.SHIELDS_1]: (context: ItemCollectionBehaviorContext) => {
		const { defender, client, itemCollection, damage } = context;
		const armorAddictReduction = itemCollection.base;
		defender.damageToTake = damage - armorAddictReduction;
		client.send('trigger_collection', {
			playerId: defender.playerId,
			collectionId: ItemCollectionType.SHIELDS_1,
		});
	},

	[ItemCollectionType.SHIELDS_2]: (context: ItemCollectionBehaviorContext) => {
		const { defender, client, itemCollection, damage } = context;
		const armorAddictReduction = itemCollection.base;
		defender.damageToTake = damage - armorAddictReduction;
		client.send('trigger_collection', {
			playerId: defender.playerId,
			collectionId: ItemCollectionType.SHIELDS_2,
		});
	},

	[ItemCollectionType.SHIELDS_3]: (context: ItemCollectionBehaviorContext) => {
		const { defender, client, itemCollection, damage } = context;
		const armorAddictReduction = itemCollection.base;
		defender.damageToTake = damage - armorAddictReduction;
		client.send('trigger_collection', {
			playerId: defender.playerId,
			collectionId: ItemCollectionType.SHIELDS_3,
		});
	},

	[ItemCollectionType.SHIELDS_4]: (context: ItemCollectionBehaviorContext) => {
		const { defender, client, itemCollection, damage } = context;
		const armorAddictReduction = itemCollection.base;
		defender.damageToTake = damage - armorAddictReduction;
		client.send('trigger_collection', {
			playerId: defender.playerId,
			collectionId: ItemCollectionType.SHIELDS_4,
		});
	},

	[ItemCollectionType.SHIELDS_5]: (context: ItemCollectionBehaviorContext) => {
		const { defender, client, itemCollection, damage } = context;
		const armorAddictReduction = itemCollection.base;
		defender.damageToTake = damage - armorAddictReduction;
		client.send('trigger_collection', {
			playerId: defender.playerId,
			collectionId: ItemCollectionType.SHIELDS_5,
		});
	},

	[ItemCollectionType.WARRIOR_1]: (context: ItemCollectionBehaviorContext) => {
		const { attacker, defender, client, itemCollection } = context;
		const reflectDamage =
			itemCollection.base + itemCollection.scaling * defender.level;
		const damageAfterReduction = attacker.getDamageAfterDefense(reflectDamage);
		attacker.hp -= damageAfterReduction;
		client.send('damage', {
			playerId: attacker.playerId,
			damage: damageAfterReduction,
		});
		client.send(
			'combat_log',
			`${defender.name} reflects ${damageAfterReduction} damage to ${attacker.name}!`
		);
		client.send('trigger_collection', {
			playerId: defender.playerId,
			collectionId: ItemCollectionType.WARRIOR_1,
		});
	},
};
