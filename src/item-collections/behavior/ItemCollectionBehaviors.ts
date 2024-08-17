import { Talent } from '../../talents/schema/TalentSchema';
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

	[ItemCollectionType.MERCHANT_1]: (context: ItemCollectionBehaviorContext) => {
		const { attacker, client, itemCollection, shop } = context;
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
		const { attacker, client, availableTalents } = context;
		attacker.talents = attacker.talents.filter((talent) => talent.tier !== 1);
		const tier1Talents = availableTalents.filter(
			(talent) => talent.tier === 1 && !talent.tags.includes('used')
		);
		const randomTier1Talents = tier1Talents
			.sort(() => 0.5 - Math.random())
			.slice(0, 2);
		randomTier1Talents.forEach((talent) => {
			const newTalent = new Talent();
			newTalent.assign(talent);
			attacker.talents.push(newTalent);
		});
		client.send('trigger_collection', {
			playerId: attacker.playerId,
			collectionId: ItemCollectionType.ROGUE_1,
		});
	},

	[ItemCollectionType.WARRIOR_2]: (context: ItemCollectionBehaviorContext) => {
		const { attacker, defender, client } = context;
		attacker.talents = attacker.talents.filter((talent) => talent.tier !== 1);
		const initialDamage = attacker.attack;
		const damageAfterReduction = defender.getDamageAfterDefense(initialDamage);
		defender.hp -= damageAfterReduction;
		client.send('damage', {
			playerId: defender.playerId,
			damage: damageAfterReduction,
		});
		client.send(
			'combat_log',
			`${attacker.name} throws weapons for ${damageAfterReduction} damage!`
		);
		client.send('trigger_collection', {
			playerId: attacker.playerId,
			collectionId: ItemCollectionType.WARRIOR_2,
		});
	},

  [ItemCollectionType.ROGUE_2]: (context: ItemCollectionBehaviorContext) => {
		const { attacker, client, itemCollection } = context;
    attacker.attackSpeed += (attacker.baseAttackSpeed * itemCollection.base - attacker.baseAttackSpeed);
		client.send('trigger_collection', {
			playerId: attacker.playerId,
			collectionId: ItemCollectionType.ROGUE_2,
		});
	},

	[ItemCollectionType.MERCHANT_2]: (context: ItemCollectionBehaviorContext) => {
		const { attacker, client } = context;
		if (attacker.refreshShopCost !== 1) {
			attacker.refreshShopCost = 1;
			client.send('trigger_collection', {
				playerId: attacker.playerId,
				collectionId: ItemCollectionType.MERCHANT_2,
			});
		}
	},

  [ItemCollectionType.ROGUE_3]: (context: ItemCollectionBehaviorContext) => {
		const { attacker, defender, client, clock } = context;
    defender.addPoisonStacks(clock, client);
		client.send('trigger_collection', {
			playerId: attacker.playerId,
			collectionId: ItemCollectionType.ROGUE_3,
		});
	},

  [ItemCollectionType.WARRIOR_3]: (context: ItemCollectionBehaviorContext) => {
		const { attacker, client, itemCollection } = context;
    console.log('attacker attack', attacker.attack);
    console.log('attacker maxHP', attacker.maxHp);
    const missingHPPercentage = (attacker.maxHp - attacker.hp) / attacker.maxHp;
    console.log('missing HP percentage', missingHPPercentage);
    console.log('initial attack', attacker.initialStats.attack);
    const bonusAttack = attacker.initialStats.attack * missingHPPercentage;
    const previousSavedValue = itemCollection.savedValue;
    itemCollection.savedValue = bonusAttack;
    console.log('bonus attack', bonusAttack);
    attacker.attack += (bonusAttack - previousSavedValue);
		client.send('trigger_collection', {
			playerId: attacker.playerId,
			collectionId: ItemCollectionType.WARRIOR_3,
		});
	},
};
