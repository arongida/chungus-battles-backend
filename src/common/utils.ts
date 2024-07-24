export function delay(ms: number, clock: any): Promise<void> {
	return new Promise((resolve) => clock.setTimeout(resolve, ms));
}



export function increaseStats(entity: any, stats: any, multiplier = 1) {
	entity.hp += multiplier * stats.hp;
	entity.attack += multiplier * stats.attack;
	entity.defense += multiplier * stats.defense;
	entity.attackSpeed += multiplier * stats.attackSpeed;
  if (entity.maxHp) entity.maxHp += multiplier * stats.hp;
}

export function setStats(entity: any, stats: any) {
	entity.hp = stats.hp;
	entity.attack = stats.attack;
	entity.defense = stats.defense;
	entity.attackSpeed = stats.attackSpeed;
  if (entity.maxHp) entity.maxHp = stats.hp;
}


