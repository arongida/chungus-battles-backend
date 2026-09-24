import mongoose, { Schema } from 'mongoose';

// One doc per fight a human-owned ghost (matchmaking snapshot) took part in, written from the
// ghost owner's point of view — the "While you were away" report. There are no accounts, so the
// address is the ghost's originalPlayerId (every snapshot keeps its origin character's id); the
// owner's browser proves it owns that character with the run's playerToken (see /ghostReport in
// app.config.ts), exactly like a room join does.
//
// Deliberately separate from Replay: replays are keyed by the *fighter* (originalPlayerId of the
// live player), and the ghost's id only exists deep inside replay.initialState.enemy (unindexed,
// and stripped by pruneSeasonReplays). This collection is small, flat and indexed for the one
// query the report needs.
const GhostEncounterSchema = new Schema({
    replayId: { type: String, required: true, unique: true },
    ownerOriginalPlayerId: { type: Number, required: true },
    ownerSnapshotRound: Number,
    opponentOriginalPlayerId: Number,
    opponentPlayerId: Number,
    opponentName: String,
    opponentAvatarUrl: String,
    opponentIsBot: { type: Boolean, default: false },
    // From the GHOST's point of view: 'win' means the ghost beat the live player.
    result: String,
    // The ghost delivered the live player's final loss (same condition as incrementRunsEnded).
    endedRun: { type: Boolean, default: false },
    // Preset reaction ids (src/social/emotes.ts) the live player sent during/after the fight.
    emotes: { type: [String], default: [] },
    createdAt: { type: Date, default: Date.now },
});

GhostEncounterSchema.index({ ownerOriginalPlayerId: 1, createdAt: -1 });
// Reports are "since you last looked" — nobody scrolls back months. Shorter than Replay's 90 days.
GhostEncounterSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 24 * 60 * 60 });

export const ghostEncounterModel = mongoose.model('GhostEncounter', GhostEncounterSchema);

export type GhostResult = 'win' | 'lose' | 'draw';

export interface GhostEncounterData {
    replayId: string;
    ownerOriginalPlayerId: number;
    ownerSnapshotRound: number;
    opponentOriginalPlayerId: number;
    opponentPlayerId: number;
    opponentName: string;
    opponentAvatarUrl: string;
    opponentIsBot: boolean;
    result: GhostResult;
    endedRun: boolean;
    emotes: string[];
}

export async function saveGhostEncounter(data: GhostEncounterData): Promise<void> {
    await ghostEncounterModel.create(data);
}

// A reaction sent after the encounter doc was written (e.g. "GG" from the post-fight modal).
// Upsert-free on purpose: if the insert hasn't landed yet the push is simply lost, which is
// acceptable for a cosmetic message. The emote count is capped upstream (FightRoom).
export async function appendGhostEncounterEmote(replayId: string, emoteId: string): Promise<void> {
    await ghostEncounterModel.updateOne({ replayId }, { $push: { emotes: emoteId } });
}

export interface GhostReportSummary {
    fights: number;
    wins: number;
    losses: number;
    draws: number;
    runsEnded: number;
    emotes: Record<string, number>;
}

export interface GhostReport {
    encounters: Record<string, any>[];
    summary: GhostReportSummary;
}

const MAX_REPORT_LIMIT = 100;

export async function getGhostReport(ownerOriginalPlayerId: number, since?: Date, limit = 50): Promise<GhostReport> {
    const match: Record<string, any> = { ownerOriginalPlayerId };
    if (since) match.createdAt = { $gt: since };
    const safeLimit = Math.min(Math.max(1, limit), MAX_REPORT_LIMIT);

    const [encounters, totals] = await Promise.all([
        ghostEncounterModel.find(match, { _id: 0, __v: 0, ownerOriginalPlayerId: 0 })
            .sort({ createdAt: -1 })
            .limit(safeLimit)
            .lean(),
        // Summary covers the whole window, not just the returned page.
        ghostEncounterModel.aggregate([
            { $match: match },
            {
                $group: {
                    _id: null,
                    fights: { $sum: 1 },
                    wins: { $sum: { $cond: [{ $eq: ['$result', 'win'] }, 1, 0] } },
                    losses: { $sum: { $cond: [{ $eq: ['$result', 'lose'] }, 1, 0] } },
                    draws: { $sum: { $cond: [{ $eq: ['$result', 'draw'] }, 1, 0] } },
                    runsEnded: { $sum: { $cond: ['$endedRun', 1, 0] } },
                    emotes: { $push: '$emotes' },
                },
            },
        ]),
    ]);

    const t = totals[0];
    const emotes: Record<string, number> = {};
    (t?.emotes ?? []).flat().forEach((id: string) => { emotes[id] = (emotes[id] ?? 0) + 1; });
    return {
        encounters,
        summary: {
            fights: t?.fights ?? 0,
            wins: t?.wins ?? 0,
            losses: t?.losses ?? 0,
            draws: t?.draws ?? 0,
            runsEnded: t?.runsEnded ?? 0,
            emotes,
        },
    };
}

/** Unseen-encounter counts for several characters at once (home-screen run list). */
export async function getGhostReportCounts(queries: { ownerOriginalPlayerId: number; since?: Date }[]): Promise<Record<number, number>> {
    if (queries.length === 0) return {};
    const rows = await ghostEncounterModel.aggregate([
        {
            $match: {
                $or: queries.map(q => q.since
                    ? { ownerOriginalPlayerId: q.ownerOriginalPlayerId, createdAt: { $gt: q.since } }
                    : { ownerOriginalPlayerId: q.ownerOriginalPlayerId }),
            },
        },
        { $group: { _id: '$ownerOriginalPlayerId', count: { $sum: 1 } } },
    ]);
    const counts: Record<number, number> = {};
    queries.forEach(q => { counts[q.ownerOriginalPlayerId] = 0; });
    rows.forEach(r => { counts[r._id] = r.count; });
    return counts;
}
