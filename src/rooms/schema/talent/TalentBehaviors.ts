import { TalentType } from './TalentTypes';
import { TalentBehaviorContext } from './TalentBehaviorContext';
import { Talent } from './TalentSchema';
import { increaseStats } from '../../../common/utils';

export const TalentBehaviors = {
	[TalentType.Rage]: (context: TalentBehaviorContext, talent: Talent) => {
		const selfDamage = talent.activationRate * context.attacker.hp * 0.01 + 1;
		context.attacker.hp -= selfDamage;
		context.attacker.attack += context.attacker.talents.find(
			(t) => t.talentId === TalentType.Rage
		)!.activationRate;
		context.client.send(
			'combat_log',
			`${context.attacker.name} rages, increased attack by 1!`
		);
		context.client.send('damage', {
			playerId: context.attacker.playerId,
			damage: selfDamage,
		});
		context.client.send('trigger_talent', {
			playerId: context.attacker.playerId,
			talentId: TalentType.Rage,
		});
	},

	[TalentType.Stab]: (context: TalentBehaviorContext, talent: Talent) => {
		const stabDamage =
			talent.activationRate * 100 +
			(context.defender.maxHp - context.defender.hp) * talent.activationRate;
		const calculatedStabDamage = context.defender.takeDamage(
			stabDamage,
			context.client
		);
		context.client.send(
			'combat_log',
			`${context.attacker.name} stabs ${context.defender.name} for ${calculatedStabDamage} damage!`
		);
		context.client.send('trigger_talent', {
			playerId: context.attacker.playerId,
			talentId: TalentType.Stab,
		});
	},

	[TalentType.Bear]: (context: TalentBehaviorContext, talent: Talent) => {
		const bearDamage =
			talent.activationRate * 100 +
			context.attacker.maxHp * talent.activationRate;
		const calculatedBearDamage = context.defender.takeDamage(
			bearDamage,
			context.client
		);
		context.client.send(
			'combat_log',
			`${context.attacker.name} mauls ${context.defender.name} for ${calculatedBearDamage} damage!`
		);
		context.client.send('trigger_talent', {
			playerId: context.attacker.playerId,
			talentId: TalentType.Bear,
		});
	},

	[TalentType.AssassinAmusement]: (
		context: TalentBehaviorContext,
		talent: Talent
	) => {
		context.attacker.attackSpeed += talent.activationRate;
		context.client.send(
			'combat_log',
			`${context.attacker.name} gains ${talent.activationRate} attack speed!`
		);
		context.client.send('trigger_talent', {
			playerId: context.attacker.playerId,
			talentId: TalentType.AssassinAmusement,
		});
	},

	[TalentType.Poison]: (context: TalentBehaviorContext, talent: Talent) => {
		context.defender.addPoison(
			context.clock,
			context.client,
			talent.activationRate
		);
		context.client.send('trigger_talent', {
			playerId: context.attacker.playerId,
			talentId: TalentType.Poison,
		});
	},

	[TalentType.Invigorate]: (context: TalentBehaviorContext, talent: Talent) => {
		const leechAmount = context.damage * 0.15 + 2;
		context.attacker.hp += leechAmount;
		context.client.send(
			'combat_log',
			`${context.attacker.name} leeches ${leechAmount} health!`
		);
		context.client.send('trigger_talent', {
			playerId: context.attacker.playerId,
			talentId: TalentType.Invigorate,
		});
		context.client.send('healing', {
			playerId: context.attacker.playerId,
			healing: leechAmount,
		});
	},

	[TalentType.Snitch]: (context: TalentBehaviorContext, talent: Talent) => {
		if (context.attacker.attack > 1) {
			context.defender.attack -= 1;
			context.attacker.attack += 1;
			context.client.send(
				'combat_log',
				`${context.attacker.name} snitches 1 attack from ${context.defender.name}!`
			);
			context.client.send('trigger_talent', {
				playerId: context.attacker.playerId,
				talentId: TalentType.Snitch,
			});
		}
	},

	[TalentType.Steal]: (context: TalentBehaviorContext, talent: Talent) => {
		const stolenItemIndex = Math.floor(
			Math.random() * context.defender.inventory.length
		);
		const stolenItem = context.defender.inventory[stolenItemIndex];
		if (stolenItem) {
			context.defender.inventory.splice(stolenItemIndex, 1);
			context.client.send(
				'combat_log',
				`${context.attacker.name} steals ${stolenItem.name} from ${context.defender.name}!`
			);
			context.client.send('trigger_talent', {
				playerId: context.attacker.playerId,
				talentId: TalentType.Steal,
			});
			context.attacker.inventory.push(stolenItem);
			increaseStats(context.attacker, stolenItem.affectedStats);
			increaseStats(context.defender, stolenItem.affectedStats, -1);
		}
	},

	[TalentType.Pickpocket]: (context: TalentBehaviorContext, talent: Talent) => {
		context.attacker.gold += 1;
		if (context.defender.gold > 0) context.defender.gold -= 1;
		context.client.send(
			'combat_log',
			`${context.attacker.name} stole 1 gold from ${context.defender.name}!`
		);
		context.client.send('trigger_talent', {
			playerId: context.attacker.playerId,
			talentId: TalentType.Pickpocket,
		});
	},

	[TalentType.Scam]: (context: TalentBehaviorContext, talent: Talent) => {
		const amount = 2 + context.attacker.level;
		context.defender.hp -= amount;
		context.attacker.hp += amount;
		context.client.send(
			'combat_log',
			`${context.attacker.name} scams ${amount} health from ${context.defender.name}!`
		);
		context.client.send('trigger_talent', {
			playerId: context.attacker.playerId,
			talentId: TalentType.Scam,
		});
		context.client.send('damage', {
			playerId: context.defender.playerId,
			damage: amount,
		});
		context.client.send('healing', {
			playerId: context.attacker.playerId,
			healing: amount,
		});
	},

	[TalentType.Bandage]: (context: TalentBehaviorContext, talent: Talent) => {
		const healing = 5 + context.attacker.level;
		context.attacker.hp += healing;
		context.client.send(
			'combat_log',
			`${context.attacker.name} restores ${healing} health!`
		);
		context.client.send('trigger_talent', {
			playerId: context.attacker.playerId,
			talentId: TalentType.Bandage,
		});
		context.client.send('healing', {
			playerId: context.attacker.playerId,
			healing: healing,
		});
	},

	[TalentType.ThrowMoney]: (context: TalentBehaviorContext, talent: Talent) => {
		const initialDamage = 7 + context.attacker.gold * 0.7;
		const damage = context.defender.takeDamage(initialDamage, context.client);
		context.client.send(
			'combat_log',
			`${context.attacker.name} throws money for ${damage} damage!`
		);
		context.client.send('trigger_talent', {
			playerId: context.attacker.playerId,
			talentId: TalentType.ThrowMoney,
		});
	},
};
