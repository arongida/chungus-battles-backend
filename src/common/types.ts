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