import { Client } from '@colyseus/core';
import { FightRoom } from '../rooms/FightRoom';
import { ReplayRecorder, ReplayEvent } from '../replay/ReplayRecorder';
import { StatsSyncRecorder } from '../replay/StatsSyncRecorder';
import { getPlayerSchemaObject } from '../players/db/Player';
import { getQuestItems } from '../items/db/Item';
import { FightResultType } from '../common/types';
import { FightStatsMessage } from '../common/MessageTypes';
import { FightEndTriggerCommand } from '../commands/triggers/FightEndTriggerCommand';
import { createHeadlessClient } from './HeadlessClient';
import { randomUUID } from 'crypto';

export interface HeadlessFightOutcome {
    // From state.player's perspective — the caller (TournamentRunner) knows which roster
    // character occupied which side and reorients this back to "A won"/"B won".
    result: 'win' | 'lose' | 'draw';
    durationMs: number;
    stats: FightStatsMessage | null;
    playerFinalHp: number;
    playerMaxHp: number;
    enemyFinalHp: number;
    enemyMaxHp: number;
    replay: { initialState: Record<string, any>; events: ReplayEvent[]; truncated: boolean } | null;
}

/**
 * A FightRoom that never accepts a real client connection and never touches the `players`
 * collection. One instance is created per tournament and reused for every gauntlet/playoff game —
 * `runFight()` rebuilds `state.player`/`state.enemy` from frozen roster snapshots each time, so no
 * server-only combat field (poison stacks, active skill timers, invincibility, talent combat
 * accumulators) leaks between games.
 *
 * Everything about how a fight actually plays out — attack timers, dodge/damage rolls, talent and
 * item skill behaviors, the replay recorder — is inherited unchanged from FightRoom. Only the
 * three touchpoints that assume a live player are replaced:
 *   - onJoin/onLeave: never called in practice, overridden defensively so a stray matchmaking
 *     join can't happen and so no code path can reach `updatePlayer`.
 *   - state.playerClient: a no-op HeadlessClient (see HeadlessClient.ts) stands in for the real
 *     Client every `client.send(...)` call site expects.
 *   - handleFightEnd: reimplemented (not flag-guarded) to stop BEFORE the base implementation's
 *     wins/losses/lives/gold/xp mutation and saveReplay call — see the doc comment there.
 */
export class TournamentFightRoom extends FightRoom {
    maxClients = 0;

    private fightDeferred: { resolve: (outcome: HeadlessFightOutcome) => void } | null = null;
    private initialized = false;

    async onJoin(): Promise<void> {
        throw new Error('TournamentFightRoom does not accept client connections.');
    }

    async onLeave(): Promise<void> {
        // Deliberately empty — never persists to `players`, never increments `round`, unlike
        // FightRoom.onLeave. This is never expected to run since no client ever joins, but
        // overriding it defensively keeps it that way even if that assumption breaks later.
    }

    /** Loads the quest item pool once, mirroring what FightRoom.onJoin does per live fight —
     *  quest items don't change per-fight, so this only needs to run once for the whole room. */
    async initialize(): Promise<void> {
        if (this.initialized) return;
        this.state.questItems.clear();
        (await getQuestItems()).forEach(item => this.state.questItems.push(item));
        this.initialized = true;
    }

    /**
     * Runs one full fight between two frozen player snapshots (as produced by `snapshotPlayer()`)
     * and resolves once it concludes. `timeScale` follows the same `state.timeScale` mechanism a
     * live fight's speed control uses — `patchClockTimeScale` (FightRoom.ts) already scales every
     * `Delayed` timer uniformly, so a fight at 8x plays out identically to 1x, just faster.
     */
    async runFight(playerSnapshot: Record<string, any>, enemySnapshot: Record<string, any>, timeScale: number): Promise<HeadlessFightOutcome> {
        if (this.fightDeferred) throw new Error('TournamentFightRoom: a fight is already in progress in this room.');
        if (!this.initialized) throw new Error('TournamentFightRoom: call initialize() before runFight().');

        // Fresh Player objects every fight — see class doc comment.
        this.state.player = getPlayerSchemaObject(structuredClone(playerSnapshot));
        this.state.enemy = getPlayerSchemaObject(structuredClone(enemySnapshot));

        // Room-level (not per-player) fields that FightRoom.concludeBattle clears item-by-item
        // but never resets to their "no fight has happened yet" shape — harmless for a room that
        // only ever runs one fight, but this room runs hundreds, so reset explicitly:
        this.state.fightResult = undefined as any;
        this.state.endBurnTimer = undefined as any;
        this.state.skillsTimers = [];
        this.state.gameWinPending = false;
        this.state.lossRewardPending = false;
        this.state.lossRewardOptions = null;
        this.state.lossRewardOutcome = null;
        this.state.lossRewardApplication = null;
        this.state.battleStarted = false;

        this.recorder = new ReplayRecorder(() => this.clock.elapsedTime);
        this.statsSync = new StatsSyncRecorder();
        this.replayId = randomUUID();
        this.fightStatsPayload = null;

        const headlessClient: Client = createHeadlessClient();
        this.state.playerClient = headlessClient;
        this.wrapPlayerClient(headlessClient);

        this.state.timeScale = timeScale;
        this.applySimulationResolution(timeScale);

        return new Promise<HeadlessFightOutcome>((resolve) => {
            this.fightDeferred = { resolve };
            // Live fights run a 3.5s countdown (FightRoom.onJoin) purely for the connected
            // player's benefit — nothing here watches it, so skip straight to battle.
            this.state.battleStarted = true;
            this.startBattle();
        });
    }

    protected async handleFightEnd(): Promise<void> {
        this.state.player.pendingPotionEffects.clear();
        this.state.player.pendingPotionSummary = '';

        if (!this.state.fightResult) {
            if (this.state.player.hp <= 0 && this.state.enemy.hp <= 0) {
                this.state.fightResult = FightResultType.DRAW;
            } else if (this.state.player.hp <= 0) {
                this.state.fightResult = FightResultType.LOSE;
            } else {
                this.state.fightResult = FightResultType.WIN;
            }
        }

        if (this.recorder.initialState) {
            this.fightStatsPayload = this.buildFightStatsPayload();
        }

        // Deliberately NOT calling handleWin/handleLoose/handleDraw (wins/losses/lives/gold/xp/
        // income mutation, killedBy* stamping, incrementRunsEnded, gameWinPending) and NOT running
        // the base implementation's reward block or saveReplay — a tournament fight must never
        // touch player progression, and the caller (TournamentRunner) decides whether this
        // particular game's replay is worth persisting (showcase / playoff), not every game.
        this.dispatcher.dispatch(new FightEndTriggerCommand());

        this.recorder.finalize();

        const outcome: HeadlessFightOutcome = {
            result: this.state.fightResult,
            durationMs: this.recorder.durationMs(),
            stats: this.fightStatsPayload,
            playerFinalHp: this.state.player.hp,
            playerMaxHp: this.state.player.maxHp,
            enemyFinalHp: this.state.enemy.hp,
            enemyMaxHp: this.state.enemy.maxHp,
            replay: this.recorder.initialState
                ? { initialState: this.recorder.initialState, events: this.recorder.events, truncated: this.recorder.truncated }
                : null,
        };

        const deferred = this.fightDeferred;
        this.fightDeferred = null;
        deferred?.resolve(outcome);
    }
}
