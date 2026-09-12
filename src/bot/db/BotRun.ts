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
    rounds: [BotRoundSchema],
});

BotRunSchema.index({ policyId: 1, startedAt: -1 });
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
}

export async function createBotRunDoc(data: CreateBotRunInput): Promise<void> {
    await botRunModel.create({
        ...data,
        startedAt: new Date(),
        outcome: 'aborted', // overwritten by finishBotRun; a crash mid-run leaves this as the honest last-known outcome
        finalTalentIds: [],
        finalEquipped: [],
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
    minRuns?: number;
} = {}): Promise<TalentWinRateRow[]> {
    const { gameVersion, policyId, minRuns = 20 } = opts;
    const match: Record<string, any> = { outcome: { $in: ['win', 'dead'] } };
    if (gameVersion !== undefined) match.gameVersion = gameVersion;
    if (policyId !== undefined) match.policyId = policyId;

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
}): Promise<ItemFrequencyRow[]> {
    const { minRound, gameVersion, policyId } = opts;
    const runMatch: Record<string, any> = { finalRound: { $gte: minRound } };
    if (gameVersion !== undefined) runMatch.gameVersion = gameVersion;
    if (policyId !== undefined) runMatch.policyId = policyId;

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
} = {}): Promise<RoundFightHealthRow[]> {
    const { gameVersion, policyId } = opts;
    const match: Record<string, any> = {};
    if (gameVersion !== undefined) match.gameVersion = gameVersion;
    if (policyId !== undefined) match.policyId = policyId;

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
