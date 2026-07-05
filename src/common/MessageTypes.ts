export type DamageType = 'normal' | 'poison' | 'burn';

export type DamageMessage = {
  playerId: number;
  damage: number;
  type?: DamageType;
};

export type InvulnerableMessage = {
  playerId: number;
  damage: number;
};

export type InvulnerableStateMessage = {
  playerId: number;
  invincible: boolean;
};

export type HealingMessage = {
  playerId: number;
  healing: number;
};

/** Fired whenever a player gains gold and/or xp, so the client can pop floating
 *  +gold/+xp text over the player's avatar (during fight or shop round). Gains only —
 *  spends are not represented here. Either field may be omitted if not gained. */
export type RewardGainMessage = {
  playerId: number;
  gold?: number;
  xp?: number;
};

export type LossRewardChoice = 'gold' | 'xp' | 'item_upgrade';

/** Offered to the losing player on end_battle — pick one via select_loss_reward. */
export type LossRewardOptions = {
  goldAmount: number;
  xpAmount: number; // 20% more than gold — gold is the more flexible pick
  itemUpgradeAvailable: boolean;
};

export type SelectLossRewardMessage = {
  choice: LossRewardChoice;
};

export type SetFightSpeedMessage = {
  speed: number;
};

/** Resolution of the loss-reward choice; for item_upgrade reveals which item got upgraded. */
export type LossRewardResultMessage = {
  choice: LossRewardChoice;
  gold?: number;
  xp?: number;
  item?: { itemId: number; name: string; rarity: number };
};

export type TriggerTalentMessage = {
  playerId: number;
  talentId: number;
};

export type VersionWinMessage = {
  wins: number;
  season: number;
};

export type CombatLogKind =
  | 'countdown' | 'fight_start' | 'fight_end' | 'end_burn'
  | 'attack' | 'dodge' | 'counter'
  | 'regen' | 'poison_apply' | 'poison_tick'
  | 'burn_apply' | 'burn_tick'
  | 'heal' | 'leech'
  | 'talent' | 'item'
  | 'invulnerable'
  | 'reward' | 'xp' | 'result';

export type CombatLogMessage = {
  text: string;
  kind: CombatLogKind;
  // Monotonic sequence number stamped by FightRoom's send/broadcast wrappers.
  // Combat logs are sent via a mix of buffered broadcast() and immediate
  // client.send(), which can arrive out of order on the client — seq lets the
  // client reorder them deterministically.
  seq?: number;
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
  burnStacks?: number;
  goldDelta?: number;
  xpDelta?: number;
  result?: 'win' | 'lose' | 'draw';
};

export type FightSideStats = {
  damageDealt: { weapon: number; burn: number; poison: number };
  healingReceived: number;
  damageReducedByDefense: number;
  damageReducedByFlat: number;
  attacksDodged: number;
};

export type FightStatsMessage = {
  player: FightSideStats;
  enemy: FightSideStats;
};

export function fmt(n: number): string {
  return parseFloat(n.toFixed(2)).toString();
}