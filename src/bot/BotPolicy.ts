/**
 * The bot decision-engine contract. Deliberately free of any @colyseus/*, mongoose, or
 * src/rooms/* import — everything here is plain data, so this file (and only this file) is
 * meant to be importable by a future standalone policy package (an LLM-backed policy, a trained
 * model) with zero coupling to how the game server is implemented.
 *
 * Design choices, and why (see the bot service plan for the full rationale):
 *  - Every method returns a Promise. The heuristic resolves instantly; an LLM call is a real
 *    pending promise. The driver (src/bot/BotDraftRoom.ts / BotFightRoom.ts) awaits either
 *    uniformly, so swapping the implementation never touches the driver.
 *  - Observations are plain JSON, never a live Colyseus Schema reference — a live reference
 *    would mutate underneath an async policy mid-decision (the 500ms stat tick, the 1000ms aura
 *    tick), and a serializable shape is what an LLM/trained policy needs anyway.
 *  - decideDraft returns an ORDERED BATCH, not one action — the latency accommodation for a slow
 *    (LLM) policy: a draft phase is ~8-15 decisions, and batching collapses that to a handful of
 *    calls instead of one per decision.
 */

export const OBSERVATION_SCHEMA_VERSION = 3 as const;

/** A character's class is its avatar (THIEF/WARRIOR/MERCHANT), named here by the matching
 *  item/talent class tag. */
export type BotClass = 'rogue' | 'warrior' | 'merchant';

export type EquipSlotName = 'armor' | 'helmet' | 'mainHand' | 'offHand';

export interface StatBlock {
    maxHp: number;
    hp: number;
    strength: number;
    accuracy: number;
    defense: number;
    attackSpeed: number;
    dodgeRate: number;
    hpRegen: number;
    income: number;
    cooldownReduction: number;
}

export interface ItemView {
    uid: number;
    itemId: number;
    name: string;
    description?: string;
    price: number;
    sellPrice: number;
    rarity: number;
    tier: number;
    type: string;
    class: string;
    tags: string[];
    equipOptions: string[]; // slot names, plus the pseudo-slot 'drink' for potions
    affectedStats: Partial<StatBlock>;
    affectedEnemyStats: Partial<StatBlock>;
    // Weapon damage profile. All four are inputs to FightRoom.tryWeaponAttack's roll:
    //   min = baseMinDamage + accuracy
    //   max = baseMaxDamage + bonusMaxDamage + strength * strengthScaling
    // baseAttackSpeed is a per-weapon MULTIPLICAND, not a rate: the swing interval comes from
    // `baseAttackSpeed * player.attackSpeed`, clamped at 0.1 per weapon. A shield's 0 is what
    // keeps it out of the attack timers entirely.
    baseMinDamage: number;
    baseMaxDamage: number;
    baseAttackSpeed: number;
    strengthScaling: number;
    bonusMaxDamage: number;
    // Trigger metadata — ACTIVE items (Wand of Fire, Flowering Staff, Magic Ring) proc at
    // `activationRate * (100 + cooldownReduction)/100` per second; without it cooldownReduction
    // can't be priced against anything.
    triggerTypes: string[];
    activationRate: number;
    // Shop-slot-only fields (0/false on an owned inventory/equipped item).
    upgradePreview: boolean;
    previewBaseRarity: number;
    luckyFind: boolean;
    luckyFindSteps: number;
    // Class-item skill (see items/skills/itemSkillRoller.ts).
    skillId: number;
    skillName: string;
    skillDescription: string;
    futureSkillId: number;
    futureSkillName: string;
    // The skill's LIVE measured output while equipped (written by the aura pass). A policy that
    // also estimates the skill's value from its own definition must not double-count these.
    skillAffectedStats: Partial<StatBlock>;
    skillAffectedEnemyStats: Partial<StatBlock>;
    // Second skill slot — Weapon Whisperer grants a whole extra skill, so an item carrying one is
    // worth roughly twice the skill value of an otherwise identical item.
    skillId2: number;
    skillName2: string;
    skillAffectedStats2: Partial<StatBlock>;
    skillAffectedEnemyStats2: Partial<StatBlock>;
    sold: boolean;
    equipped: boolean;
}

export interface TalentView {
    talentId: number;
    name: string;
    description?: string;
    tier: number;
    tags: string[];
    triggerTypes: string[];
    affectedStats: Partial<StatBlock>;
    affectedEnemyStats: Partial<StatBlock>;
    // The only numeric parameters most talents have: 37 of the 47 offerable talents carry no
    // affectedStats at all, and their whole effect is `base`/`scaling` applied by their behavior
    // function at `activationRate`. Any policy that scores talents needs these.
    activationRate: number;
    base: number;
    scaling: number;
    // Measured lifetime contribution. Only ever nonzero for a talent the player OWNS — the global
    // talent documents an offer is built from carry no counters, so these read 0 on every offered
    // talent. Use for keep/sell reasoning, telemetry and catalog calibration; never as an input to
    // the pick decision, where they are structurally always 0.
    totalActivations: number;
    totalDamageDealt: number;
    totalHealingDone: number;
    totalGoldGained: number;
    totalXpGained: number;
    totalHealingPrevented: number;
}

export interface PlayerView {
    playerId: number;
    originalPlayerId: number;
    name: string;
    avatarUrl: string;
    round: number;
    level: number;
    xp: number;
    maxXp: number;
    gold: number;
    lives: number;
    wins: number;
    losses: number;
    /** Optional so hand-built fixtures without it still type-check; observation.ts always sets it. */
    avatarClass?: BotClass;
    stats: StatBlock;
    // Shop-economy fields the 1s draft aura tick finalizes — see the driver's readiness gate.
    // A policy reading these before that tick has run will see base/stale values.
    refreshShopCost: number;
    freeRerollCharges: number;
    freeRerolls: boolean;
    rerollsThisRound: number;
    luckyFindChance: number;
    potionCapacity: number;
    pendingPotionEffects: number[]; // skillIds of currently-banked potion effects
    comradeFreeClaim: boolean;
    goldGenieFreeClaim: boolean;
    luckyFindFreeClaim: boolean;
    misconductFreeClaim: boolean;
    storeCreditFreeClaim: boolean;
    storeCreditFreeClaimCap: number;
    /** Whether the shop is currently locked — without it, emitting lock_shop/unlock_shop oscillates. */
    shopLocked: boolean;
    equipped: Partial<Record<EquipSlotName, ItemView>>;
    inventory: ItemView[];
    talents: TalentView[];
}

export interface EnemyPreviewView {
    name: string;
    avatarUrl: string;
    level: number;
    round: number;
}

/** The next opponent's combat build, exactly as the FULL-reveal preview shows it to a human. */
export interface EnemyBuildView {
    avatarClass?: BotClass;
    level: number;
    stats: StatBlock;
    equipped: Partial<Record<EquipSlotName, ItemView>>;
    talents: TalentView[];
}

export interface JokerPendingCard {
    stat: string;
    amount: number;
}

export interface DraftObservation {
    schemaVersion: typeof OBSERVATION_SCHEMA_VERSION;
    runId: string;
    step: number;
    round: number;
    player: PlayerView;
    shop: ItemView[];
    availableTalents: TalentView[];
    remainingTalentPoints: number;
    talentRerollUsed: boolean[]; // index-aligned with availableTalents
    canUndoSell: boolean;
    // Scouting fields, carried through for a future LLM policy — v1's HeuristicPolicy ignores
    // these entirely.
    nextEnemy: EnemyPreviewView | null;
    nextEnemyRevealLevel: number;
    nextEnemyTalentClasses: string[];
    nextEnemyItemClasses: string[];
    /** Set only at a FULL reveal (nextEnemyRevealLevel >= 100). */
    nextEnemyBuild?: EnemyBuildView | null;
    jokerPendingCards?: JokerPendingCard[];
}

export interface LossRewardObservation {
    schemaVersion: typeof OBSERVATION_SCHEMA_VERSION;
    runId: string;
    round: number;
    player: PlayerView;
    goldAmount: number;
    xpAmount: number;
    itemUpgradeAvailable: boolean;
    itemUpgradeCount: number;
}

export interface FightResultObservation {
    schemaVersion: typeof OBSERVATION_SCHEMA_VERSION;
    runId: string;
    round: number;
    result: 'win' | 'lose' | 'draw';
    livesAfter: number;
    winsAfter: number;
}

export interface RunEndObservation {
    schemaVersion: typeof OBSERVATION_SCHEMA_VERSION;
    runId: string;
    outcome: 'win' | 'dead' | 'aborted' | 'error';
    finalRound: number;
    finalLevel: number;
}

export type BotAction =
    | { type: 'buy'; itemId: number; reason?: string }
    | { type: 'sell'; uid: number; reason?: string }
    | { type: 'undo_sell'; reason?: string }
    | { type: 'equip'; uid: number; slot: EquipSlotName | 'drink'; reason?: string }
    | { type: 'unequip'; uid: number; slot: EquipSlotName; reason?: string }
    | { type: 'refresh_shop'; reason?: string }
    | { type: 'buy_xp'; reason?: string }
    | { type: 'level_up'; reason?: string }
    | { type: 'select_talent'; talentId: number; reason?: string }
    | { type: 'refresh_talent_slot'; talentId: number; reason?: string }
    | { type: 'joker_pick'; stat: string; reason?: string }
    | { type: 'lock_shop'; reason?: string }
    | { type: 'unlock_shop'; reason?: string }
    | { type: 'end_draft'; reason?: string };

export type LossRewardChoice = 'gold' | 'xp' | 'item_upgrade';

/** Drained by the runner at the end of a run and recorded on the BotRun doc. Lets a policy report
 *  gaps in its own knowledge (a talent it had no hint for) as telemetry rather than silence. */
export interface PolicyDiagnostics {
    unknownHintIds: number[];
    /** Identifies the tunable set this run used, so a tuning pass stays separable in aggregations
     *  without hand-bumping `version`. */
    policyConfigHash?: string;
}

export interface BotPolicy {
    /** Stable id recorded on every telemetry doc — e.g. 'heuristic-v1', later 'llm-sonnet-v2'. */
    readonly id: string;
    readonly version: string;
    /** Set only by a policy that varies its weights per run — recorded for per-archetype telemetry. */
    readonly archetypeId?: string;
    readonly seed?: number;
    /** Set only by a policy that plays a specific class — the runner creates the character with it. */
    readonly avatarClass?: BotClass;

    /**
     * Plans the next chunk of the CURRENT draft phase as an ordered batch. The driver applies
     * each action in order, re-observes after each one, and calls this again — until it returns
     * `[]`, an `{type:'end_draft'}` action, or a driver-side step cap is hit.
     */
    decideDraft(obs: DraftObservation): Promise<BotAction[]>;

    /** Called only when the server has set `lossRewardPending` (a survivable loss). */
    decideLossReward(obs: LossRewardObservation): Promise<LossRewardChoice>;

    /** Optional logging/learning hook. Never affects the run either way. */
    onFightResult?(obs: FightResultObservation): void | Promise<void>;
    /** Optional. Lets a policy persist cross-run state (e.g. a trained policy's replay buffer). */
    onRunEnd?(obs: RunEndObservation): void | Promise<void>;

    /** Optional. Called once at the end of a run; whatever is returned is recorded on the BotRun. */
    drainDiagnostics?(): PolicyDiagnostics;
}
