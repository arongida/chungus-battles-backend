import { Clock } from 'colyseus';
import { IStats } from './types';

export function delay(ms: number, clock: Clock): Promise<void> {
	return new Promise((resolve) => clock.setTimeout(resolve, ms));
}

export function increaseStats(entity: IStats, stats: IStats, multiplier = 1) {
	if (entity.maxHp && stats.hp) entity.maxHp += multiplier * stats.hp;
	if (entity.hp && stats.hp) entity.hp += multiplier * stats.hp;
	if (entity.attack && stats.attack) entity.attack += multiplier * stats.attack;
	if (entity.defense && stats.defense) entity.defense += multiplier * stats.defense;

  
	if (entity.attackSpeed && stats.attackSpeed)
		entity.attackSpeed +=
  multiplier * (stats.attackSpeed * (entity.baseAttackSpeed || 0.8) - entity.baseAttackSpeed || 0.8);
  
  entity.dodgeRate += multiplier * stats.dodgeRate;
	entity.income += multiplier * stats.income;
	entity.hpRegen += multiplier * stats.hpRegen;
}

export function setStats(entity: IStats, stats: IStats) {
	if (entity.maxHp) entity.maxHp = stats.hp;
	entity.hp = stats.hp;
	entity.attack = stats.attack;
	entity.defense = stats.defense;
	entity.dodgeRate = stats.dodgeRate;
	entity.attackSpeed = stats.attackSpeed;
	entity.income = stats.income;
	entity.hpRegen = stats.hpRegen;
}
