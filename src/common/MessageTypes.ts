export type DamageType = 'normal' | 'poison' | 'burn';

// Attribution-only axis for FightStats bucketing — never sent on a message or replay event
// (DamageType still drives all client-facing rendering). 'self' is a talent/item paying its
// own cost (e.g. Stab) and is deliberately excluded from both sides' damageDealt.
export type DamageSource = 'weapon' | 'skill' | 'self';

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
  // True when a Mythic buy/upgrade just granted the permanent Lucky Find bonus — pops a
  // floating "+N% 🍀" number and a mythic fireworks burst on the avatar instead of the
  // shop card (see DraftRoom.buyItem / PlayerSchema.luckyFindMythicBonus /
  // ShopUpgradeUtils.LUCKY_FIND_MYTHIC_BONUS).
  luckyFind?: boolean;
};

export type LossRewardChoice = 'gold' | 'xp' | 'item_upgrade';

/** Offered to the losing player on end_battle — pick one via select_loss_reward. */
export type LossRewardOptions = {
  goldAmount: number;
  xpAmount: number; // 50% more than gold — gold is the more flexible pick
  itemUpgradeAvailable: boolean;
  itemUpgradeCount: number; // how many rarity-upgrade rolls this pick grants (1-3, scales with lives left)
};

export type SelectLossRewardMessage = {
  choice: LossRewardChoice;
};

export type SetFightSpeedMessage = {
  speed: number;
};

/** Resolution of the loss-reward choice; for item_upgrade reveals which item(s) got
 *  upgraded. `item` holds the first upgraded item for back-compat; `items` holds all of
 *  them (more than one when the player was on their last or second-to-last life). */
export type LossRewardResultMessage = {
  choice: LossRewardChoice;
  gold?: number;
  xp?: number;
  item?: { itemId: number; name: string; rarity: number };
  items?: { itemId: number; name: string; rarity: number }[];
};

export type TriggerTalentMessage = {
  playerId: number;
  talentId: number;
};

export type GameWinMessage = {
  wins: number;
  losses: number;
  season: number;
};

export type CombatLogKind =
  | 'countdown' | 'fight_start' | 'fight_end' | 'end_burn'
  | 'attack' | 'dodge' | 'counter' | 'block'
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
  // Fight-elapsed game time in ms at the moment this entry was emitted (0 before the battle
  // starts), stamped alongside seq by FightRoom.stampCombatLogMeta. Lets the client show a
  // timestamp next to each log line.
  t?: number;
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
  damageDealt: { weapon: number; skill: number; burn: number; poison: number };
  healingReceived: number;
  damageReducedByDefense: number;
  attacksDodged: number;
  damageBlockedByInvincible: number;
  attacksBlocked: number;
  damageBlocked: number;
  empoweredAttacks: number;
  empoweredDamage: number;
};

export type FightStatsMessage = {
  player: FightSideStats;
  enemy: FightSideStats;
};

// Replay-only pseudo-event (see replay/StatsSyncRecorder.ts). NEVER sent to a live client — live
// clients get all of this via Colyseus schema sync every tick; replay playback has no schema
// sync, so the room folds the same information into the recorded event stream instead.
// Every value is ABSOLUTE (not a delta), but every field is OPTIONAL: only fields that changed
// since the previously emitted sync are present.
export type StatsSyncItem = {
  slot: string;
  skillStatus: string;
  // Weapon Whisperer's second skill slot (ItemSchema.ts's skillStatus2) — same "resent whenever
  // either slot's status changed" granularity as skillStatus above, not diffed independently.
  skillStatus2: string;
};

export type StatsSyncSide = {
  playerId: number;
  hp?: number;
  maxHp?: number;
  strength?: number;
  accuracy?: number;
  defense?: number;
  attackSpeed?: number;
  dodgeRate?: number;
  hpRegen?: number;
  income?: number;
  cooldownReduction?: number;
  /** Only equipped items whose live skillStatus line changed. */
  items?: StatsSyncItem[];
};

export type StatsSyncMessage = {
  player?: StatsSyncSide;
  enemy?: StatsSyncSide;
};

export function fmt(n: number): string {
  return parseFloat(n.toFixed(2)).toString();
}