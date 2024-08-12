import { TalentType } from '../types/TalentTypes';
import { TalentBehaviorContext } from './TalentBehaviorContext';
import { increaseStats } from '../../common/utils';
import { Item } from '../../items/schema/ItemSchema';
import { Talent } from '../schema/TalentSchema';

export const TalentBehaviors = {
	[TalentType.RAGE]: (context: TalentBehaviorContext) => {
		const { talent, attacker, client } = context;
		const selfDamage = talent.activationRate * attacker.hp * 0.01 + 1;
		attacker.hp -= selfDamage;
		attacker.attack += talent.activationRate;
		client.send('combat_log', `${attacker.name} rages, increased attack by 1!`);
		client.send('damage', {
			playerId: attacker.playerId,
			damage: selfDamage,
		});
		client.send('trigger_talent', {
			playerId: attacker.playerId,
			talentId: TalentType.RAGE,
		});
	},

	[TalentType.STAB]: (context: TalentBehaviorContext) => {
		const { talent, attacker, defender, client } = context;
		const stabDamage =
			talent.activationRate * 100 +
			(defender.maxHp - defender.hp) * talent.activationRate;
		const calculatedStabDamage = defender.getDamageAfterDefense(stabDamage);
		defender.takeDamage(calculatedStabDamage, client);
		client.send(
			'combat_log',
			`${attacker.name} stabs ${defender.name} for ${calculatedStabDamage} damage!`
		);
		client.send('trigger_talent', {
			playerId: attacker.playerId,
			talentId: TalentType.STAB,
		});
	},

	[TalentType.BEAR]: (context: TalentBehaviorContext) => {
		const { talent, attacker, defender, client } = context;
		const bearDamage =
			talent.activationRate * 100 + attacker.maxHp * talent.activationRate;
		const calculatedBearDamage = defender.getDamageAfterDefense(bearDamage);
		defender.takeDamage(calculatedBearDamage, client);
		client.send(
			'combat_log',
			`${attacker.name} mauls ${defender.name} for ${calculatedBearDamage} damage!`
		);
		client.send('trigger_talent', {
			playerId: attacker.playerId,
			talentId: TalentType.BEAR,
		});
	},

	[TalentType.ASSASSIN_AMUSEMENT]: (context: TalentBehaviorContext) => {
		const { attacker, client, talent } = context;
		attacker.attackSpeed += talent.activationRate;
		client.send(
			'combat_log',
			`${attacker.name} gains ${talent.activationRate} attack speed!`
		);
		client.send('trigger_talent', {
			playerId: attacker.playerId,
			talentId: TalentType.ASSASSIN_AMUSEMENT,
		});
	},

	[TalentType.POISON]: (context: TalentBehaviorContext) => {
		const { talent, attacker, defender, client, clock } = context;
		defender.addPoisonStacks(clock, client, talent.activationRate);
		client.send('trigger_talent', {
			playerId: attacker.playerId,
			talentId: TalentType.POISON,
		});
	},

	[TalentType.INVIGORATE]: (context: TalentBehaviorContext) => {
		const { attacker, damage, client } = context;
		const leechAmount = damage * 0.15 + 2;
		attacker.hp += leechAmount;
		client.send(
			'combat_log',
			`${attacker.name} leeches ${leechAmount} health!`
		);
		client.send('trigger_talent', {
			playerId: attacker.playerId,
			talentId: TalentType.INVIGORATE,
		});
		client.send('healing', {
			playerId: attacker.playerId,
			healing: leechAmount,
		});
	},

	[TalentType.SNITCH]: (context: TalentBehaviorContext) => {
		const { attacker, defender, client } = context;
		if (attacker.attack > 1) {
			defender.attack -= 1;
			attacker.attack += 1;
			client.send(
				'combat_log',
				`${attacker.name} snitches 1 attack from ${defender.name}!`
			);
			client.send('trigger_talent', {
				playerId: attacker.playerId,
				talentId: TalentType.SNITCH,
			});
		}
	},

	[TalentType.STEAL]: (context: TalentBehaviorContext) => {
		const { attacker, defender, client } = context;
		const stolenItemIndex = Math.floor(
			Math.random() * defender.inventory.length
		);
		const stolenItem = defender.inventory[stolenItemIndex];
		if (stolenItem) {
			defender.inventory.splice(stolenItemIndex, 1);
			client.send(
				'combat_log',
				`${attacker.name} steals ${stolenItem.name} from ${defender.name}!`
			);
			client.send('trigger_talent', {
				playerId: attacker.playerId,
				talentId: TalentType.STEAL,
			});
			attacker.inventory.push(stolenItem);
			increaseStats(attacker, stolenItem.affectedStats);
			increaseStats(defender, stolenItem.affectedStats, -1);
		}
	},

	[TalentType.PICKPOCKET]: (context: TalentBehaviorContext) => {
		const { attacker, defender, client } = context;
		attacker.gold += 1;
		if (defender.gold > 0) defender.gold -= 1;
		client.send(
			'combat_log',
			`${attacker.name} stole 1 gold from ${defender.name}!`
		);
		client.send('trigger_talent', {
			playerId: attacker.playerId,
			talentId: TalentType.PICKPOCKET,
		});
	},

	[TalentType.SCAM]: (context: TalentBehaviorContext) => {
		const { attacker, defender, client } = context;
		const amount = 2 + attacker.level;
		defender.hp -= amount;
		attacker.hp += amount;
		client.send(
			'combat_log',
			`${attacker.name} scams ${amount} health from ${defender.name}!`
		);
		client.send('trigger_talent', {
			playerId: attacker.playerId,
			talentId: TalentType.SCAM,
		});
		client.send('damage', {
			playerId: defender.playerId,
			damage: amount,
		});
		client.send('healing', {
			playerId: attacker.playerId,
			healing: amount,
		});
	},

	[TalentType.BANDAGE]: (context: TalentBehaviorContext) => {
		const { attacker, client } = context;
		const healing = 5 + attacker.level;
		attacker.hp += healing;
		client.send('combat_log', `${attacker.name} restores ${healing} health!`);
		client.send('trigger_talent', {
			playerId: attacker.playerId,
			talentId: TalentType.BANDAGE,
		});
		client.send('healing', {
			playerId: attacker.playerId,
			healing: healing,
		});
	},

	[TalentType.THROW_MONEY]: (context: TalentBehaviorContext) => {
		const { attacker, defender, client } = context;
		const initialDamage = 7 + attacker.gold * 0.7;
		const damage = defender.getDamageAfterDefense(initialDamage);
		defender.takeDamage(damage, client);
		client.send(
			'combat_log',
			`${attacker.name} throws money for ${damage} damage!`
		);
		client.send('trigger_talent', {
			playerId: attacker.playerId,
			talentId: TalentType.THROW_MONEY,
		});
	},

	[TalentType.DISARM]: (context: TalentBehaviorContext) => {
		const { attacker, defender, client } = context;
		const weapons: Item[] = defender.inventory.filter((item) =>
			item.tags.includes('weapon')
		);
		if (weapons.length > 0) {
			const mostExpensiveWeapon: Item = weapons.reduce(
				(maxWeapon: Item, currentWeapon: Item) => {
					return currentWeapon.price > maxWeapon.price
						? currentWeapon
						: maxWeapon;
				},
				weapons[0]
			);

			increaseStats(defender, mostExpensiveWeapon.affectedStats, -1);
			client.send(
				'combat_log',
				`${defender.name} is disarmed! ${mostExpensiveWeapon.name} is disabled for the fight!`
			);
		} else {
			client.send('combat_log', `${defender.name} has no weapons to disarm!`);
		}
		client.send('trigger_talent', {
			playerId: attacker.playerId,
			talentId: TalentType.DISARM,
		});
	},

	[TalentType.WEAPON_WHISPERER]: (context: TalentBehaviorContext) => {
		const { attacker, talent, client } = context;

		const numberOfMeleeWeapons = attacker.getNumberOfItemsForTags(['weapon', 'melee']);
		const attackBonus = numberOfMeleeWeapons * talent.activationRate;
		attacker.attack += attackBonus;
		client.send(
			'combat_log',
			`${attacker.name} gains ${attackBonus} attack from Weapon Whisperer!`
		);
		client.send('trigger_talent', {
			playerId: attacker.playerId,
			talentId: TalentType.WEAPON_WHISPERER,
		});
	},

	[TalentType.GOLD_GENIE]: (context: TalentBehaviorContext) => {
		const { attacker, client } = context;
		const defenseBonus = attacker.gold * 2;
		attacker.defense += defenseBonus;
		client.send(
			'combat_log',
			`${attacker.name} gains ${defenseBonus} defense from Gold Genie!`
		);
		client.send('trigger_talent', {
			playerId: attacker.playerId,
			talentId: TalentType.GOLD_GENIE,
		});
	},

	[TalentType.STRONG]: (context: TalentBehaviorContext) => {
		const { attacker, talent, client } = context;
		const hpBonus = attacker.hp * talent.activationRate;
		const attackBonus = attacker.attack * talent.activationRate;
		attacker.hp += hpBonus;
		attacker.maxHp = attacker.hp;
		attacker.attack += attackBonus;
		client.send(
			'combat_log',
			`${attacker.name} is strong hence gets an increase to stats!`
		);
		client.send('combat_log', `${attacker.name} gains ${hpBonus} hp!`);
		client.send('combat_log', `${attacker.name} gains ${attackBonus} attack!`);
		client.send('trigger_talent', {
			playerId: attacker.playerId,
			talentId: TalentType.STRONG,
		});
	},

	[TalentType.INTIMIDATING_WEALTH]: (context: TalentBehaviorContext) => {
		const { attacker, defender, client } = context;
		const attackBonus =
			Math.min(0.2 + attacker.gold * 0.0025, 0.4) * defender.attack;
		defender.attack -= attackBonus;
		client.send(
			'combat_log',
			`${attacker.name} intimidates ${defender.name} with their wealth!`
		);
		client.send('combat_log', `${defender.name} looses ${attackBonus} attack!`);
		client.send('trigger_talent', {
			playerId: attacker.playerId,
			talentId: TalentType.INTIMIDATING_WEALTH,
		});
	},

	[TalentType.CORRODING_COLLECTION]: (context: TalentBehaviorContext) => {
		const { attacker, defender, client, clock, talent } = context;
		const numberOfItems = defender.inventory.length;
		defender.addPoisonStacks(
			clock,
			client,
			talent.activationRate,
			numberOfItems
		);

		client.send(
			'combat_log',
			`${attacker.name} corrodes ${defender.name}'s collection!`
		);
		client.send('trigger_talent', {
			playerId: attacker.playerId,
			talentId: TalentType.CORRODING_COLLECTION,
		});
	},

	[TalentType.ZEALOT]: (context: TalentBehaviorContext) => {
		const { defender, client, talent } = context;
		const attackSpeedBuff =
			0.02 + defender.defense * talent.activationRate * 0.01;
		const normalizedValue = Math.round(attackSpeedBuff * 100) / 100;
		defender.attackSpeed += normalizedValue;
		client.send(
			'combat_log',
			`${defender.name} gains ${normalizedValue} attack speed!`
		);
		client.send('trigger_talent', {
			playerId: defender.playerId,
			talentId: TalentType.ZEALOT,
		});
	},

	[TalentType.RESILIENCE]: (context: TalentBehaviorContext) => {
		const { defender, client, talent } = context;
		const healingAmount = 1 + talent.activationRate * defender.maxHp;
		defender.hp += healingAmount;
		client.send(
			'combat_log',
			`${defender.name} recovers ${healingAmount} health!`
		);
		client.send('trigger_talent', {
			playerId: defender.playerId,
			talentId: TalentType.RESILIENCE,
		});
		client.send('healing', {
			playerId: defender.playerId,
			healing: healingAmount,
		});
	},

	[TalentType.THORNY_FENCE]: (context: TalentBehaviorContext) => {
		const { attacker, defender, client, talent } = context;
		const reflectDamage =
			talent.activationRate * 100 + talent.activationRate * defender.defense;
		attacker.hp -= reflectDamage;
		client.send(
			'combat_log',
			`${defender.name} reflects ${reflectDamage} damage to ${attacker.name}!`
		);
		client.send('trigger_talent', {
			playerId: defender.playerId,
			talentId: TalentType.THORNY_FENCE,
		});
		client.send('damage', {
			playerId: attacker.playerId,
			damage: reflectDamage,
		});
	},

	[TalentType.EYE_FOR_AN_EYE]: (context: TalentBehaviorContext) => {
		const { attacker, defender, client, talent, damage, clock } = context;
		if (defender.talentsOnCooldown.includes(TalentType.EYE_FOR_AN_EYE)) {
			console.log('Eye for an eye is on cooldown');
			return;
		}
		const random = Math.random();
		if (random < talent.activationRate) {
			attacker.hp -= damage;
			client.send(
				'combat_log',
				`${defender.name} reflects ${damage} damage to ${attacker.name}!`
			);
			client.send('trigger_talent', {
				playerId: defender.playerId,
				talentId: TalentType.EYE_FOR_AN_EYE,
			});
			client.send('damage', {
				playerId: attacker.playerId,
				damage: damage,
			});
			defender.talentsOnCooldown.push(TalentType.EYE_FOR_AN_EYE);
			clock.setTimeout(() => {
				defender.talentsOnCooldown = defender.talentsOnCooldown.filter(
					(talent) => talent !== TalentType.EYE_FOR_AN_EYE
				);
			}, 1000);
		}
	},

	[TalentType.TRICKSTER]: (context: TalentBehaviorContext) => {
		const { client, attacker, defender } = context;
		const enemyAttack = defender.attack;
		const playerAttack = attacker.attack;
		attacker.attack = enemyAttack;
		defender.attack = playerAttack;
		client.send('combat_log', `${attacker.name} tricks ${defender.name}!`);
		client.send('trigger_talent', {
			playerId: attacker.playerId,
			talentId: TalentType.TRICKSTER,
		});
	},

	[TalentType.ARMOR_ADDICT]: (context: TalentBehaviorContext) => {
		const { defender, client, talent, damage } = context;
		const armorAddictReduction =
			talent.activationRate * defender.getNumberOfItemsForTags(['armor']);
		defender.damageToTake = damage - armorAddictReduction;
		console.log(
			`Reduced damage by ${armorAddictReduction}, new damage: ${defender.damageToTake}`
		);
		client.send('trigger_talent', {
			playerId: defender.playerId,
			talentId: TalentType.ARMOR_ADDICT,
		});
	},

	[TalentType.EVASION]: (context: TalentBehaviorContext) => {
		const { attacker, client, talent } = context;
		attacker.dodgeRate += talent.activationRate;
		client.send(
			'combat_log',
			`${attacker.name} gains ${talent.activationRate * 100}% dodge chance!`
		);
		client.send('trigger_talent', {
			playerId: attacker.playerId,
			talentId: TalentType.EVASION,
		});
	},

	[TalentType.FUTURE_NOW]: (context: TalentBehaviorContext) => {
		const { attacker, client, talent } = context;
		client.send(
			'combat_log',
			'You are in the future now! You gain extra gold and xp!'
		);
		client.send('trigger_talent', {
			playerId: attacker.playerId,
			talentId: talent.talentId,
		});
		attacker.rewardRound += talent.activationRate;
	},

	[TalentType.SMART_INVESTMENT]: (context: TalentBehaviorContext) => {
		const { attacker, client, talent } = context;
		const goldBonus = Math.max(
			Math.round(attacker.gold * talent.activationRate),
			5
		);
		attacker.gold += goldBonus;
		client.send(
			'combat_log',
			`You gained ${goldBonus} gold from selling loot!`
		);
		client.send('trigger_talent', {
			playerId: attacker.playerId,
			talentId: TalentType.SMART_INVESTMENT,
		});
	},

	[TalentType.GUARDIAN_ANGEL]: (context: TalentBehaviorContext) => {
		const { attacker, client } = context;
		client.send('combat_log', 'You have been gifted by the guardian angel!');
		client.send('trigger_talent', {
			playerId: attacker.playerId,
			talentId: TalentType.GUARDIAN_ANGEL,
		});
		attacker.lives += 1;
		attacker.talents = attacker.talents.filter(
			(talent) => talent.talentId !== TalentType.GUARDIAN_ANGEL
		);
		attacker.talents.push(
			new Talent({
				talentId: 6,
				name: 'Guardianless Angel',
				description: 'Why are they not helping anymore?',
			})
		);
	},

	[TalentType.PENNY_STOCKS]: (context: TalentBehaviorContext) => {
		const { client, attacker, clock, talent } = context;
		attacker.gold += talent.activationRate;
		client.send('draft_log', `Gained ${talent.activationRate} gold!`);

		attacker.talents = attacker.talents.filter(
			(talent) => talent.talentId !== TalentType.PENNY_STOCKS
		);
		attacker.talents.push(
			new Talent({
				talentId: 7,
				name: 'Broken Penny Stocks',
				description: 'Already used',
				tier: 1,
				activationRate: 0,
				tags: ['talent', 'merchant', 'used'],
			})
		);
		clock.setTimeout(() => {
			client.send('trigger_talent', {
				playerId: attacker.playerId,
				talentId: 7,
			});
		}, 100);
	},

	[TalentType.ROBBERY]: (context: TalentBehaviorContext) => {
		const { attacker, client, shop } = context;
		const randomItem = shop[Math.floor(Math.random() * shop.length)];
		if (randomItem) {
			attacker.getItem(randomItem);
			client.send('trigger_talent', {
				playerId: attacker.playerId,
				talentId: TalentType.ROBBERY,
			});
			client.send(
				'draft_log',
				`Robbery talent activated! Gained ${randomItem.name}!`
			);
		}
	},
};
