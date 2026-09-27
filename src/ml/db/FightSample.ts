import mongoose, { Schema } from 'mongoose';
import { boardFromSnapshot, CombatBoard } from '../board';

/**
 * One compact training example per fight: both combat builds as they stood when the fight started,
 * and who won. The fight-outcome model (ml/, src/bot/ml/) learns from these.
 *
 * Why a separate collection when replays already hold `initialState`: replays are storage-heavy,
 * so their initialState is stripped at season rollover (pruneSeasonReplays) and un-pruned ones
 * TTL-expire after 90 days. A sample is ~2KB and is kept for good — it's the training set.
 * `a` is always the room's player and `b` its enemy; `result` is from `a`'s side.
 */
const FightSampleSchema = new Schema({
    replayId: { type: String, index: true },
    gameVersion: { type: Number, required: true },
    round: Number,
    kind: String, // 'run' | 'bot'
    result: String, // 'win' | 'lose' | 'draw', for side a
    durationMs: Number,
    aOriginalPlayerId: Number,
    bOriginalPlayerId: Number,
    aIsBot: Boolean,
    bIsBot: Boolean,
    a: Schema.Types.Mixed,
    b: Schema.Types.Mixed,
    createdAt: { type: Date, default: Date.now },
});

FightSampleSchema.index({ gameVersion: 1, createdAt: 1 });

export const fightSampleModel = mongoose.model('FightSample', FightSampleSchema);

export interface FightSampleDoc {
    replayId?: string;
    gameVersion: number;
    round: number;
    kind: string;
    result: string;
    durationMs?: number;
    aOriginalPlayerId?: number;
    bOriginalPlayerId?: number;
    aIsBot?: boolean;
    bIsBot?: boolean;
    a: CombatBoard;
    b: CombatBoard;
    createdAt?: Date;
}

/** Builds the sample from a replay's initialState (snapshotPlayer records for both sides). Shared
 *  by the live write in FightRoom and the export script's replay backfill, so both produce the same
 *  document for the same fight. */
export function fightSampleFromInitialState(
    initialState: { player: Record<string, any>; enemy: Record<string, any>; round?: number; gameVersion?: number },
    meta: { replayId?: string; kind: string; result: string; durationMs?: number; gameVersion: number; round: number; createdAt?: Date },
): FightSampleDoc {
    return {
        replayId: meta.replayId,
        gameVersion: meta.gameVersion,
        round: meta.round,
        kind: meta.kind,
        result: meta.result,
        durationMs: meta.durationMs,
        aOriginalPlayerId: initialState.player.originalPlayerId,
        bOriginalPlayerId: initialState.enemy.originalPlayerId,
        aIsBot: !!initialState.player.isBot,
        bIsBot: !!initialState.enemy.isBot,
        a: boardFromSnapshot(initialState.player),
        b: boardFromSnapshot(initialState.enemy),
        createdAt: meta.createdAt,
    };
}

export async function saveFightSample(doc: FightSampleDoc): Promise<void> {
    await fightSampleModel.create(doc);
}
