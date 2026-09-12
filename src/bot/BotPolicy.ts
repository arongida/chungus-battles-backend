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

export const OBSERVATION_SCHEMA_VERSION = 1 as const;

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
    baseMinDamage: number;
    baseMaxDamage: number;
    baseAttackSpeed: number;
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

export interface BotPolicy {
    /** Stable id recorded on every telemetry doc — e.g. 'heuristic-v1', later 'llm-sonnet-v2'. */
    readonly id: string;
    readonly version: string;

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
}
