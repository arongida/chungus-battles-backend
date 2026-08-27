export const GAME_VERSION = 26;

/** Reaching this many wins ends the run as a victory (Season 16 fixed-length runs). */
export const WINS_TO_WIN = 12;

/** Game-time (ms) a fight can run before the escalating "end burn" AoE kicks in to force a conclusion. */
export const END_BURN_START_MS = 60000;

export enum FightResultType {
	WIN = 'win',
	LOSE = 'lose',
	DRAW = 'draw',
}

export interface IStats {
	hp: number;
	strength: number;
  	accuracy: number;
	defense: number;
	dodgeRate: number;
	attackSpeed: number;
	income: number;
	hpRegen: number;
	cooldownReduction: number;
	maxHp?: number;
	baseAttackSpeed?: number;
}

export enum TriggerType {
	LEVEL_UP = 'level-up',
	SHOP_START = 'shop-start',
	SHOP_END = 'shop-end',
	ACTIVE = 'active',
	FIGHT_START = 'fight-start',
	FIGHT_END = 'fight-end',
	ON_ATTACKED = 'on-attacked',
	ON_ATTACK = 'on-attack',
	ON_DAMAGE = 'on-damage',
	AFTER_REFRESH = 'after-refresh',
	AURA = 'aura',
	ON_DODGE = 'on-dodge',
	ON_SELL = 'on-sell',
	// Mirror of ON_DODGE: fires on the player whose attack WAS dodged (not the dodger), so a
	// skill like Battle Focus can react to being evaded. Dispatched from OnDodgeTriggerCommand
	// alongside ON_DODGE itself.
	ON_ATTACK_DODGED = 'on-attack-dodged'
}
