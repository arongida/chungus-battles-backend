export type DamageMessage = {
  playerId: number;
  damage: number;
};

export type HealingMessage = {
  playerId: number;
  healing: number;
};

export type TriggerTalentMessage = {
  playerId: number;
  talentId: number;
};

export type VersionWinMessage = {
  wins: number;
};

export type CombatLogKind =
  | 'countdown' | 'fight_start' | 'fight_end' | 'end_burn'
  | 'attack' | 'dodge'
  | 'regen' | 'poison_apply' | 'poison_tick'
  | 'heal' | 'leech'
  | 'talent' | 'item'
  | 'reward' | 'result';

export type CombatLogMessage = {
  text: string;
  kind: CombatLogKind;
  attackerId?: number;
  defenderId?: number;
  weaponItemId?: number;
  itemId?: number;
  talentId?: number;
  slot?: string;
  damage?: number;
  rolledDamage?: number;
  mitigatedDamage?: number;
  defenderHpAfter?: number;
  healing?: number;
  poisonStacks?: number;
  goldDelta?: number;
  result?: 'win' | 'lose' | 'draw';
};

export function fmt(n: number): string {
  return parseFloat(n.toFixed(2)).toString();
}