import { Schema, type, ArraySchema } from '@colyseus/schema';
import { Talent } from '../../talents/schema/TalentSchema';
import { Item } from '../../items/schema/ItemSchema';
import { IStats } from '../../common/types';
import { TalentType } from '../../talents/types/TalentTypes';
import { Client, Delayed } from 'colyseus';
import ClockTimer from '@gamestdio/timer';
import { TalentBehaviorContext } from '../../talents/behavior/TalentBehaviorContext';

export class Player extends Schema {
	@type('number') playerId: number;
	@type('string') name: string;
	@type('number') private _hp: number;
	@type('number') private _attack: number;
	@type('number') private _gold: number;
	@type('number') xp: number;
	@type('number') private _level: number;
	@type('string') sessionId: string;
	@type('number') private _defense: number;
	@type('number') private _attackSpeed: number;
	@type('number') maxXp: number;
	@type('number') round: number;
	@type('number') lives: number;
	@type('number') wins: number;
	@type('string') avatarUrl: string;
	@type([Talent]) talents: ArraySchema<Talent> = new ArraySchema<Talent>();
	@type([Item]) inventory: ArraySchema<Item> = new ArraySchema<Item>();
	@type('number') dodgeRate: number = 0;
	initialStats: IStats = { hp: 0, attack: 0, defense: 0, attackSpeed: 0 };
	initialInventory: Item[] = [];
	private _poisonStack: number = 0;
	maxHp: number;
	attackTimer: Delayed;
	poisonTimer: Delayed;
	talentsOnCooldown: TalentType[] = [];
	damageToTake: number;
	rewardRound: number;

	get gold(): number {
		return this._gold;
	}

	set gold(value: number) {
		this._gold = value < 0 ? 0 : value;
	}

	get level(): number {
		return this._level;
	}

	set level(value: number) {
		this._level = value > 5 ? 5 : value;
	}

	get attackSpeed(): number {
		return this._attackSpeed;
	}

	set attackSpeed(value: number) {
		this._attackSpeed = value < 0.1 ? 0.1 : value;
	}

	get hp(): number {
		return this._hp;
	}

	set hp(value: number) {
		this._hp = value;
	}

	get attack(): number {
		return this._attack;
	}

	set attack(value: number) {
		this._attack = value < 1 ? 1 : value;
	}

	get poisonStack(): number {
		return this._poisonStack;
	}

	set poisonStack(value: number) {
		if (value < 0) {
			this._poisonStack = 0;
		} else if (value > 50) {
			this._poisonStack = 50;
		} else {
			this._poisonStack = value;
		}
	}

	get defense(): number {
		return this._defense;
	}

	set defense(value: number) {
		this._defense = value < 0 ? 0 : value;
	}

	takeDamage(damage: number, playerClient: Client) {
		this.hp -= damage;
		playerClient.send('damage', {
			playerId: this.playerId,
			damage: damage,
		});
	}

	getDamageAfterReductions(
		initialDamage: number,
		playerClient: Client
	): number {
		let reducedDamage = initialDamage * (100 / (100 + this.defense));
		this.damageToTake = reducedDamage;
		const onDamageTalents: Talent[] = this.talents.filter((talent) =>
			talent.tags.includes('on-damage')
		);

		const onDamageTalentBehaviorContext: TalentBehaviorContext = {
			client: playerClient,
			defender: this,
			damage: reducedDamage,
		};
		onDamageTalents.forEach((talent) => {
			talent.executeBehavior(onDamageTalentBehaviorContext);
		});
		reducedDamage = Math.max(this.damageToTake, 1);
		return reducedDamage;
	}

	getNumberOfArmorItems(): number {
		return this.inventory.reduce((count, item) => {
			if (item.tags.includes('armor')) {
				return count + 1;
			}
			return count;
		}, 0);
	}

	getNumberOfMeleeWeapons(): number {
		return this.inventory.reduce((count, item) => {
			if (item.tags.includes('weapon') && item.tags.includes('melee')) {
				return count + 1;
			}
			return count;
		}, 0);
	}

	getNumberOfWeapons(): number {
		return this.inventory.reduce((count, item) => {
			if (item.tags.includes('weapon')) {
				return count + 1;
			}
			return count;
		}, 0);
	}

	resetInventory() {
		this.inventory.splice(0, this.inventory.length, ...this.initialInventory);
	}

	addPoisonStacks(
		clock: ClockTimer,
		playerClient: Client,
		activationRate: number,
		stack: number = 1
	) {
		this.poisonStack += stack;
		playerClient.send(
			'combat_log',
			`${this.name} is poisoned! ${this.poisonStack} stacks!`
		);

		clock.setTimeout(() => {
			this.poisonStack -= stack;
			if (this.poisonStack === 0 && this.poisonTimer) {
				this.poisonTimer.clear();
				this.poisonTimer = null;
			}
		}, 10000);
		if (!this.poisonTimer) {
			this.poisonTimer = clock.setInterval(() => {
				const poisonDamage =
					this.poisonStack *
					(activationRate * this.maxHp + activationRate * 100) *
					0.1;
				this.hp -= poisonDamage;
				playerClient.send(
					'combat_log',
					`${this.name} takes ${poisonDamage} poison damage!`
				);
				playerClient.send('damage', {
					playerId: this.playerId,
					damage: poisonDamage,
				});
			}, 1000);
		}
	}

	public tryAttack(defender: Player, playerClient: Client, clock: ClockTimer) {
		const damage = defender.getDamageAfterReductions(this.attack, playerClient);

		const attackTalentContext: TalentBehaviorContext = {
			client: playerClient,
			attacker: this,
			defender: defender,
			damage: damage,
			clock: clock,
		};

		if (defender.dodgeRate > 0 && Math.random() < defender.dodgeRate) {
			const dodgeRateCache = defender.dodgeRate;
			defender.dodgeRate = 0;
      
			clock.setTimeout(() => {
				defender.dodgeRate = dodgeRateCache;
			}, 1500);

      playerClient.send(
        'combat_log',
        `${defender.name} dodged the attack!`
      );

			return;
		}

		//handle on attacked talents
		const talentsToTriggerOnDefender: Talent[] = defender.talents.filter(
			(talent) => talent.tags.includes('on-attacked')
		);
		talentsToTriggerOnDefender.forEach((talent) => {
			talent.executeBehavior(attackTalentContext);
		});

		//handle on attack talents
		const talentsToTrigger: Talent[] = this.talents.filter((talent) =>
			talent.tags.includes('on-attack')
		);
		talentsToTrigger.forEach((talent) => {
			talent.executeBehavior(attackTalentContext);
		});

		defender.takeDamage(defender.damageToTake, playerClient);

		//broadcast attack and damage
		playerClient.send(
			'combat_log',
			`${this.name} attacks ${defender.name} for ${damage} damage!`
		);
		playerClient.send('attack', this.playerId);
	}
}
