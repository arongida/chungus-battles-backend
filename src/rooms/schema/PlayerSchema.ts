import { Schema, type, ArraySchema } from '@colyseus/schema';
import { Talent } from './TalentSchema';
import { Item } from './ItemSchema';
import { Stats, TalentType, increaseStats } from '../../utils/utils';
import { Client, Delayed } from 'colyseus';
import ClockTimer from '@gamestdio/timer';

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
	initialStats: Stats = { hp: 0, attack: 0, defense: 0, attackSpeed: 0 };
	initialInventory: Item[] = [];
	private _poisonStack: number = 0;
	maxHp: number;
	attackTimer: Delayed;
	poisonTimer: Delayed;
	talentsOnCooldown: TalentType[] = [];

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

	takeDamage(damage: number, playerClient: Client): number {
		let reducedDamage = damage * (100 / (100 + this.defense));
		const armorAddictTalent = this.talents.find(
			(talent) => talent.talentId === TalentType.ArmorAddict
		);
		if (armorAddictTalent) {
			const armorAddictReduction =
				armorAddictTalent.activationRate * this.getNumberOfArmorItems();
			reducedDamage -= Math.round(armorAddictReduction);
		}
		reducedDamage = Math.max(reducedDamage, 1);
		this.hp -= reducedDamage;
		playerClient.send('damage', {
			playerId: this.playerId,
			damage: reducedDamage,
		});
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

	disarmWeapon(playerClient: Client, attacker: Player) {
		const weapons: Item[] = this.inventory.filter((item) =>
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

			increaseStats(this, mostExpensiveWeapon.affectedStats, -1);
			playerClient.send(
				'combat_log',
				`${this.name} is disarmed! ${mostExpensiveWeapon.name} is disabled for the fight!`
			);
		} else {
			playerClient.send('combat_log', `${this.name} has no weapons to disarm!`);
		}
		playerClient.send('trigger_talent', {
			playerId: attacker.playerId,
			talentId: TalentType.Disarm,
		});
	}

	resetInventory() {
		this.inventory.splice(0, this.inventory.length, ...this.initialInventory);
	}

	addPoison(
		clock: ClockTimer,
		playerClient: Client,
		activationRate: number,
		attacker: Player,
    stack: number = 1
	) {
		this.poisonStack += stack;
		playerClient.send(
			'combat_log',
			`${this.name} is poisoned! ${this.poisonStack} stacks!`
		);
		playerClient.send('trigger_talent', {
			playerId: attacker.playerId,
			talentId: TalentType.Poison,
		});
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
					this.poisonStack * ((activationRate * this.maxHp) + (activationRate * 100)) * 0.1;
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

	eyeForAnEye(
		playerClient: Client,
		attacker: Player,
		eyeForAnEyeTalent: Talent,
		damage: number,
		clock: ClockTimer
	) {
		if (this.talentsOnCooldown.includes(TalentType.EyeForAnEye)) {
			console.log('Eye for an eye is on cooldown');
			return;
		}
		const random = Math.random();
		if (random < eyeForAnEyeTalent.activationRate) {
			attacker.hp -= damage;
			playerClient.send(
				'combat_log',
				`${this.name} reflects ${damage} damage to ${attacker.name}!`
			);
			playerClient.send('trigger_talent', {
				playerId: this.playerId,
				talentId: TalentType.EyeForAnEye,
			});
			playerClient.send('damage', {
				playerId: attacker.playerId,
				damage: damage,
			});
			this.talentsOnCooldown.push(TalentType.EyeForAnEye);
			clock.setTimeout(() => {
				this.talentsOnCooldown = this.talentsOnCooldown.filter(
					(talent) => talent !== TalentType.EyeForAnEye
				);
			}, 1000);
		}
	}

	thornyDamage(
		playerClient: Client,
		damage: number,
		thornyFenceTalent: Talent,
		attacker: Player
	) {
		const reflectDamage =
			damage * (0.2 + this.defense * thornyFenceTalent.activationRate * 0.01);
		attacker.hp -= reflectDamage;
		playerClient.send(
			'combat_log',
			`${this.name} reflects ${reflectDamage} damage to ${attacker.name}!`
		);
		playerClient.send('trigger_talent', {
			playerId: this.playerId,
			talentId: TalentType.ThornyFence,
		});
		playerClient.send('damage', {
			playerId: attacker.playerId,
			damage: reflectDamage,
		});
	}

	recoverHp(playerClient: Client, resilienceTalent: Talent) {
		const healingAmount = 1 + resilienceTalent.activationRate * this.maxHp;
		this.hp += healingAmount;
		playerClient.send(
			'combat_log',
			`${this.name} recovers ${healingAmount} health!`
		);
		playerClient.send('trigger_talent', {
			playerId: this.playerId,
			talentId: TalentType.Resilience,
		});
		playerClient.send('healing', {
			playerId: this.playerId,
			healing: healingAmount,
		});
	}

	zealot(playerClient: Client, zealotTalent: Talent) {
		const attackSpeedBuff =
			0.02 + this.defense * zealotTalent.activationRate * 0.01;
		const normalizedValue = Math.round(attackSpeedBuff * 100) / 100;
		this.attackSpeed += normalizedValue;
		playerClient.send(
			'combat_log',
			`${this.name} gains ${normalizedValue} attack speed!`
		);
		playerClient.send('trigger_talent', {
			playerId: this.playerId,
			talentId: TalentType.Zealot,
		});
	}

	onAttacked(
		clock: ClockTimer,
		playerClient: Client,
		attacker: Player,
		damage: number
	) {
		const poisonTalent = attacker.talents.find(
			(talent) => talent.talentId === TalentType.Poison
		);
		if (poisonTalent)
			this.addPoison(
				clock,
				playerClient,
				poisonTalent.activationRate,
				attacker
			);

		const thornyFenceTalent = this.talents.find(
			(talent) => talent.talentId === TalentType.ThornyFence
		);
		if (thornyFenceTalent) {
			this.thornyDamage(playerClient, damage, thornyFenceTalent, attacker);
		}

		const resilienceTalent = this.talents.find(
			(talent) => talent.talentId === TalentType.Resilience
		);
		if (resilienceTalent) {
			this.recoverHp(playerClient, resilienceTalent);
		}

		const zealotTalent = this.talents.find(
			(talent) => talent.talentId === TalentType.Zealot
		);
		if (zealotTalent) {
			this.zealot(playerClient, zealotTalent);
		}

		const eyeForAnEyeTalent = this.talents.find(
			(talent) => talent.talentId === TalentType.EyeForAnEye
		);
		if (eyeForAnEyeTalent) {
			this.eyeForAnEye(
				playerClient,
				attacker,
				eyeForAnEyeTalent,
				damage,
				clock
			);
		}
	}
}
