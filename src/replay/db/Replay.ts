import mongoose, { Schema } from 'mongoose';
import { FightSideStats, FightStatsMessage } from '../../common/MessageTypes';

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

export interface GameStatsResult {
    fights: number;
    wins: number;
    losses: number;
    draws: number;
    stats: FightStatsMessage;
}

const ZERO_SIDE: FightSideStats = {
    damageDealt: { weapon: 0, burn: 0, poison: 0 },
    healingReceived: 0,
    damageReducedByDefense: 0,
    attacksDodged: 0,
    damageBlockedByInvincible: 0,
};

/** Cumulative fight stats for a character across every recorded fight (aggregated
 *  on read from Replay docs, not persisted — see Season 16 plan). The "enemy" side
 *  represents all opponents faced, combined. */
export async function getGameStats(originalPlayerId: number): Promise<GameStatsResult> {
    const [agg] = await replayModel.aggregate([
        { $match: { originalPlayerId, stats: { $exists: true } } },
        { $group: {
            _id: null,
            fights: { $sum: 1 },
            wins: { $sum: { $cond: [{ $eq: ['$result', 'win'] }, 1, 0] } },
            losses: { $sum: { $cond: [{ $in: ['$result', ['lose', 'loose']] }, 1, 0] } },
            draws: { $sum: { $cond: [{ $eq: ['$result', 'draw'] }, 1, 0] } },
            pWeapon: { $sum: '$stats.player.damageDealt.weapon' },
            pBurn: { $sum: '$stats.player.damageDealt.burn' },
            pPoison: { $sum: '$stats.player.damageDealt.poison' },
            pHeal: { $sum: '$stats.player.healingReceived' },
            pDef: { $sum: '$stats.player.damageReducedByDefense' },
            pDodge: { $sum: '$stats.player.attacksDodged' },
            pInvuln: { $sum: '$stats.player.damageBlockedByInvincible' },
            eWeapon: { $sum: '$stats.enemy.damageDealt.weapon' },
            eBurn: { $sum: '$stats.enemy.damageDealt.burn' },
            ePoison: { $sum: '$stats.enemy.damageDealt.poison' },
            eHeal: { $sum: '$stats.enemy.healingReceived' },
            eDef: { $sum: '$stats.enemy.damageReducedByDefense' },
            eDodge: { $sum: '$stats.enemy.attacksDodged' },
            eInvuln: { $sum: '$stats.enemy.damageBlockedByInvincible' },
        } },
    ]).exec();

    if (!agg) {
        return { fights: 0, wins: 0, losses: 0, draws: 0, stats: { player: ZERO_SIDE, enemy: ZERO_SIDE } };
    }

    return {
        fights: agg.fights ?? 0,
        wins: agg.wins ?? 0,
        losses: agg.losses ?? 0,
        draws: agg.draws ?? 0,
        stats: {
            player: {
                damageDealt: { weapon: agg.pWeapon ?? 0, burn: agg.pBurn ?? 0, poison: agg.pPoison ?? 0 },
                healingReceived: agg.pHeal ?? 0,
                damageReducedByDefense: agg.pDef ?? 0,
                attacksDodged: agg.pDodge ?? 0,
                damageBlockedByInvincible: agg.pInvuln ?? 0,
            },
            enemy: {
                damageDealt: { weapon: agg.eWeapon ?? 0, burn: agg.eBurn ?? 0, poison: agg.ePoison ?? 0 },
                healingReceived: agg.eHeal ?? 0,
                damageReducedByDefense: agg.eDef ?? 0,
                attacksDodged: agg.eDodge ?? 0,
                damageBlockedByInvincible: agg.eInvuln ?? 0,
            },
        },
    };
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
