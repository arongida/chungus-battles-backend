import { ColyseusTestServer, boot } from '@colyseus/testing';
import mongoose from 'mongoose';
import { server } from '../src/app.config';
import { getNextPlayerId, getPlayer, playerModel } from '../src/players/db/Player';
import { generatePlayerToken, reservePlayerId } from '../src/players/db/PlayerToken';
import { createHeadlessClient } from '../src/tournament/HeadlessClient';
import { BotDraftRoom } from '../src/bot/BotDraftRoom';
import { BotFightRoom } from '../src/bot/BotFightRoom';
import { HeuristicPolicy } from '../src/bot/HeuristicPolicy';
import { replayModel } from '../src/replay/db/Replay';
import { waitFor } from './helpers/waitFor';
import { isKnownPolicyId, listPolicyIds, resolvePolicy, runBotOnce } from '../src/bot/BotRunner';
import { HeuristicPolicyV2 } from '../src/bot/v2/HeuristicPolicyV2';
import { botRunModel } from '../src/bot/db/BotRun';
import { fightSampleModel } from '../src/ml/db/FightSample';
import { FightModel } from '../src/bot/ml/fightModel';
import { LearnedPolicyV1 } from '../src/bot/learned/LearnedPolicyV1';
import { join as pathJoin } from 'path';

// Same safe speed cap TournamentRunner.DEFAULT_TIME_SCALE / room.test.ts's TEST_FIGHT_TIME_SCALE
// use — see either's comment for why 8x is the ceiling on a shared-CPU fly.io machine.
const TEST_FIGHT_TIME_SCALE = 8;

// One shared boot() for the whole file (both describe blocks below) — two separate boot/shutdown
// cycles in the same file was flaky (an internal Colyseus router error surfaced only when the
// second boot() followed close behind the first's shutdown), and there's no reason for BotRunner
// integration tests to need their own server instance.
describe('bot module (headless rooms + BotRunner, driven directly against a live MongoDB)', () => {
    let colyseus: ColyseusTestServer;
    const runIds: string[] = [];

    beforeAll(async () => {
        await mongoose.connect(process.env.DB_CONNECTION_STRING!, { autoIndex: true });
        colyseus = await boot(server);
    });

    afterAll(async () => {
        await colyseus.shutdown();
        // Best-effort cleanup of anything this suite created — matches the cleanup style of
        // room.test.ts/tournament.test.ts's throwaway characters.
        await playerModel.deleteMany({ name: /^TESTBOT/ }).catch(() => {});
        const testReplayIds: string[] = await replayModel.distinct('replayId', { playerName: /^TESTBOT/, kind: 'bot' }).catch(() => [] as string[]);
        await fightSampleModel.deleteMany({ replayId: { $in: testReplayIds } }).catch(() => {});
        await replayModel.deleteMany({ playerName: /^TESTBOT/, kind: 'bot' }).catch(() => {});
        await botRunModel.deleteMany({ runId: { $in: runIds } }).catch(() => {});
        const runnerCreatedIds: number[] = await botRunModel.distinct('originalPlayerId', { runId: { $in: runIds } }).catch(() => [] as number[]);
        if (runnerCreatedIds.length) {
            await playerModel.deleteMany({ originalPlayerId: { $in: runnerCreatedIds } }).catch(() => {});
            const runnerReplayIds: string[] = await replayModel.distinct('replayId', { originalPlayerId: { $in: runnerCreatedIds } }).catch(() => [] as string[]);
            await fightSampleModel.deleteMany({ replayId: { $in: runnerReplayIds } }).catch(() => {});
            await replayModel.deleteMany({ originalPlayerId: { $in: runnerCreatedIds } }).catch(() => {});
        }
        mongoose.disconnect();
    });

    async function mintPlayerIdAndToken() {
        const playerId = await getNextPlayerId();
        const playerToken = generatePlayerToken();
        await reservePlayerId(playerId, playerToken);
        return { playerId, playerToken };
    }

    describe('BotDraftRoom / BotFightRoom (driven one phase at a time)', () => {
        afterEach(async () => {
            await colyseus.cleanup();
        });

        it('prototype-identity guard: BotDraftRoom/BotFightRoom never override the inherited lifecycle hooks', () => {
            // The whole safety argument for this design is that the bot runs through the exact
            // same onJoin/onLeave/onCreate/handleFightEnd(-adjacent) path a real player does —
            // this pins that a future "I'll just override it" change is a loud test failure, not
            // a silent divergence between bot-produced matchmaking snapshots and real ones.
            expect(BotDraftRoom.prototype.onJoin).toBe(require('../src/rooms/DraftRoom').DraftRoom.prototype.onJoin);
            expect(BotDraftRoom.prototype.onLeave).toBe(require('../src/rooms/DraftRoom').DraftRoom.prototype.onLeave);
            expect(BotDraftRoom.prototype.onCreate).toBe(require('../src/rooms/DraftRoom').DraftRoom.prototype.onCreate);
            expect(BotFightRoom.prototype.onJoin).toBe(require('../src/rooms/FightRoom').FightRoom.prototype.onJoin);
            expect(BotFightRoom.prototype.onLeave).toBe(require('../src/rooms/FightRoom').FightRoom.prototype.onLeave);
            expect(BotFightRoom.prototype.onCreate).toBe(require('../src/rooms/FightRoom').FightRoom.prototype.onCreate);
            expect((BotFightRoom.prototype as any).startBattle).toBe((require('../src/rooms/FightRoom').FightRoom.prototype as any).startBattle);
            expect((BotFightRoom.prototype as any).concludeBattle).toBe((require('../src/rooms/FightRoom').FightRoom.prototype as any).concludeBattle);
        });

        it('BotDraftRoom: joins headlessly, performs a buy via performAction, and leaves cleanly (session released, snapshot written)', async () => {
            const { playerId, playerToken } = await mintPlayerIdAndToken();
            const room = (await colyseus.createRoom('bot_draft', {})) as unknown as BotDraftRoom;
            const client = createHeadlessClient(`bot-draft-${playerId}`);

            await room.onJoin(client, { playerId, playerToken, name: `TESTBOT${playerId}`, avatarUrl: 'assets/warrior_01.png' });
            // Same readiness signal room.test.ts's createAndJoinDraftRoom uses — the shop is only
            // populated once onJoin's setup (including the first aura tick's worth of pricing) lands.
            await waitFor(() => room.state.shop.length > 0, { timeout: 5000, message: 'draft room shop to populate' });
            // One full aura tick (1000ms) so refreshShopCost/luckyFindChance/freeRerollCharges are
            // the real, finalized values a policy would actually read — see the plan's readiness gate.
            await new Promise((r) => setTimeout(r, 1100));

            const goldBefore = room.state.player.gold;
            const shopItem = room.state.shop.find((i) => !i.sold && i.price <= goldBefore);
            expect(shopItem).toBeDefined();

            await room.performAction({ type: 'buy', itemId: shopItem!.itemId }, client);
            await waitFor(
                () => room.state.player.gold < goldBefore,
                { timeout: 3000, message: 'gold to decrease after buy' },
            );

            await room.onLeave(client, 0);
            await room.disconnect();

            const saved = await getPlayer(playerId);
            expect(saved).not.toBeNull();
            expect(saved!.sessionId).toBe('');

            // DraftRoom.onLeave's copyPlayer() must have written at least one matchmaking snapshot
            // for this character.
            const snapshots = await playerModel.find({ originalPlayerId: playerId, playerId: { $ne: playerId } }).lean();
            expect(snapshots.length).toBeGreaterThanOrEqual(1);
        }, 30000);

        it('BotFightRoom: joins headlessly, plays a full (round-1, deterministic) fight, applies progression, and saves a kind:"bot" replay', async () => {
            const { playerId, playerToken } = await mintPlayerIdAndToken();

            // Create the character via a real draft join+leave (round 1 -> Joe, deterministic).
            const draftRoom = (await colyseus.createRoom('bot_draft', {})) as unknown as BotDraftRoom;
            const draftClient = createHeadlessClient(`bot-draft-${playerId}`);
            await draftRoom.onJoin(draftClient, { playerId, playerToken, name: `TESTBOT${playerId}`, avatarUrl: 'assets/warrior_01.png' });
            await waitFor(() => draftRoom.state.shop.length > 0, { timeout: 5000, message: 'draft room shop to populate' });
            await draftRoom.onLeave(draftClient, 0);
            await draftRoom.disconnect();
            await waitFor(async () => {
                const p = await getPlayer(playerId);
                return !!p && p.sessionId === '';
            }, { timeout: 15000, interval: 100, message: `player ${playerId}'s session to clear` });

            const fightRoom = (await colyseus.createRoom('bot_fight', {})) as unknown as BotFightRoom;
            (fightRoom as any).state.timeScale = TEST_FIGHT_TIME_SCALE;
            (fightRoom as any).applySimulationResolution(TEST_FIGHT_TIME_SCALE);
            const fightClient = createHeadlessClient(`bot-fight-${playerId}`);
            const policy = new HeuristicPolicy();
            fightRoom.configure(policy, fightClient, 'test-run');

            const outcomePromise = fightRoom.awaitFightEnd();
            await fightRoom.onJoin(fightClient, { playerId, playerToken });
            const outcome = await outcomePromise;

            expect(['win', 'lose', 'draw']).toContain(outcome.result);
            expect(outcome.durationMs).toBeGreaterThan(0);
            expect(outcome.replayId).toBeDefined();

            await fightRoom.onLeave(fightClient, 0);
            await fightRoom.disconnect();

            const saved = await getPlayer(playerId);
            expect(saved).not.toBeNull();
            expect(saved!.sessionId).toBe('');
            // FightRoom.onLeave increments round — confirms full progression ran (unlike
            // TournamentFightRoom, which deliberately never does this).
            expect(saved!.round).toBe(2);

            const replay = await replayModel.findOne({ replayId: outcome.replayId }).lean();
            expect(replay).not.toBeNull();
            expect(replay!.kind).toBe('bot');
            expect((replay as any).events?.length ?? 0).toBeGreaterThan(0);

            // The fight also left a durable training sample, written fire-and-forget beside the replay.
            await waitFor(async () => !!(await fightSampleModel.exists({ replayId: outcome.replayId })),
                { timeout: 5000, interval: 100, message: 'fight sample to be written' });
            const sample = await fightSampleModel.findOne({ replayId: outcome.replayId }).lean() as any;
            expect(sample.kind).toBe('bot');
            expect(sample.result).toBe(outcome.result);
            expect(sample.aOriginalPlayerId).toBe(playerId);
            expect(sample.a.avatarClass).toBe('warrior');
            expect(sample.a.stats.maxHp).toBeGreaterThan(0);
            expect(sample.a.equipped.length).toBeGreaterThan(0);
            expect(sample.b.stats.maxHp).toBeGreaterThan(0);
        }, 30000);
    });

    describe('BotRunner.runBotOnce (full multi-round run, driven end to end)', () => {
        it('plays 3 full rounds, flags the character and every matchmaking snapshot as isBot, and records matching telemetry', async () => {
            const result = await runBotOnce({ maxRounds: 3, timeScale: TEST_FIGHT_TIME_SCALE });
            runIds.push(result.runId);

            // Capped by maxRounds, not a natural win/death — 'aborted' is the correct outcome here.
            expect(result.outcome).toBe('aborted');
            expect(result.finalRound).toBe(4); // FightRoom.onLeave increments round after each of the 3 fights

            const saved = await getPlayer(result.playerId);
            expect(saved).not.toBeNull();
            expect(saved!.sessionId).toBe('');
            expect(saved!.isBot).toBe(true);

            // Every matchmaking snapshot copyPlayer() wrote across the 3 rounds must also carry
            // the flag — the whole point of threading isBot through playerToPlainObject.
            const snapshots = await playerModel.find({ originalPlayerId: result.originalPlayerId, playerId: { $ne: result.originalPlayerId } }).lean();
            expect(snapshots.length).toBeGreaterThanOrEqual(3);
            for (const snap of snapshots) expect(snap.isBot).toBe(true);

            const runDoc = await botRunModel.findOne({ runId: result.runId }).lean();
            expect(runDoc).not.toBeNull();
            expect(runDoc!.rounds.length).toBe(3);
            for (const round of runDoc!.rounds as any[]) {
                expect(round.fight).toBeDefined();
                expect(['win', 'lose', 'draw']).toContain(round.fight.result);
            }

            const replays = await replayModel.find({ originalPlayerId: result.originalPlayerId, kind: 'bot' }).lean();
            expect(replays.length).toBeGreaterThanOrEqual(3);
        }, 120000);

        // The v2 twin. `rejected` is computed by the runner on every action (it diffs the whole
        // observation before/after) and nothing else reads it — which makes it the cheapest real
        // signal that a policy is emitting actions the server silently refuses.
        it('plays 3 rounds under heuristic-v2 without the server rejecting its actions', async () => {
            const policy = new HeuristicPolicyV2({ seed: 20260916 });
            const result = await runBotOnce({ policy, maxRounds: 3, timeScale: TEST_FIGHT_TIME_SCALE });
            runIds.push(result.runId);

            expect(result.outcome).toBe('aborted');
            expect(result.finalRound).toBe(4);

            const runDoc = await botRunModel.findOne({ runId: result.runId }).lean();
            expect(runDoc).not.toBeNull();
            expect(runDoc!.policyId).toBe('heuristic-v2');
            // The archetype and its seed are what make a surprising result reproducible.
            expect(runDoc!.archetypeId).toBe(policy.archetypeId);
            expect(runDoc!.seed).toBe(20260916);
            // Every talent and skill the run met had a catalog entry.
            expect(runDoc!.unknownHintIds).toEqual([]);

            const decisions = (runDoc!.rounds as any[]).flatMap((r) => r.decisions ?? []);
            expect(decisions.length).toBeGreaterThan(0);
            const rejected = decisions.filter((d: any) => d.rejected);
            const rejectedRate = rejected.length / decisions.length;
            expect(rejectedRate).toBeLessThan(0.05);
        }, 120000);

        it('plays 3 rounds under learned-v1 (toy model), valuing boards against sampled same-round opponents', async () => {
            const model = FightModel.load(pathJoin(__dirname, 'fixtures', 'fightModelToy.json'));
            const policy = new LearnedPolicyV1({ seed: 20260926, model });
            const seen: number[] = [];
            const decide = policy.decideDraft.bind(policy);
            policy.decideDraft = async (obs) => { seen.push(obs.referenceOpponents?.length ?? -1); return decide(obs); };

            const result = await runBotOnce({ policy, maxRounds: 3, timeScale: TEST_FIGHT_TIME_SCALE });
            runIds.push(result.runId);
            expect(result.outcome).toBe('aborted');
            expect(result.finalRound).toBe(4);

            const runDoc = await botRunModel.findOne({ runId: result.runId }).lean();
            expect(runDoc!.policyId).toBe('learned-v1');
            // The run records exactly which trained model played it.
            expect((runDoc as any).modelId).toBe(model.id);
            expect(model.id).toMatch(/^fight-v\d+@.+#[0-9a-f]+$/);
            // The runner attached a same-round opponent sample to every observation.
            expect(seen.length).toBeGreaterThan(0);
            expect(seen.every((n) => n >= 0)).toBe(true);
            const decisions = (runDoc!.rounds as any[]).flatMap((r) => r.decisions ?? []);
            expect(decisions.length).toBeGreaterThan(0);
            expect(decisions.filter((d: any) => d.rejected).length / decisions.length).toBeLessThan(0.05);
        }, 120000);

        it('a real client can still join draft_room normally while a bot run is in progress', async () => {
            const runPromise = runBotOnce({ maxRounds: 2, timeScale: TEST_FIGHT_TIME_SCALE });

            const playerId = await getNextPlayerId();
            const playerToken = generatePlayerToken();
            await reservePlayerId(playerId, playerToken);
            const room = await colyseus.createRoom('draft_room', {});
            const client = await colyseus.connectTo(room, { playerId, playerToken, name: `TESTBOT${playerId}`, avatarUrl: 'test_avatar' });
            await waitFor(() => room.state.shop.length > 0, { timeout: 5000, message: 'draft room shop to populate while a bot run is in progress' });
            await client.leave(true);
            await colyseus.cleanup();

            const result = await runPromise;
            runIds.push(result.runId);
        }, 120000);
    });
});
