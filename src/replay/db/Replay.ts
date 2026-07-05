import mongoose, { Schema } from 'mongoose';
import { FightStatsMessage } from '../../common/MessageTypes';

const ReplayEventSchema = new Schema(
    {
        t: Number,
        kind: String,
        type: String,
        payload: Schema.Types.Mixed,
    },
    { _id: false }
);

const ReplaySchema = new Schema({
    replayId: { type: String, required: true, unique: true },
    originalPlayerId: { type: Number, required: true, index: true },
    playerId: Number,
    round: Number,
    playerName: String,
    enemyName: String,
    result: String,
    gameVersion: Number,
    durationMs: Number,
    createdAt: { type: Date, default: Date.now, index: true },
    initialState: Schema.Types.Mixed,
    events: [ReplayEventSchema],
    truncated: { type: Boolean, default: false },
    stats: Schema.Types.Mixed,
});

ReplaySchema.index({ originalPlayerId: 1, round: 1 });

export const replayModel = mongoose.model('Replay', ReplaySchema);

export interface ReplayListItem {
    replayId: string;
    originalPlayerId: number;
    playerId: number;
    round: number;
    playerName: string;
    enemyName: string;
    result: string;
    gameVersion: number;
    durationMs: number;
    createdAt: Date;
    truncated: boolean;
    stats?: FightStatsMessage;
}

export async function getReplaysByOriginalPlayer(originalPlayerId: number): Promise<ReplayListItem[]> {
    return replayModel
        .find({ originalPlayerId })
        .select('-events -initialState')
        .sort({ round: 1 })
        .lean() as unknown as ReplayListItem[];
}

export async function getReplayById(replayId: string): Promise<Record<string, any> | null> {
    return replayModel.findOne({ replayId }).lean();
}

export async function saveReplay(data: {
    replayId: string;
    originalPlayerId: number;
    playerId: number;
    round: number;
    playerName: string;
    enemyName: string;
    result: string;
    gameVersion: number;
    durationMs: number;
    initialState: Record<string, any>;
    events: any[];
    truncated: boolean;
    stats?: FightStatsMessage;
}): Promise<void> {
    await replayModel.create(data);
}
