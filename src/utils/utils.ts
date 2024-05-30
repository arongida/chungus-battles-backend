
export function delay(ms: number, clock: any): Promise<void> {
  return new Promise((resolve) => clock.setTimeout(resolve, ms));
}

export enum FightResultType {
  WIN = "win",
  LOSE = "lose",
  DRAW = "draw"
}

export enum TalentType {
  Rage = 1,
  Greed = 2,
  RiskyInvestment = 3,
  GuardianAngel = 4,
  StealLife = 5,
  NotSoGuardianAngel = 6,
  BrokenRiskyInvestment = 7,
  Evasion = 9,
  Bandage = 10,
  ThrowMoney = 11,
  Invigorate = 13,
  SmartInvestment = 14,
  Strong = 15,
  UpperMiddleClass = 16,
  Bribe = 17,
  Execute = 18,
}