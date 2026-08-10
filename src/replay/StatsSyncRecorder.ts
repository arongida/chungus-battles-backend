import { Player } from '../players/schema/PlayerSchema';
import { StatsSyncItem, StatsSyncMessage, StatsSyncSide } from '../common/MessageTypes';
import { ReplayRecorder } from './ReplayRecorder';

// How often (game time, ms) a diff scan is allowed to run. Throttled first so a scan happens at
// most twice a second, not on every 100ms FightRoom.update() tick.
const SYNC_INTERVAL_MS = 500;

const TRACKED_STATS = [
    'maxHp', 'strength', 'accuracy', 'defense', 'attackSpeed',
    'dodgeRate', 'hpRegen', 'income', 'cooldownReduction',
] as const;
type TrackedStat = typeof TRACKED_STATS[number];

interface SideCache {
    hp: number;
    stats: Record<TrackedStat, number>;
    skillStatus: Map<string, string>;
}

function freshCache(): SideCache {
    const stats = {} as Record<TrackedStat, number>;
    for (const key of TRACKED_STATS) stats[key] = NaN;
    return { hp: NaN, stats, skillStatus: new Map() };
}

/**
 * Replay-only companion to ReplayRecorder: periodically diffs each side's displayed stats and
 * per-item skillStatus against the last emitted values, and records a 'stats_sync' event
 * carrying only what changed. Exists because replay playback has no Colyseus schema sync — see
 * MessageTypes.ts's StatsSyncMessage doc comment for why this is needed at all.
 */
export class StatsSyncRecorder {
    private lastAt = -Infinity;
    private playerCache: SideCache = freshCache();
    private enemyCache: SideCache = freshCache();

    // Scratch fields for the preallocated equippedItems.forEach callback below — avoids
    // allocating a new closure on every scan.
    private scanOut: StatsSyncItem[] | null = null;
    private scanCache: Map<string, string> | null = null;
    private readonly scanItem = (item: { skillStatus: string }, slot: string): void => {
        const prev = this.scanCache!.get(slot);
        if (prev === item.skillStatus) return;
        this.scanCache!.set(slot, item.skillStatus);
        (this.scanOut ??= []).push({ slot, skillStatus: item.skillStatus });
    };

    /** Re-seeds both caches so the next maybeRecord (typically called with force=true) reports
     *  every field as changed — used at fight start so the first sync is a full snapshot. */
    reset(): void {
        this.lastAt = -Infinity;
        this.playerCache = freshCache();
        this.enemyCache = freshCache();
    }

    maybeRecord(recorder: ReplayRecorder, nowMs: number, player: Player, enemy: Player, force = false): void {
        if (!force && nowMs - this.lastAt < SYNC_INTERVAL_MS) return;
        this.lastAt = nowMs;

        const playerSide = this.diffSide(player, this.playerCache);
        const enemySide = this.diffSide(enemy, this.enemyCache);
        if (!playerSide && !enemySide) return;

        const payload: StatsSyncMessage = {};
        if (playerSide) payload.player = playerSide;
        if (enemySide) payload.enemy = enemySide;
        recorder.record('sync', 'stats_sync', payload);
    }

    private diffSide(pl: Player, cache: SideCache): StatsSyncSide | null {
        let out: StatsSyncSide | null = null;

        const roundedHp = Math.round(pl.hp);
        if (roundedHp !== cache.hp) {
            cache.hp = roundedHp;
            (out ??= { playerId: pl.playerId }).hp = pl.hp;
        }
        for (const key of TRACKED_STATS) {
            const value = pl[key];
            if (value !== cache.stats[key]) {
                cache.stats[key] = value;
                (out ??= { playerId: pl.playerId })[key] = value;
            }
        }

        this.scanOut = null;
        this.scanCache = cache.skillStatus;
        pl.equippedItems.forEach(this.scanItem);
        if (this.scanOut) (out ??= { playerId: pl.playerId }).items = this.scanOut;
        this.scanCache = null;

        return out;
    }
}
