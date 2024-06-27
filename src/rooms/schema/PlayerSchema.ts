import { Schema, type, ArraySchema } from '@colyseus/schema';
import { Talent } from './TalentSchema';
import { Item } from './ItemSchema';
import { Stats, TalentType } from '../../utils/utils';
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
	playerClient: Client;

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

	addPoison(clock: ClockTimer, playerClient: Client, activationRate: number) {
		this.poisonStack += 1;
		playerClient.send(
			'combat_log',
			`${this.name} is poisoned! ${this.poisonStack} stacks!`
		);
		clock.setTimeout(() => {
			this.poisonStack -= 1;
			if (this.poisonStack === 0 && this.poisonTimer) {
				this.poisonTimer.clear();
				this.poisonTimer = null;
			}
		}, 3000);
		if (!this.poisonTimer) {
			this.poisonTimer = clock.setInterval(() => {
				const poisonDamage = Math.round(
					this.poisonStack * activationRate * this.maxHp
				);
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

	reflectDamage(
		playerClient: Client,
		damage: number,
		thornyFenceTalent: Talent,
		attacker: Player
	) {
		const reflectDamage = Math.round(
			damage * (0.2 + this.defense * thornyFenceTalent.activationRate * 0.01)
		);
		attacker.hp -= reflectDamage;
		playerClient.send(
			'combat_log',
			`${this.name} reflects ${reflectDamage} damage to ${this.name}!`
		);
		playerClient.send('damage', {
			playerId: attacker.playerId,
			damage: reflectDamage,
		});
	}

	recoverHp(playerClient: Client, resilienceTalent: Talent) {
		const healingAmount = Math.round(
			1 + resilienceTalent.activationRate * this.maxHp
		);
		this.hp += healingAmount;
		playerClient.send(
			'combat_log',
			`${this.name} recovers ${healingAmount} health!`
		);
		playerClient.send('healing', {
			playerId: this.playerId,
			healing: healingAmount,
		});
	}

	zealot(playerClient: Client, zealotTalent: Talent) {
		const attackSpeedBuff =
			0.05 + this.defense * zealotTalent.activationRate * 0.01;
		const normalizedValue = Math.round(attackSpeedBuff * 100) / 100;
		this.attackSpeed += normalizedValue;
		playerClient.send(
			'combat_log',
			`${this.name} gains ${normalizedValue} attack speed!`
		);
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
			this.addPoison(clock, playerClient, poisonTalent.activationRate);

		const thornyFenceTalent = this.talents.find(
			(talent) => talent.talentId === TalentType.ThornyFence
		);
		if (thornyFenceTalent) {
			this.reflectDamage(playerClient, damage, thornyFenceTalent, attacker);
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
	}
}
