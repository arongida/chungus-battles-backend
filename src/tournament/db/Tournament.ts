import mongoose, { Schema } from 'mongoose';

export type TournamentStatus = 'running' | 'complete' | 'failed' | 'skipped';
export type TournamentStage = 'gauntlet' | 'playoff' | 'done';
export type PlayoffStage = 'PI' | 'QF1' | 'QF2' | 'SF1' | 'SF2' | 'FIN';

export interface TournamentGameResult {
    gameIndex: number;
    aIsPlayer: boolean; // true if roster entry A occupied state.player (vs state.enemy) this game
    result: 'win' | 'lose' | 'draw'; // from A's perspective (A === state.player's originalPlayerId when aIsPlayer)
    replayId?: string; // set only for stored replays (showcase / playoff)
    durationMs: number;
    winnerHpFraction?: number; // winner's remaining hp / maxHp at the end — used to pick the showcase game
    // Stored (not just derived live) so standings/damage totals can be rebuilt purely from the
    // persisted document — no need to re-run fights to resume or to unit-test buildStandings().
    aDamageDealt: number;
    aDamageTaken: number;
}

export interface TournamentPairing {
    aId: number; // originalPlayerId
    bId: number;
    aWins: number;
    bWins: number;
    draws: number;
    games: TournamentGameResult[];
    showcaseReplayId?: string;
}

export interface TournamentStandingRow {
    originalPlayerId: number;
    name: string;
    avatarUrl?: string;
    seed: number;
    fights: number;
    wins: number;
    losses: number;
    draws: number;
    winRate: number;
    damageDealt: number;
    damageTaken: number;
    avgDurationMs: number;
}

export interface TournamentMatch {
    matchId: string;
    stage: PlayoffStage;
    aId: number;
    bId: number;
    aWins: number;
    bWins: number;
    games: TournamentGameResult[];
    winnerId?: number;
}

export interface TournamentRosterEntry {
    playerId: number;
    originalPlayerId: number;
    name: string;
    avatarUrl?: string;
    // Frozen snapshotPlayer() output, captured at tournament build time — the tournament owns its
    // own copy of the winning build since there is no separate hall-of-fame collection and the
    // live `players` doc could otherwise be overwritten or deleted before/while this runs.
    snapshot: Record<string, any>;
}

const TournamentGameResultSchema = new Schema<TournamentGameResult>(
    {
        gameIndex: Number,
        aIsPlayer: Boolean,
        result: String,
        replayId: String,
        durationMs: Number,
        winnerHpFraction: Number,
        aDamageDealt: Number,
        aDamageTaken: Number,
    },
    { _id: false }
);

const TournamentPairingSchema = new Schema<TournamentPairing>(
    {
        aId: Number,
        bId: Number,
        aWins: { type: Number, default: 0 },
        bWins: { type: Number, default: 0 },
        draws: { type: Number, default: 0 },
        games: [TournamentGameResultSchema],
        showcaseReplayId: String,
    },
    { _id: false }
);

const TournamentStandingRowSchema = new Schema<TournamentStandingRow>(
    {
        originalPlayerId: Number,
        name: String,
        avatarUrl: String,
        seed: Number,
        fights: Number,
        wins: Number,
        losses: Number,
        draws: Number,
        winRate: Number,
        damageDealt: Number,
        damageTaken: Number,
        avgDurationMs: Number,
    },
    { _id: false }
);

const TournamentMatchSchema = new Schema<TournamentMatch>(
    {
        matchId: String,
        stage: String,
        aId: Number,
        bId: Number,
        aWins: { type: Number, default: 0 },
        bWins: { type: Number, default: 0 },
        games: [TournamentGameResultSchema],
        winnerId: Number,
    },
    { _id: false }
);

const TournamentRosterEntrySchema = new Schema<TournamentRosterEntry>(
    {
        playerId: Number,
        originalPlayerId: Number,
        name: String,
        avatarUrl: String,
        snapshot: Schema.Types.Mixed,
    },
    { _id: false }
);

const TournamentSchema = new Schema({
    tournamentId: { type: String, required: true, unique: true },
    season: { type: Number, required: true, unique: true },
    status: { type: String, default: 'running' },
    createdAt: { type: Date, default: Date.now },
    completedAt: Date,
    config: {
        gamesPerPairing: Number,
        targetFightsPerCharacter: Number,
        playoffBestOf: Number,
        timeScale: Number,
    },
    // Written after every single game so a mid-run crash or fly.io machine restart can resume
    // instead of re-running everything — see TournamentRunner.ts.
    progress: {
        fightsDone: { type: Number, default: 0 },
        fightsTotal: { type: Number, default: 0 },
        stage: { type: String, default: 'gauntlet' },
    },
    roster: [TournamentRosterEntrySchema],
    gauntlet: {
        pairings: [TournamentPairingSchema],
        table: [TournamentStandingRowSchema],
    },
    playoff: {
        matches: [TournamentMatchSchema],
    },
    championId: Number,
    // Denormalized (also present in roster[].name for the same id) so the lightweight
    // /tournaments listing endpoint never has to project the roster array, which carries a full
    // player snapshot per entry.
    championName: String,
    championAvatarUrl: String,
    runnerUpId: Number,
    error: String,
});

TournamentSchema.index({ status: 1 });

export const tournamentModel = mongoose.model('Tournament', TournamentSchema);

export async function getTournamentBySeason(season: number): Promise<Record<string, any> | null> {
    // Replay bodies never live on the tournament doc itself (games only carry a replayId), so no
    // projection is needed to keep this response light.
    return tournamentModel.findOne({ season }).lean();
}

export async function listTournaments(): Promise<Record<string, any>[]> {
    return tournamentModel
        .find({})
        .select('season status createdAt completedAt championId championName championAvatarUrl')
        .sort({ season: -1 })
        .lean();
}

export async function createTournamentDoc(data: {
    tournamentId: string;
    season: number;
    config: { gamesPerPairing: number; targetFightsPerCharacter: number; playoffBestOf: number; timeScale: number };
    roster: TournamentRosterEntry[];
    fightsTotal: number;
}): Promise<void> {
    await tournamentModel.deleteOne({ season: data.season });
    await tournamentModel.create({
        tournamentId: data.tournamentId,
        season: data.season,
        status: 'running',
        config: data.config,
        progress: { fightsDone: 0, fightsTotal: data.fightsTotal, stage: 'gauntlet' },
        roster: data.roster,
        gauntlet: { pairings: [], table: [] },
        playoff: { matches: [] },
    });
}

export async function saveTournamentProgress(season: number, update: Record<string, any>, unset?: string[]): Promise<void> {
    // $set with an `undefined` value is silently dropped by BSON serialization (not converted to
    // an unset) — callers that need to clear a field (e.g. the stale `error` on a resumed-after-
    // failure run) must name it in `unset`, not pass it as `undefined` in `update`.
    const op: Record<string, any> = { $set: update };
    if (unset?.length) op.$unset = Object.fromEntries(unset.map(f => [f, '']));
    await tournamentModel.updateOne({ season }, op);
}

export async function markTournamentFailed(season: number, error: string): Promise<void> {
    await tournamentModel.updateOne({ season }, { $set: { status: 'failed', error, completedAt: new Date() } });
}

export async function markTournamentSkipped(season: number): Promise<void> {
    await tournamentModel.updateOne({ season }, { $set: { status: 'skipped', completedAt: new Date() } });
}
