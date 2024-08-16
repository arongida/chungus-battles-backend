import { Clock } from 'colyseus';
import { IStats } from './types';

export function delay(ms: number, clock: Clock): Promise<void> {
	return new Promise((resolve) => clock.setTimeout(resolve, ms));
}

export function increaseStats(entity: IStats, stats: IStats, multiplier = 1) {
	if (entity.hp && stats.hp) entity.hp += multiplier * stats.hp;

	if (entity.attack && stats.attack) entity.attack += multiplier * stats.attack;
	if (entity.defense && stats.defense)
		entity.defense += multiplier * stats.defense;
	if (entity.attackSpeed && stats.attackSpeed)
		entity.attackSpeed +=
			multiplier *
			(stats.attackSpeed * (entity.baseAttackSpeed || 0.8) -
				entity.baseAttackSpeed || 0.8);
	if (stats.income) {
		entity.income += multiplier * stats.income;
	}
	if (entity.maxHp && stats.hp) entity.maxHp += multiplier * stats.hp;
}

export function setStats(entity: IStats, stats: IStats) {
	if (entity.hp && stats.hp) entity.hp = stats.hp;
	if (entity.attack && stats.attack) entity.attack = stats.attack;
	if (entity.defense && stats.defense) entity.defense = stats.defense;
	if (entity.attackSpeed && stats.attackSpeed)
		entity.attackSpeed = stats.attackSpeed;
	if (entity.income && stats.income) entity.income = stats.income;
	if (entity.maxHp && stats.hp) entity.maxHp = stats.hp;
}
