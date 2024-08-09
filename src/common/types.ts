export enum FightResultType {
	WIN = 'win',
	LOSE = 'lose',
	DRAW = 'draw',
}

export interface IStats {
	hp: number;
	attack: number;
	defense: number;
	attackSpeed: number;
}

export enum TriggerType {
  LEVEL_UP = 'level-up',
  SHOP_START = 'shop-start',
  ACTIVE = 'active',
  FIGHT_START = 'fight-start',
  FIGHT_END = 'fight-end',

}