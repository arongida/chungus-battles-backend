import { Client, matchMaker } from '@colyseus/core';
import { randomUUID } from 'crypto';
import { BotDraftRoom } from './BotDraftRoom';
import { BotFightRoom } from './BotFightRoom';
import { BotPolicy, BotAction, DraftObservation } from './BotPolicy';
import { HeuristicPolicy } from './HeuristicPolicy';
import { buildDraftObservation } from './observation';
import { createHeadlessClient } from '../tournament/HeadlessClient';
import { mintBotIdentity } from './botIdentity';
import { getPlayer } from '../players/db/Player';
import { GAME_VERSION, WINS_TO_WIN } from '../common/types';
import {
    BotDecisionRecord, BotFightRecord, BotRoundRecord, BotRunEquippedSummary,
    createBotRunDoc, finishBotRun, pushBotRound,
} from './db/BotRun';

// A hard safety cap on decisions within one draft phase — a real round rarely needs more than
// ~15 (see the plan's per-round wall-clock estimate); this only exists to guarantee termination
// against a misbehaving policy (e.g. an LLM policy stuck replanning a stale action forever).
const MAX_DRAFT_STEPS_PER_ROUND = 60;
// A hard safety cap on rounds — WINS_TO_WIN (12) is reachable well under this in practice; this
// exists purely so a policy that never wins/dies (extremely unlikely, but possible for a very
// weak future policy) can't loop forever.
const MAX_ROUNDS_PER_RUN = 60;
// BotRunner always uses this starting gold regardless of NODE_ENV — dev's 1000-gold default
// (players/db/Player.ts's createNewPlayer) makes a bot buy out the entire shop every round,
// producing degenerate, useless telemetry. See the plan's "Dev vs prod" section.
const PROD_STARTING_GOLD = 8;
// Same ceiling TournamentRunner.DEFAULT_TIME_SCALE uses, for the identical reason: fly.io's
// dev/prod machines are 1 shared CPU / 1GB, and an overloaded event loop produces oversized
// clock deltas that make fights stop matching live fidelity.
const DEFAULT_TIME_SCALE = 8;
// When a real player's draft_room/fight_room is live, drop to this instead — real players always
// take priority (see the plan's Risks section on event-loop starvation).
const IDLE_TIME_SCALE = 4;

export interface BotRunOptions {
    policy?: BotPolicy;
    batchId?: string;
    timeScale?: number;
    maxRounds?: number;
}

export interface BotRunResult {
    runId: string;
    playerId: number;
    originalPlayerId: number;
    outcome: 'win' | 'dead' | 'aborted' | 'error';
    finalRound: number;
    errorMessage?: string;
}

function sumDamage(d?: { weapon: number; skill: number; burn: number; poison: number }): number {
    if (!d) return 0;
    return d.weapon + d.skill + d.burn + d.poison;
}

/** True while any real (non-bot) draft_room/fight_room is live — checked between rounds so a
 *  bot batch backs off (see IDLE_TIME_SCALE) rather than compete with real players for the CPU. */
export async function hasLiveRealRooms(): Promise<boolean> {
    const [draftRooms, fightRooms] = await Promise.all([
        matchMaker.query({ name: 'draft_room' }),
        matchMaker.query({ name: 'fight_room' }),
    ]);
    return draftRooms.length > 0 || fightRooms.length > 0;
}

/** Applies one BotAction and reports whether it actually changed anything — the driver's
 *  staleness check (see BotPolicy.ts's doc comment on why a batch must tolerate staleness). A
 *  no-op comparison over the full serialized observation is simple and correct: DraftRoom's
 *  action methods reject silently (client.send('error', ...) is a no-op on a headless client),
 *  so "nothing changed" is exactly "this action was rejected or already a no-op". */
async function applyDraftAction(
    room: BotDraftRoom, client: Client, action: BotAction, runId: string, step: number,
): Promise<{ rejected: boolean; latencyMs: number }> {
    const before = JSON.stringify(buildDraftObservation(room.state, runId, step));
    const t0 = Date.now();
    await room.performAction(action, client);
    const latencyMs = Date.now() - t0;
    const after = JSON.stringify(buildDraftObservation(room.state, runId, step));
    return { rejected: before === after, latencyMs };
}

function actionTargetFields(action: BotAction): Pick<BotDecisionRecord, 'itemId' | 'uid' | 'talentId' | 'slot'> {
    return {
        itemId: 'itemId' in action ? action.itemId : undefined,
        uid: 'uid' in action ? action.uid : undefined,
        talentId: 'talentId' in action ? action.talentId : undefined,
        slot: 'slot' in action ? action.slot : undefined,
    };
}

/** Drives one full draft phase: repeatedly asks the policy for the next batch, applies each
 *  action (re-observing and abandoning the rest of a stale batch — see applyDraftAction above),
 *  and records every decision onto `roundRecord` for telemetry. Terminates when the policy
 *  returns `[]`, emits `{type:'end_draft'}`, or MAX_DRAFT_STEPS_PER_ROUND is reached. */
async function runDraftPhase(
    policy: BotPolicy, room: BotDraftRoom, client: Client, runId: string, roundRecord: BotRoundRecord,
): Promise<void> {
    let step = 0;
    while (step < MAX_DRAFT_STEPS_PER_ROUND) {
        const obs: DraftObservation = buildDraftObservation(room.state, runId, step);
        const batch = await policy.decideDraft(obs);
        if (batch.length === 0) return;

        for (const action of batch) {
            if (action.type === 'end_draft') return;

            const { rejected, latencyMs } = await applyDraftAction(room, client, action, runId, step);
            roundRecord.decisions.push({
                step, type: action.type, rejected, reason: action.reason, latencyMs,
                ...actionTargetFields(action),
            });
            step++;

            if (rejected || step >= MAX_DRAFT_STEPS_PER_ROUND) break; // re-observe fresh at the top of the while loop
        }
    }
}

interface FightPhaseResult {
    result: 'win' | 'lose' | 'draw';
    gameWinPending: boolean;
    livesAfter: number;
}

/** Drives one full fight phase to conclusion and records it onto `roundRecord`. */
async function runFightPhase(
    policy: BotPolicy, runId: string, playerId: number, playerToken: string, timeScale: number,
    roundRecord: BotRoundRecord,
): Promise<FightPhaseResult> {
    const listing = await matchMaker.createRoom('bot_fight', {});
    const room = matchMaker.getLocalRoomById(listing.roomId) as unknown as BotFightRoom;
    const client = createHeadlessClient(`bot-fight-${playerId}-${randomUUID()}`);

    try {
        room.state.timeScale = timeScale;
        (room as any).applySimulationResolution(timeScale);
        room.configure(policy, client, runId);

        const outcomePromise = room.awaitFightEnd();
        await room.onJoin(client, { playerId, playerToken });
        const outcome = await outcomePromise;

        const fight: BotFightRecord = {
            result: outcome.result,
            durationMs: outcome.durationMs,
            enemyPlayerId: room.state.enemy?.playerId,
            enemyOriginalPlayerId: room.state.enemy?.originalPlayerId,
            enemyName: room.state.enemy?.name,
            // Player.copyFrom (setUpState) explicitly propagates isBot despite it being a plain,
            // non-@type field — see PlayerSchema.ts's copyFrom comment — so this reads correctly.
            enemyIsBot: room.state.enemy?.isBot ?? false,
            damageDealt: sumDamage(outcome.stats?.player.damageDealt),
            damageTaken: sumDamage(outcome.stats?.enemy.damageDealt),
            healingReceived: outcome.stats?.player.healingReceived ?? 0,
            attacksDodged: outcome.stats?.player.attacksDodged ?? 0,
            damageBlocked: outcome.stats?.player.damageBlocked ?? 0,
            empoweredDamage: outcome.stats?.player.empoweredDamage ?? 0,
            replayId: outcome.replayId,
        };
        roundRecord.fight = fight;
        roundRecord.lossRewardChoice = outcome.lossRewardChoice;

        return { result: outcome.result, gameWinPending: outcome.gameWinPending, livesAfter: outcome.livesAfter };
    } finally {
        await room.onLeave(client, 0).catch((err) => console.error('[BotRunner] fight onLeave failed:', err));
        await room.disconnect().catch(() => {});
    }
}

/** Accepts either a MapSchema<Item> (from a live Player instance) or a plain slot->item object —
 *  both expose the same shape a bot run's final-build summary needs. */
function summarizeEquipped(equipped: any): BotRunEquippedSummary[] {
    const out: BotRunEquippedSummary[] = [];
    const addEntry = (slot: string, item: any) => {
        if (item) out.push({ slot, itemId: item.itemId, rarity: item.rarity, skillId: item.skillId, class: item.class });
    };
    if (typeof equipped?.forEach === 'function') {
        equipped.forEach((item: any, slot: string) => addEntry(slot, item));
    } else if (equipped) {
        Object.entries(equipped).forEach(([slot, item]) => addEntry(slot, item));
    }
    return out;
}

// ---------------------------------------------------------------------------------------------
// Batch orchestration — runs many runBotOnce() calls in sequence, guarded so only one batch runs
// at a time per process (same reasoning, and same pattern, as TournamentRunner's
// runningSeasons Set: fly.io's dev/prod machines are 1 shared CPU / 1GB, and an overloaded event
// loop produces oversized clock deltas that make fights stop matching live fidelity).
// ---------------------------------------------------------------------------------------------

interface BotBatchState {
    batchId: string;
    policyId: string;
    runsTotal: number;
    runsDone: number;
    cancelled: boolean;
    startedAt: Date;
}

let currentBatch: BotBatchState | null = null;

export function isBotBatchRunning(): boolean {
    return currentBatch !== null;
}

export interface BotBatchStatus {
    running: boolean;
    batchId?: string;
    policyId?: string;
    runsTotal?: number;
    runsDone?: number;
    startedAt?: Date;
}

export function getBotBatchStatus(): BotBatchStatus {
    if (!currentBatch) return { running: false };
    const { batchId, policyId, runsTotal, runsDone, startedAt } = currentBatch;
    return { running: true, batchId, policyId, runsTotal, runsDone, startedAt };
}

/** Sets a cooperative cancel flag, checked between runs (not between rounds — a run already in
 *  progress finishes normally rather than being torn down mid-fight). Returns false if no batch
 *  is currently running. */
export function stopBotBatch(): boolean {
    if (!currentBatch) return false;
    currentBatch.cancelled = true;
    return true;
}

// Only 'heuristic-v1' exists today. A future LLM-backed or trained policy registers here by
// policyId — the admin route and BotPolicy interface are already shaped for that, nothing about
// this lookup needs to change when one is added.
function resolvePolicy(policyId?: string): BotPolicy {
    return new HeuristicPolicy();
}

/**
 * Runs `runs` bot runs back to back under one batchId, honoring stopBotBatch() between runs.
 * Throws synchronously if a batch is already running in this process — callers (the /admin/bots
 * route) should treat that as a 409, exactly like /admin/tournament's isTournamentRunning check.
 */
export async function executeBotBatch(batchId: string, opts: { runs: number; policyId?: string; timeScale?: number }): Promise<void> {
    if (currentBatch) {
        throw new Error(`A bot batch (${currentBatch.batchId}) is already running in this process.`);
    }
    const policy = resolvePolicy(opts.policyId);
    currentBatch = { batchId, policyId: policy.id, runsTotal: opts.runs, runsDone: 0, cancelled: false, startedAt: new Date() };
    try {
        for (let i = 0; i < opts.runs; i++) {
            if (currentBatch.cancelled) break;
            await runBotOnce({ policy, batchId, timeScale: opts.timeScale });
            currentBatch.runsDone++;
        }
    } finally {
        currentBatch = null;
    }
}

/**
 * Plays one complete bot run: mint an identity, then alternate draft/fight phases (exactly the
 * live player loop — GET /playerid -> draft_room -> ... -> leave -> fight_room -> ... -> leave ->
 * repeat) until the character wins (wins >= WINS_TO_WIN) or dies (lives <= 0), recording
 * per-round telemetry throughout. Every phase is wrapped in try/finally so a crash mid-run still
 * releases the character's session claim (see the plan's Risks section) rather than leaking it
 * for SESSION_CLAIM_TTL_MS.
 */
export async function runBotOnce(opts: BotRunOptions = {}): Promise<BotRunResult> {
    const policy = opts.policy ?? new HeuristicPolicy();
    const timeScale = opts.timeScale ?? DEFAULT_TIME_SCALE;
    const maxRounds = opts.maxRounds ?? MAX_ROUNDS_PER_RUN;
    const runId = randomUUID();
    const identity = await mintBotIdentity();
    const env: 'dev' | 'prod' = process.env.NODE_ENV === 'production' ? 'prod' : 'dev';

    await createBotRunDoc({
        runId,
        batchId: opts.batchId,
        policyId: policy.id,
        policyVersion: policy.version,
        gameVersion: GAME_VERSION,
        env,
        startingGold: PROD_STARTING_GOLD,
        timeScale,
        originalPlayerId: identity.playerId,
        playerId: identity.playerId,
        name: identity.name,
        avatarUrl: identity.avatarUrl,
    });

    let outcome: 'win' | 'dead' | 'aborted' | 'error' = 'aborted';
    let errorMessage: string | undefined;
    let finalRound = 0;
    let finalLevel = 0;
    let wins = 0;
    let losses = 0;
    let finalTalentIds: number[] = [];
    let finalEquipped: BotRunEquippedSummary[] = [];

    try {
        for (let i = 0; i < maxRounds; i++) {
            if (await hasLiveRealRooms()) {
                await new Promise((r) => setTimeout(r, 5000));
            }
            const roundTimeScale = (await hasLiveRealRooms()) ? IDLE_TIME_SCALE : timeScale;

            // ---- draft phase ----
            const draftListing = await matchMaker.createRoom('bot_draft', {});
            const draftRoom = matchMaker.getLocalRoomById(draftListing.roomId) as unknown as BotDraftRoom;
            const draftClient = createHeadlessClient(`bot-draft-${identity.playerId}-${randomUUID()}`);
            const roundRecord: BotRoundRecord = {
                round: 0, level: 0, livesBefore: 0, livesAfter: 0, goldStart: 0, goldEnd: 0,
                rerollsThisRound: 0, talentIdsOwned: [], equippedItemIds: [], equippedRarities: [],
                decisions: [],
            };
            try {
                await draftRoom.onJoin(draftClient, {
                    playerId: identity.playerId, playerToken: identity.playerToken,
                    name: identity.name, avatarUrl: identity.avatarUrl,
                    isBot: true, startingGold: PROD_STARTING_GOLD,
                });
                // Readiness gate: wait for the shop to populate AND for one full 1000ms aura tick
                // to land, so the policy's first observation sees finalized shop-economy fields
                // (refreshShopCost, luckyFindChance, freeRerollCharges, *FreeClaim flags) rather
                // than their pre-aura-tick defaults. See the plan's driver-mechanics section.
                const joinedAt = draftRoom.clock.elapsedTime;
                await waitForShopReady(draftRoom, joinedAt);

                roundRecord.round = draftRoom.state.player.round;
                roundRecord.level = draftRoom.state.player.level;
                roundRecord.livesBefore = draftRoom.state.player.lives;
                roundRecord.goldStart = draftRoom.state.player.gold;

                await runDraftPhase(policy, draftRoom, draftClient, runId, roundRecord);

                roundRecord.goldEnd = draftRoom.state.player.gold;
                roundRecord.rerollsThisRound = draftRoom.state.player.rerollsThisRound;
                roundRecord.talentIdsOwned = draftRoom.state.player.talents.map((t) => t.talentId);
                const equippedList: any[] = [];
                draftRoom.state.player.equippedItems.forEach((item) => equippedList.push(item));
                roundRecord.equippedItemIds = equippedList.map((i) => i.itemId);
                roundRecord.equippedRarities = equippedList.map((i) => i.rarity);
            } finally {
                await draftRoom.onLeave(draftClient, 0).catch((err) => console.error('[BotRunner] draft onLeave failed:', err));
                await draftRoom.disconnect().catch(() => {});
            }

            // ---- fight phase ----
            const fightOutcome = await runFightPhase(
                policy, runId, identity.playerId, identity.playerToken, roundTimeScale, roundRecord,
            );
            roundRecord.livesAfter = fightOutcome.livesAfter;

            await pushBotRound(runId, roundRecord);

            const savedPlayer = await getPlayer(identity.playerId);
            finalRound = savedPlayer?.round ?? roundRecord.round;
            finalLevel = savedPlayer?.level ?? roundRecord.level;
            wins = savedPlayer?.wins ?? 0;
            losses = savedPlayer?.losses ?? 0;
            if (savedPlayer) {
                finalTalentIds = (savedPlayer.talents ?? []).map((t: any) => t.talentId);
                finalEquipped = summarizeEquipped(savedPlayer.equippedItems ?? {});
            }

            if (fightOutcome.gameWinPending || wins >= WINS_TO_WIN) {
                outcome = 'win';
                break;
            }
            if (fightOutcome.livesAfter <= 0) {
                outcome = 'dead';
                break;
            }
        }
    } catch (err: any) {
        outcome = 'error';
        errorMessage = err?.message ?? String(err);
        console.error(`[BotRunner] run ${runId} failed:`, err);
    }

    await finishBotRun(runId, { outcome, errorMessage, finalRound, finalLevel, wins, losses, finalTalentIds, finalEquipped });

    return { runId, playerId: identity.playerId, originalPlayerId: identity.playerId, outcome, finalRound, errorMessage };
}

/** Waits for the draft room's shop to populate AND for at least one full aura tick (1000ms) past
 *  join to have elapsed, so shop-economy fields the aura tick finalizes are trustworthy. Polls
 *  rather than a flat sleep, matching the project's waitFor idiom (test/helpers/waitFor.ts). */
async function waitForShopReady(room: BotDraftRoom, joinedAtElapsed: number): Promise<void> {
    const deadline = Date.now() + 15000;
    while (room.state.shop.length === 0 || room.clock.elapsedTime - joinedAtElapsed < 1600) {
        if (Date.now() > deadline) {
            throw new Error('BotRunner: timed out waiting for draft room shop to become ready');
        }
        await new Promise((r) => setTimeout(r, 25));
    }
}
