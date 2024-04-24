
export function delay(ms: number, clock: any): Promise<void> {
  return new Promise((resolve) => clock.setTimeout(resolve, ms));
}

export enum FightResultTypes {
  WIN = "win",
  LOSE = "lose",
  DRAW = "draw"
}