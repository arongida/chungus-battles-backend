export function delay(ms: number, clock: any): Promise<void> {
	return new Promise((resolve) => clock.setTimeout(resolve, ms));
}

export enum FightResultType {
	WIN = 'win',
	LOSE = 'lose',
	DRAW = 'draw',
}

export enum TalentType {
	Rage = 1,
	Pickpocket = 2,
	PennyStocks = 3,
	GuardianAngel = 4,
	Scam = 5,
	NotSoGuardianAngel = 6,
	BrokenPennyStocks = 7,
	Evasion = 9,
	Bandage = 10,
	ThrowMoney = 11,
	Invigorate = 13,
	SmartInvestment = 14,
	Strong = 15,
	IntimidatingWealth = 16,
	Bribe = 17,
	Execute = 18,
	EyeForAnEye = 19,
	Steal = 20,
	WeaponWhisperer = 21,
	GoldGenie = 22,
	AssassinAmusement = 23,
  Resilience = 24,
  Disarm = 25,
  ThornyFence = 26,
  Poison = 27,
  Zealot = 28,
  Stab = 29,
  Trickster = 30,
  Bear = 31,
  FutureNow = 32,
  Snitch = 33,
  Robbery = 34,
  ArmorAddict = 35,
  CorrodingCollection = 36,
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

export interface Stats {
	hp: number;
	attack: number;
	defense: number;
	attackSpeed: number;
}
