import { playerModel, JOE_PLAYER_ID } from '../players/db/Player';
import { WINS_TO_WIN } from '../common/types';

// "Who's behind this ghost?" — a small, public profile of the character that owns a matchmaking
// snapshot, read from that character's live (original) doc. Shown on the enemy nameplate in
// fights and on the next-enemy preview, so the opponent reads as a person with a run in progress
// rather than a stat block. Built only from data that's already public via /leaderboard and
// /runSummaries (wins, lives, round, runsEnded).

export type OwnerStatus = 'fighting' | 'fallen' | 'champion';

export interface OwnerBadge {
    id: string;
    label: string;
}

export interface OwnerProfile {
    originalPlayerId: number;
    status: OwnerStatus;
    wins: number;
    losses: number;
    round: number;
    runsEnded: number;
    badges: OwnerBadge[];
}

// Highest tier reached wins — a character with 12 runs ended shows only "Run Ender ×12".
const RUN_ENDER_TIERS = [25, 10, 5, 1];

export function buildOwnerProfile(doc: { playerId: number; wins?: number; losses?: number; lives?: number; round?: number; runsEnded?: number }): OwnerProfile {
    const wins = doc.wins ?? 0;
    const runsEnded = doc.runsEnded ?? 0;
    const status: OwnerStatus = wins >= WINS_TO_WIN ? 'champion' : (doc.lives ?? 0) <= 0 ? 'fallen' : 'fighting';
    const badges: OwnerBadge[] = [];
    if (status === 'champion') badges.push({ id: 'champion', label: 'Champion' });
    const tier = RUN_ENDER_TIERS.find(t => runsEnded >= t);
    if (tier) badges.push({ id: `run_ender_${tier}`, label: `Run Ender ×${runsEnded}` });
    return {
        originalPlayerId: doc.playerId,
        status,
        wins,
        losses: doc.losses ?? 0,
        round: doc.round ?? 1,
        runsEnded,
        badges,
    };
}

// Every fight and every draft join reads one of these; a short cache keeps a popular ghost
// (many players matched against it the same minute) from costing one query per fight.
const PROFILE_CACHE_TTL_MS = 30_000;
const profileCache = new Map<number, { profile: OwnerProfile | null; expiresAt: number }>();

export async function getOwnerProfile(originalPlayerId: number): Promise<OwnerProfile | null> {
    if (!originalPlayerId || originalPlayerId === JOE_PLAYER_ID) return null;
    const cached = profileCache.get(originalPlayerId);
    if (cached && cached.expiresAt > Date.now()) return cached.profile;

    const doc = await playerModel.findOne(
        { playerId: originalPlayerId },
        { _id: 0, playerId: 1, wins: 1, losses: 1, lives: 1, round: 1, runsEnded: 1 },
    ).lean();
    const profile = doc ? buildOwnerProfile(doc as any) : null;
    if (profileCache.size > 5_000) profileCache.clear();
    profileCache.set(originalPlayerId, { profile, expiresAt: Date.now() + PROFILE_CACHE_TTL_MS });
    return profile;
}

// Never lets a profile lookup fail a room join — the profile is cosmetic.
export async function getOwnerProfileJson(originalPlayerId: number): Promise<string> {
    try {
        const profile = await getOwnerProfile(originalPlayerId);
        return profile ? JSON.stringify(profile) : '';
    } catch (err) {
        console.error('[badges] owner profile lookup failed:', err);
        return '';
    }
}
