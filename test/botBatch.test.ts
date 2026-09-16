import {
    executeBotBatch, getBotBatchStatus, isBotBatchRunning, isKnownPolicyId, listPolicyIds,
    resolvePolicy, stopBotBatch,
} from '../src/bot/BotRunner';

// Pure guard-logic tests for BotRunner's batch orchestration — no live MongoDB or Colyseus room
// required (like matchmaking.test.ts). executeBotBatch's "already running" guard is checked
// synchronously, before any await (see BotRunner.ts), so it's observable without a real run ever
// completing — the first batch's inevitable rejection (no DB connection in this suite) is caught
// and ignored; only the guard's own behavior is under test here.
describe('BotRunner batch orchestration', () => {
    // Deliberately ONE test, not three — `currentBatch` is module-level singleton state, and the
    // batch started here never cleanly finishes (no DB connection in this suite, so its
    // eventual runBotOnce() rejection happens on an unpredictable Mongo-connect-timeout delay
    // well past any single test's lifetime). Splitting "started" and "still running" assertions
    // across separate tests would make later tests flaky depending on exactly when that leftover
    // rejection unwinds — asserting the whole guard lifecycle in one pass avoids that ordering
    // dependency entirely.
    it('reports not-running, then guards a second batch while one is active, and stopBotBatch reflects both states', async () => {
        expect(isBotBatchRunning()).toBe(false);
        expect(getBotBatchStatus()).toEqual({ running: false });
        expect(stopBotBatch()).toBe(false);

        const first = executeBotBatch('batch-1', {
            runs: 5,
            policyId: 'heuristic-v2',
            archetypeId: 'tank-paladin',
        });
        first.catch(() => {}); // will eventually reject (no DB connection in this suite) — expected, not under test

        expect(isBotBatchRunning()).toBe(true);
        const status = getBotBatchStatus();
        expect(status.running).toBe(true);
        expect(status.batchId).toBe('batch-1');
        expect(status.policyId).toBe('heuristic-v2');
        expect(status.archetypeId).toBe('tank-paladin');
        expect(status.runsTotal).toBe(5);
        expect(status.runsDone).toBe(0);

        await expect(executeBotBatch('batch-2', { runs: 1 })).rejects.toThrow(/already running/);

        expect(stopBotBatch()).toBe(true);

        // Wait out `first`'s eventual rejection (this suite never connects to MongoDB, so
        // mintBotIdentity's DB call sits in Mongoose's command buffer until bufferTimeoutMS
        // elapses, ~10s by default) rather than leaving it to settle in the background after the
        // test returns — that would leak a live timer past this test's lifetime for no reason.
        await first.catch(() => {});
    });
});

describe('resolvePolicy', () => {
    it('returns the requested policy', () => {
        expect(resolvePolicy('heuristic-v1').id).toBe('heuristic-v1');
        expect(resolvePolicy('heuristic-v2').id).toBe('heuristic-v2');
    });

    it('defaults to v1 when no id is given, so existing callers are unchanged', () => {
        expect(resolvePolicy().id).toBe('heuristic-v1');
    });

    // Falling back silently was the old behavior, and it was worse than useless: the telemetry
    // recorded 'heuristic-v1' for a batch the caller believed was running something else.
    it('throws on an unknown id instead of falling back', () => {
        expect(() => resolvePolicy('heuristic-v3')).toThrow(/Unknown policyId/);
        expect(isKnownPolicyId('heuristic-v3')).toBe(false);
        expect(listPolicyIds()).toEqual(expect.arrayContaining(['heuristic-v1', 'heuristic-v2']));
    });

    it('threads the seed and archetype into a v2 policy', () => {
        const policy = resolvePolicy('heuristic-v2', { seed: 42, archetypeId: 'tank-paladin' });
        expect(policy.seed).toBe(42);
        expect(policy.archetypeId).toBe('tank-paladin');
    });

    it('derives the archetype from the seed when none is named', () => {
        expect(resolvePolicy('heuristic-v2', { seed: 99 }).archetypeId)
            .toBe(resolvePolicy('heuristic-v2', { seed: 99 }).archetypeId);
    });
});
