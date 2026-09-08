import mongoose from 'mongoose';
// Side-effect import only (unused binding) — importing app.config.ts is what loads .env via
// @colyseus/tools' loadenv, same as room.test.ts relies on by importing { server } from it.
// Without this, process.env.DB_CONNECTION_STRING is undefined when this file runs standalone.
import '../src/app.config';
import {
    claimPlayerSession,
    clearAllSessionClaims,
    playerModel,
    releasePlayerSession,
    SESSION_CLAIM_TTL_MS,
    touchPlayerSession,
} from '../src/players/db/Player';

// Pure DB-primitive tests for the live-session claim (see BaseRoom/DraftRoom/FightRoom for the
// room-lifecycle integration) — these are what actually close the "Player already playing!"
// mutex being permanently dead. No Colyseus room boot needed, just a live Mongo connection.
describe('session claim primitives', () => {
    let nextTestPlayerId = -1_000_000; // negative range so this can never collide with a real getNextPlayerId() sequence value
    const createdIds: number[] = [];

    beforeAll(async () => {
        await mongoose.connect(process.env.DB_CONNECTION_STRING!, { autoIndex: true });
    });

    afterAll(async () => {
        await playerModel.deleteMany({ playerId: { $in: createdIds } });
        await mongoose.disconnect();
    });

    /** A bare player document with no session claimed, mirroring what getNewPlayer produces
     *  before beginSession()/claimPlayerSession ever runs. */
    async function seedFreePlayer(): Promise<number> {
        const playerId = nextTestPlayerId--;
        createdIds.push(playerId);
        await new playerModel({ playerId, originalPlayerId: playerId, name: 'ClaimTest', sessionId: '' }).save();
        return playerId;
    }

    it('claims a free character', async () => {
        const playerId = await seedFreePlayer();
        const result = await claimPlayerSession(playerId, 'sessionA', 'roomA', 'draft');
        expect(result).toBe('claimed');
        const doc = await playerModel.findOne({ playerId }).lean();
        expect(doc?.sessionId).toBe('sessionA');
        expect(doc?.sessionRoomId).toBe('roomA');
        expect(doc?.sessionPhase).toBe('draft');
        expect(doc?.sessionHeartbeatAt).toBeInstanceOf(Date);
    });

    it('rejects a second claim while the first is live — this is the actual exploit fix', async () => {
        const playerId = await seedFreePlayer();
        expect(await claimPlayerSession(playerId, 'sessionA', 'roomA', 'draft')).toBe('claimed');
        expect(await claimPlayerSession(playerId, 'sessionB', 'roomB', 'fight')).toBe('busy');
        // The first claim must be untouched by the rejected attempt.
        const doc = await playerModel.findOne({ playerId }).lean();
        expect(doc?.sessionId).toBe('sessionA');
        expect(doc?.sessionPhase).toBe('draft');
    });

    it('is idempotent for a re-claim by the same sessionId', async () => {
        const playerId = await seedFreePlayer();
        expect(await claimPlayerSession(playerId, 'sessionA', 'roomA', 'draft')).toBe('claimed');
        expect(await claimPlayerSession(playerId, 'sessionA', 'roomA', 'draft')).toBe('claimed');
    });

    it('returns not-found for an id with no player document', async () => {
        const missingId = nextTestPlayerId--;
        expect(await claimPlayerSession(missingId, 'sessionA', 'roomA', 'draft')).toBe('not-found');
    });

    it('self-heals once the previous claim is stale — the fix for the 21 pre-existing permanently-locked characters', async () => {
        const playerId = await seedFreePlayer();
        expect(await claimPlayerSession(playerId, 'sessionA', 'roomA', 'draft')).toBe('claimed');
        // Backdate the heartbeat past the TTL, simulating a crashed room that never released.
        await playerModel.updateOne(
            { playerId },
            { $set: { sessionHeartbeatAt: new Date(Date.now() - SESSION_CLAIM_TTL_MS - 1000) } },
        );
        const result = await claimPlayerSession(playerId, 'sessionB', 'roomB', 'fight');
        expect(result).toBe('claimed');
        const doc = await playerModel.findOne({ playerId }).lean();
        expect(doc?.sessionId).toBe('sessionB');
        expect(doc?.sessionPhase).toBe('fight');
    });

    it('a document with no heartbeat at all (pre-fix legacy shape) is claimable', async () => {
        const playerId = nextTestPlayerId--;
        createdIds.push(playerId);
        // No sessionHeartbeatAt field at all — exactly the shape of the pre-existing stuck
        // documents this feature needed to heal, not just prevent going forward.
        await new playerModel({ playerId, originalPlayerId: playerId, name: 'LegacyStuck', sessionId: 'someOldDeadSession' }).save();
        expect(await claimPlayerSession(playerId, 'sessionNew', 'roomNew', 'draft')).toBe('claimed');
    });

    it('exactly one of many concurrent claimants wins', async () => {
        const playerId = await seedFreePlayer();
        const results = await Promise.all(
            Array.from({ length: 10 }, (_, i) => claimPlayerSession(playerId, `session${i}`, `room${i}`, 'draft')),
        );
        expect(results.filter(r => r === 'claimed')).toHaveLength(1);
        expect(results.filter(r => r === 'busy')).toHaveLength(9);
    });

    it('touchPlayerSession refreshes the heartbeat only for the current owner', async () => {
        const playerId = await seedFreePlayer();
        await claimPlayerSession(playerId, 'sessionA', 'roomA', 'draft');
        const before = (await playerModel.findOne({ playerId }).lean())?.sessionHeartbeatAt;
        await new Promise(r => setTimeout(r, 5));
        expect(await touchPlayerSession(playerId, 'sessionA')).toBe(true);
        const after = (await playerModel.findOne({ playerId }).lean())?.sessionHeartbeatAt;
        expect(after!.getTime()).toBeGreaterThan(before!.getTime());

        expect(await touchPlayerSession(playerId, 'someoneElse')).toBe(false);
    });

    it('releasePlayerSession only releases the matching session, never steals from a newer claim', async () => {
        const playerId = await seedFreePlayer();
        await claimPlayerSession(playerId, 'sessionA', 'roomA', 'draft');

        // A stray release from a session that no longer owns the claim (e.g. a rejected join, or
        // a zombie room whose claim was already TTL-stolen) must be a no-op.
        expect(await releasePlayerSession(playerId, 'someStaleSession')).toBe(false);
        let doc = await playerModel.findOne({ playerId }).lean();
        expect(doc?.sessionId).toBe('sessionA');

        expect(await releasePlayerSession(playerId, 'sessionA')).toBe(true);
        doc = await playerModel.findOne({ playerId }).lean();
        expect(doc?.sessionId).toBe('');
        expect(doc?.sessionHeartbeatAt).toBeUndefined();
        expect(doc?.sessionClaimedAt).toBeUndefined();
        expect(doc?.sessionRoomId).toBeUndefined();
        expect(doc?.sessionPhase).toBeUndefined();
    });

    it('a released character is immediately claimable again', async () => {
        const playerId = await seedFreePlayer();
        await claimPlayerSession(playerId, 'sessionA', 'roomA', 'draft');
        await releasePlayerSession(playerId, 'sessionA');
        expect(await claimPlayerSession(playerId, 'sessionB', 'roomB', 'fight')).toBe('claimed');
    });

    // clearAllSessionClaims's real, production call (app.config.ts's beforeListen) is
    // deliberately unscoped — "every claim in the database" — which is exactly why it must never
    // be exercised for real against this shared dev database from a test. Every call below is
    // scoped via extraFilter to only the playerIds this test itself created.
    describe('clearAllSessionClaims (scoped to this test\'s own documents)', () => {
        it('clears every live-looking claim matching the filter', async () => {
            const playerId1 = await seedFreePlayer();
            const playerId2 = await seedFreePlayer();
            await claimPlayerSession(playerId1, 'sessionA', 'roomA', 'draft');
            await claimPlayerSession(playerId2, 'sessionB', 'roomB', 'fight');

            const cleared = await clearAllSessionClaims({ playerId: { $in: [playerId1, playerId2] } });
            expect(cleared).toBe(2);

            for (const playerId of [playerId1, playerId2]) {
                const doc = await playerModel.findOne({ playerId }).lean();
                expect(doc?.sessionId).toBe('');
                expect(doc?.sessionHeartbeatAt).toBeUndefined();
                expect(doc?.sessionClaimedAt).toBeUndefined();
                expect(doc?.sessionRoomId).toBeUndefined();
                expect(doc?.sessionPhase).toBeUndefined();
            }
        });

        it('clears a claim regardless of how fresh its heartbeat is — unlike claimPlayerSession, this has no staleness check', async () => {
            const playerId = await seedFreePlayer();
            await claimPlayerSession(playerId, 'sessionA', 'roomA', 'draft');
            // Heartbeat is fresh (just claimed) — still must be cleared unconditionally, since a
            // freshly-restarted process has no way to know whether a heartbeat is "fresh" in a
            // way that matters; it's from a process that no longer exists either way.
            const cleared = await clearAllSessionClaims({ playerId });
            expect(cleared).toBe(1);
            expect((await playerModel.findOne({ playerId }).lean())?.sessionId).toBe('');
        });

        it('leaves documents with no claim untouched (no unnecessary write)', async () => {
            const playerId = await seedFreePlayer(); // sessionId: '' from the start
            const cleared = await clearAllSessionClaims({ playerId });
            expect(cleared).toBe(0);
        });

        it('a claim cleared this way is immediately claimable again', async () => {
            const playerId = await seedFreePlayer();
            await claimPlayerSession(playerId, 'sessionA', 'roomA', 'draft');
            await clearAllSessionClaims({ playerId });
            expect(await claimPlayerSession(playerId, 'sessionB', 'roomB', 'fight')).toBe('claimed');
        });
    });
});
