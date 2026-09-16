import mongoose, { PipelineStage, Schema } from 'mongoose';

/**
 * Telemetry for bot-played runs. One document per run, with an embedded `rounds[]` array — a
 * 15-20 round run is well under 50KB, far under the 16MB document cap, and keeping everything on
 * one document means every aggregation below is single-collection (no $lookup), which matters on
 * the project's shared-tier Atlas cluster (see [[project_atlas_sort_limit]]: 32MB in-memory sort
 * cap, allowDiskUse ignored — every aggregation here sorts only its small post-$group result,
 * never a pre-group intermediate).
 *
 * Write volume is ~1 (insert) + N (one $push per round) + 1 (final $set) per run — not one write
 * per decision, which would be the volume-scaling mistake to avoid here.
 */

export interface BotDecisionRecord {
    step: number;
    type: string;
    itemId?: number;
    uid?: number;
    talentId?: number;
    slot?: string;
    rejected: boolean;
    reason?: string;
    /** Matters once a policy is an LLM — always 0 for the synchronous heuristic. */
    latencyMs: number;
}

export interface BotFightRecord {
    result: 'win' | 'lose' | 'draw';
    durationMs: number;
    enemyPlayerId?: number;
    enemyOriginalPlayerId?: number;
    enemyName?: string;
    enemyIsBot?: boolean;
    damageDealt: number;
    damageTaken: number;
    healingReceived: number;
    attacksDodged: number;
    damageBlocked: number;
    empoweredDamage: number;
    replayId?: string;
}

export interface BotRoundRecord {
    round: number;
    level: number;
    livesBefore: number;
    livesAfter: number;
    goldStart: number;
    goldEnd: number;
    rerollsThisRound: number;
    talentIdsOwned: number[];
    equippedItemIds: number[];
    equippedRarities: number[];
    decisions: BotDecisionRecord[];
    fight?: BotFightRecord;
    lossRewardChoice?: 'gold' | 'xp' | 'item_upgrade';
}

export interface BotRunEquippedSummary {
    slot: string;
    itemId: number;
    rarity: number;
    skillId: number;
    class: string;
}

/** Measured per-talent contribution at the end of a run — the ground truth a policy's talent
 *  valuations can be checked against (a talent the policy rates highly but that never actually
 *  fires is a stale hint, not a good pick). */
export interface BotRunTalentEffectiveness {
    talentId: number;
    totalActivations: number;
    totalDamageDealt: number;
    totalHealingDone: number;
    totalGoldGained: number;
}

const BotDecisionSchema = new Schema<BotDecisionRecord>(
    { step: Number, type: String, itemId: Number, uid: Number, talentId: Number, slot: String, rejected: Boolean, reason: String, latencyMs: Number },
    { _id: false },
);

const BotFightSchema = new Schema<BotFightRecord>(
    {
        result: String, durationMs: Number,
        enemyPlayerId: Number, enemyOriginalPlayerId: Number, enemyName: String, enemyIsBot: Boolean,
        damageDealt: Number, damageTaken: Number, healingReceived: Number,
        attacksDodged: Number, damageBlocked: Number, empoweredDamage: Number, replayId: String,
    },
    { _id: false },
);

const BotRoundSchema = new Schema<BotRoundRecord>(
    {
        round: Number, level: Number, livesBefore: Number, livesAfter: Number,
        goldStart: Number, goldEnd: Number, rerollsThisRound: Number,
        talentIdsOwned: [Number], equippedItemIds: [Number], equippedRarities: [Number],
        decisions: [BotDecisionSchema],
        fight: BotFightSchema,
        lossRewardChoice: String,
    },
    { _id: false },
);

const BotRunSchema = new Schema({
    runId: { type: String, required: true, unique: true },
    batchId: String,
    policyId: { type: String, required: true },
    policyVersion: String,
    // Set by policies that vary their weights per run (heuristic-v2). Null on v1 rows, which is
    // itself a useful grouping — see getArchetypeWinRates.
    archetypeId: String,
    seed: Number,
    // Identifies the tunable set, so a tuning pass is separable without bumping policyVersion.
    policyConfigHash: String,
    startedAt: { type: Date, default: Date.now },
    finishedAt: Date,
    gameVersion: Number,
    env: String, // 'dev' | 'prod' — see BotRunner's NODE_ENV handling
    // Forced to the production value (8) by BotRunner regardless of NODE_ENV — recorded so a run
    // predating that fix (dev's 1000-gold default, which makes a bot buy out the whole shop every
    // round) is identifiable rather than silently mixed into the same aggregations.
    startingGold: Number,
    timeScale: Number,
    originalPlayerId: Number,
    playerId: Number,
    name: String,
    avatarUrl: String,
    outcome: { type: String, default: 'aborted' }, // 'win' | 'dead' | 'aborted' | 'error'
    errorMessage: String,
    finalRound: Number,
    finalLevel: Number,
    wins: Number,
    losses: Number,
    finalTalentIds: [Number],
    finalEquipped: [{ slot: String, itemId: Number, rarity: Number, skillId: Number, class: String, _id: false }],
    finalTalentEffectiveness: [{
        talentId: Number, totalActivations: Number, totalDamageDealt: Number,
        totalHealingDone: Number, totalGoldGained: Number, _id: false,
    }],
    // Talent/skill ids the policy had no valuation for. Nonzero means the catalogs have drifted
    // behind the game — visible in production telemetry even if CI never ran.
    unknownHintIds: [Number],
    rounds: [BotRoundSchema],
});

// Prefixed on policyId, so it also serves the policy-only queries the old index covered.
BotRunSchema.index({ policyId: 1, archetypeId: 1, startedAt: -1 });
BotRunSchema.index({ gameVersion: 1, outcome: 1 });

export const botRunModel = mongoose.model('BotRun', BotRunSchema);

export interface CreateBotRunInput {
    runId: string;
    batchId?: string;
    policyId: string;
    policyVersion: string;
    gameVersion: number;
    env: 'dev' | 'prod';
    startingGold: number;
    timeScale: number;
    originalPlayerId: number;
    playerId: number;
    name: string;
    avatarUrl: string;
    archetypeId?: string;
    seed?: number;
}

export async function createBotRunDoc(data: CreateBotRunInput): Promise<void> {
    await botRunModel.create({
        ...data,
        startedAt: new Date(),
        outcome: 'aborted', // overwritten by finishBotRun; a crash mid-run leaves this as the honest last-known outcome
        finalTalentIds: [],
        finalEquipped: [],
        finalTalentEffectiveness: [],
        unknownHintIds: [],
        rounds: [],
    });
}

export async function pushBotRound(runId: string, round: BotRoundRecord): Promise<void> {
    await botRunModel.updateOne({ runId }, { $push: { rounds: round } });
}

export interface FinishBotRunInput {
    outcome: 'win' | 'dead' | 'aborted' | 'error';
    errorMessage?: string;
    finalRound: number;
    finalLevel: number;
    wins: number;
    losses: number;
    finalTalentIds: number[];
    finalEquipped: BotRunEquippedSummary[];
    finalTalentEffectiveness?: BotRunTalentEffectiveness[];
    unknownHintIds?: number[];
    policyConfigHash?: string;
}

export async function finishBotRun(runId: string, data: FinishBotRunInput): Promise<void> {
    await botRunModel.updateOne({ runId }, { $set: { ...data, finishedAt: new Date() } });
}

// ---------------------------------------------------------------------------------------------
// Aggregations — answer the balance questions bot telemetry exists for. Every pipeline here
// sorts only its (small) post-$group result, per the Atlas shared-tier constraint noted above.
// ---------------------------------------------------------------------------------------------

export interface TalentWinRateRow {
    talentId: number;
    runs: number;
    wins: number;
    winRate: number;
    avgRound: number;
}

/** Win rate by talent — the direct answer to "is this talent overtuned?". `minRuns` is a
 *  significance floor: below it, a talent's row is noise, not signal. */
export async function getTalentWinRates(opts: {
    gameVersion?: number;
    policyId?: string;
    archetypeId?: string;
    minRuns?: number;
} = {}): Promise<TalentWinRateRow[]> {
    const { gameVersion, policyId, archetypeId, minRuns = 20 } = opts;
    const match: Record<string, any> = { outcome: { $in: ['win', 'dead'] } };
    if (gameVersion !== undefined) match.gameVersion = gameVersion;
    if (policyId !== undefined) match.policyId = policyId;
    if (archetypeId !== undefined) match.archetypeId = archetypeId;

    const pipeline: PipelineStage[] = [
        { $match: match },
        { $project: { finalTalentIds: 1, finalRound: 1, won: { $eq: ['$outcome', 'win'] } } },
        { $unwind: '$finalTalentIds' },
        {
            $group: {
                _id: '$finalTalentIds',
                runs: { $sum: 1 },
                wins: { $sum: { $cond: ['$won', 1, 0] } },
                avgRound: { $avg: '$finalRound' },
            },
        },
        { $match: { runs: { $gte: minRuns } } },
        { $addFields: { winRate: { $divide: ['$wins', '$runs'] } } },
        { $sort: { winRate: -1 } }, // post-group result is small (at most the talent catalog's size) — safe to sort
        { $project: { _id: 0, talentId: '$_id', runs: 1, wins: 1, winRate: 1, avgRound: 1 } },
    ];
    return botRunModel.aggregate(pipeline).exec();
}

export interface ItemFrequencyRow {
    itemId: number;
    count: number;
}

/** Item frequency among rounds at/above `minRound` — pair a call at a high threshold with one at
 *  a low threshold and diff the two to see what actually correlates with surviving, not just
 *  what's common overall (a common early item is common everywhere by construction). */
export async function getItemFrequencyAtRound(opts: {
    minRound: number;
    gameVersion?: number;
    policyId?: string;
    archetypeId?: string;
}): Promise<ItemFrequencyRow[]> {
    const { minRound, gameVersion, policyId, archetypeId } = opts;
    const runMatch: Record<string, any> = { finalRound: { $gte: minRound } };
    if (gameVersion !== undefined) runMatch.gameVersion = gameVersion;
    if (policyId !== undefined) runMatch.policyId = policyId;
    if (archetypeId !== undefined) runMatch.archetypeId = archetypeId;

    const pipeline: PipelineStage[] = [
        { $match: runMatch },
        { $unwind: '$rounds' },
        { $match: { 'rounds.round': { $gte: minRound } } },
        { $unwind: '$rounds.equippedItemIds' },
        { $sortByCount: '$rounds.equippedItemIds' }, // $group + a $sort over its OWN small result — not a pre-group sort
        { $project: { _id: 0, itemId: '$_id', count: 1 } },
    ];
    return botRunModel.aggregate(pipeline).exec();
}

export interface RoundFightHealthRow {
    round: number;
    fights: number;
    wins: number;
    winRate: number;
    vsBot: number;
    vsBotRate: number;
    avgDurationMs: number;
}

/** Per-round fight outcomes AND the fraction of fights against another bot — the direct monitor
 *  for the matchmaking-pool-flooding risk (see the plan's Risks section): a healthy pool should
 *  see vsBotRate track roughly the bot-character-to-human-character ratio, not spike far above it
 *  at any one round. */
export async function getPerRoundFightHealth(opts: {
    gameVersion?: number;
    policyId?: string;
    archetypeId?: string;
} = {}): Promise<RoundFightHealthRow[]> {
    const { gameVersion, policyId, archetypeId } = opts;
    const match: Record<string, any> = {};
    if (gameVersion !== undefined) match.gameVersion = gameVersion;
    if (policyId !== undefined) match.policyId = policyId;
    if (archetypeId !== undefined) match.archetypeId = archetypeId;

    const pipeline: PipelineStage[] = [
        ...(Object.keys(match).length ? [{ $match: match }] as PipelineStage[] : []),
        { $unwind: '$rounds' },
        { $match: { 'rounds.fight': { $exists: true } } },
        {
            $group: {
                _id: '$rounds.round',
                fights: { $sum: 1 },
                wins: { $sum: { $cond: [{ $eq: ['$rounds.fight.result', 'win'] }, 1, 0] } },
                vsBot: { $sum: { $cond: ['$rounds.fight.enemyIsBot', 1, 0] } },
                avgDurationMs: { $avg: '$rounds.fight.durationMs' },
            },
        },
        {
            $addFields: {
                winRate: { $divide: ['$wins', '$fights'] },
                vsBotRate: { $divide: ['$vsBot', '$fights'] },
            },
        },
        { $sort: { _id: 1 } }, // post-group result has at most a few dozen rows (one per round reached)
        { $project: { _id: 0, round: '$_id', fights: 1, wins: 1, winRate: 1, vsBot: 1, vsBotRate: 1, avgDurationMs: 1 } },
    ];
    return botRunModel.aggregate(pipeline).exec();
}

export interface ArchetypeWinRateRow {
    archetypeId: string | null;
    runs: number;
    wins: number;
    winRate: number;
    avgRound: number;
    avgFinalLevel: number;
}

/** Win rate per build archetype. Rows from a policy that doesn't vary its build (heuristic-v1)
 *  group under a null archetypeId, which is a useful baseline row rather than a gap. */
export async function getArchetypeWinRates(opts: {
    gameVersion?: number;
    policyId?: string;
    minRuns?: number;
} = {}): Promise<ArchetypeWinRateRow[]> {
    const { gameVersion, policyId, minRuns = 10 } = opts;
    const match: Record<string, any> = { outcome: { $in: ['win', 'dead'] } };
    if (gameVersion !== undefined) match.gameVersion = gameVersion;
    if (policyId !== undefined) match.policyId = policyId;

    const pipeline: PipelineStage[] = [
        { $match: match },
        {
            $group: {
                _id: { $ifNull: ['$archetypeId', null] },
                runs: { $sum: 1 },
                wins: { $sum: { $cond: [{ $eq: ['$outcome', 'win'] }, 1, 0] } },
                avgRound: { $avg: '$finalRound' },
                avgFinalLevel: { $avg: '$finalLevel' },
            },
        },
        { $match: { runs: { $gte: minRuns } } },
        { $addFields: { winRate: { $divide: ['$wins', '$runs'] } } },
        { $sort: { winRate: -1 } }, // at most one row per archetype
        { $project: { _id: 0, archetypeId: '$_id', runs: 1, wins: 1, winRate: 1, avgRound: 1, avgFinalLevel: 1 } },
    ];
    return botRunModel.aggregate(pipeline).exec();
}

export interface PolicyComparisonRow {
    policyId: string;
    policyVersion: string;
    archetypeId: string | null;
    policyConfigHash: string | null;
    runs: number;
    wins: number;
    winRate: number;
    avgRound: number;
    unknownHintRuns: number;
}

/**
 * The head-to-head readout for a policy A/B. Group by policy first, then archetype, so a v2 lift
 * can be attributed rather than just observed.
 *
 * Caveat when reading it: matchmaking draws opponents from all same-round characters, so two
 * policies run CONCURRENTLY fight each other's bots and their win rates stop being independent.
 * Run the arms as alternating batches, and sanity-check vsBotRate per policy with
 * getPerRoundFightHealth before believing a delta.
 */
export async function getPolicyComparison(opts: {
    gameVersion?: number;
    minRuns?: number;
} = {}): Promise<PolicyComparisonRow[]> {
    const { gameVersion, minRuns = 10 } = opts;
    const match: Record<string, any> = { outcome: { $in: ['win', 'dead'] } };
    if (gameVersion !== undefined) match.gameVersion = gameVersion;

    const pipeline: PipelineStage[] = [
        { $match: match },
        {
            $group: {
                _id: {
                    policyId: '$policyId',
                    policyVersion: '$policyVersion',
                    archetypeId: { $ifNull: ['$archetypeId', null] },
                    policyConfigHash: { $ifNull: ['$policyConfigHash', null] },
                },
                runs: { $sum: 1 },
                wins: { $sum: { $cond: [{ $eq: ['$outcome', 'win'] }, 1, 0] } },
                avgRound: { $avg: '$finalRound' },
                unknownHintRuns: {
                    $sum: { $cond: [{ $gt: [{ $size: { $ifNull: ['$unknownHintIds', []] } }, 0] }, 1, 0] },
                },
            },
        },
        { $match: { runs: { $gte: minRuns } } },
        { $addFields: { winRate: { $divide: ['$wins', '$runs'] } } },
        { $sort: { winRate: -1 } }, // a handful of rows: policies x archetypes
        {
            $project: {
                _id: 0,
                policyId: '$_id.policyId', policyVersion: '$_id.policyVersion',
                archetypeId: '$_id.archetypeId', policyConfigHash: '$_id.policyConfigHash',
                runs: 1, wins: 1, winRate: 1, avgRound: 1, unknownHintRuns: 1,
            },
        },
    ];
    return botRunModel.aggregate(pipeline).exec();
}
