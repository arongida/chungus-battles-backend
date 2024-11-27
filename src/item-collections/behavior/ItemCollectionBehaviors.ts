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
		const reflectDamage = itemCollection.base + itemCollection.scaling * defender.level;
		const damageAfterReduction = attacker.getDamageAfterDefense(reflectDamage);
		attacker.hp -= damageAfterReduction;
		client.send('damage', {
			playerId: attacker.playerId,
			damage: damageAfterReduction,
		});
		client.send('combat_log', `${defender.name} reflects ${damageAfterReduction} damage to ${attacker.name}!`);
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
		const { attacker, defender, client } = context;

		attacker.gold += 2;

		client.send('combat_log', `${attacker.name} ""borrowed"" 2 gold from ${defender.name}!`);

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
		client.send('combat_log', `${attacker.name} throws weapons for ${damageAfterReduction} damage!`);
		client.send('trigger_collection', {
			playerId: attacker.playerId,
			collectionId: ItemCollectionType.WARRIOR_2,
		});
	},

	[ItemCollectionType.ROGUE_2]: (context: ItemCollectionBehaviorContext) => {
		const { attacker, client, itemCollection } = context;
		attacker.attackSpeed += attacker.baseAttackSpeed * itemCollection.base - attacker.baseAttackSpeed;
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
		const { attacker, defender, client, itemCollection } = context;
		const armorReduction = Math.round(defender.defense * itemCollection.base);
		defender.defense -= armorReduction;
		client.send('trigger_collection', {
			playerId: attacker.playerId,
			collectionId: ItemCollectionType.WARRIOR_3,
		});
	},

	[ItemCollectionType.MERCHANT_4]: (context: ItemCollectionBehaviorContext) => {
		const { attacker, client } = context;
		attacker.income += 1;
		client.send('trigger_collection', {
			playerId: attacker.playerId,
			collectionId: ItemCollectionType.MERCHANT_4,
		});
	},

	[ItemCollectionType.WARRIOR_4]: (context: ItemCollectionBehaviorContext) => {
		const { attacker, client, itemCollection } = context;
		const missingHPPercentage = (attacker.maxHp - attacker.hp) / attacker.maxHp;
		const bonusAttack = attacker.baseStats.attack * missingHPPercentage;
		const previousSavedValue = itemCollection.savedValue;
		itemCollection.savedValue = bonusAttack;
		attacker.attack += bonusAttack - previousSavedValue;
		client.send('trigger_collection', {
			playerId: attacker.playerId,
			collectionId: ItemCollectionType.WARRIOR_4,
		});
	},

	[ItemCollectionType.ROGUE_4]: (context: ItemCollectionBehaviorContext) => {
		const { attacker, defender, client } = context;
		attacker.gold += 1;
		if (defender.gold > 0) defender.gold -= 1;
		client.send('combat_log', `${attacker.name} stole 1 gold from ${defender.name}!`);
		client.send('trigger_collection', {
			playerId: attacker.playerId,
			collectionId: ItemCollectionType.ROGUE_4,
		});
	},

	[ItemCollectionType.MERCHANT_3]: (context: ItemCollectionBehaviorContext) => {
		const { attacker, client, itemCollection } = context;
		const bonusCoefficent = (attacker.income * itemCollection.scaling + itemCollection.base) / 100;

		const attackBonus = Math.round(attacker.attack * bonusCoefficent);
		attacker.attack += attackBonus;
		attacker.initialStats.attack += attackBonus;

		const defenseBonus = Math.round(attacker.defense * bonusCoefficent);
		attacker.defense += defenseBonus;
		attacker.initialStats.defense += defenseBonus;

		const hpBonus = Math.round(attacker.hp * bonusCoefficent);
		attacker.maxHp += hpBonus;
		attacker.hp += hpBonus;
		attacker.initialStats.hp += hpBonus;

		const attackSpeedBonus = attacker.baseAttackSpeed * bonusCoefficent;
		attacker.attackSpeed += attackSpeedBonus;
		attacker.initialStats.attackSpeed += attackSpeedBonus;

		client.send('trigger_collection', {
			playerId: attacker.playerId,
			collectionId: ItemCollectionType.MERCHANT_3,
		});
	},

	[ItemCollectionType.WARRIOR_5]: (context: ItemCollectionBehaviorContext) => {
		const { attacker, defender, damage, client, itemCollection } = context;
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
		const { attacker, defender, client, itemCollection } = context;
		const damage = attacker.gold * itemCollection.scaling + itemCollection.base;
		const damageAfterReduction = defender.getDamageAfterDefense(damage);
		defender.hp -= damageAfterReduction;
		client.send('damage', {
			playerId: defender.playerId,
			damage: damageAfterReduction,
		});
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
		const { attacker, client, itemCollection } = context;
		const healingAmount = attacker.income * itemCollection.scaling + itemCollection.base;
		attacker.hp += healingAmount;
		client.send('combat_log', `${attacker.name}:  private doctor was paid to heal ${healingAmount}!`);
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
