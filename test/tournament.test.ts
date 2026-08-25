import { ColyseusTestServer, boot } from '@colyseus/testing';
import { server } from '../src/app.config';
import { getNextPlayerId, getPlayer, playerModel, snapshotPlayer } from '../src/players/db/Player';
import { TournamentFightRoom } from '../src/tournament/TournamentFightRoom';
import {
    buildStandings,
    computeGamesPerPairing,
    sideForGauntletGame,
    sideForPlayoffGame,
} from '../src/tournament/TournamentRunner';
import { TournamentPairing } from '../src/tournament/db/Tournament';
import mongoose from 'mongoose';

// ---------------------------------------------------------------------------------------------
// Pure logic — no live MongoDB required (same reasoning as matchmaking.test.ts).
// ---------------------------------------------------------------------------------------------

describe('computeGamesPerPairing', () => {
    // Matches the plan's budget table exactly: K = clamp(evenize(ceil(60/(n-1))), 2, 20).
    it.each([
        [2, 20],
        [3, 20], // ceil(60/2)=30 -> clamp to 20
        [4, 20],
        [5, 16], // ceil(60/4)=15 -> evenize 16
        [8, 10],
        [11, 6],
        [13, 6],
    ])('n=%i -> K=%i', (n, expected) => {
        expect(computeGamesPerPairing(n)).toBe(expected);
    });

    it('returns 0 for fewer than 2 entrants', () => {
        expect(computeGamesPerPairing(0)).toBe(0);
        expect(computeGamesPerPairing(1)).toBe(0);
    });

    it('never returns an odd number', () => {
        for (let n = 2; n <= 20; n++) {
            expect(computeGamesPerPairing(n) % 2).toBe(0);
        }
    });
});

describe('side assignment', () => {
    it('gauntlet games alternate every index', () => {
        expect(sideForGauntletGame(0)).toBe(true);
        expect(sideForGauntletGame(1)).toBe(false);
        expect(sideForGauntletGame(2)).toBe(true);
        expect(sideForGauntletGame(3)).toBe(false);
    });

    it('playoff games 1-4 alternate, then the decider gives the higher seed (A) the enemy slot', () => {
        expect(sideForPlayoffGame(0)).toBe(true);
        expect(sideForPlayoffGame(1)).toBe(false);
        expect(sideForPlayoffGame(2)).toBe(true);
        expect(sideForPlayoffGame(3)).toBe(false);
        expect(sideForPlayoffGame(4)).toBe(false); // decider: A is NOT state.player
        expect(sideForPlayoffGame(5)).toBe(false);
    });
});

describe('buildStandings', () => {
    const roster = [
        { originalPlayerId: 1, name: 'Alice' },
        { originalPlayerId: 2, name: 'Bob' },
        { originalPlayerId: 3, name: 'Carol' },
    ];

    function game(result: 'win' | 'lose' | 'draw', aDamageDealt = 100, aDamageTaken = 50, durationMs = 1000): any {
        return { gameIndex: 0, aIsPlayer: true, result, durationMs, aDamageDealt, aDamageTaken };
    }

    it('ranks by fight win-rate, not match wins', () => {
        // Alice: 1 fight vs Bob (win). Bob: also fought Carol 4 times and lost 3 of them, but won
        // their single meeting with Alice — a plain "match wins" count would still show Bob with
        // one win over Alice; win-rate must separate them by their much larger sample vs Carol.
        const pairings: TournamentPairing[] = [
            { aId: 1, bId: 2, aWins: 1, bWins: 0, draws: 0, games: [game('win')] },
            { aId: 2, bId: 3, aWins: 1, bWins: 3, draws: 0, games: [game('win'), game('lose'), game('lose'), game('lose')] },
        ];
        const standings = buildStandings(roster, pairings);
        const byName = Object.fromEntries(standings.map(s => [s.name, s]));
        expect(byName['Carol'].winRate).toBeCloseTo(3 / 4);
        expect(byName['Alice'].winRate).toBeCloseTo(1);
        expect(byName['Bob'].winRate).toBeCloseTo(1 / 5);
        expect(standings[0].name).toBe('Alice');
        expect(standings[standings.length - 1].name).toBe('Bob');
    });

    it('breaks a two-way tie on head-to-head record', () => {
        const pairings: TournamentPairing[] = [
            // Alice beat Bob directly (1-0). Against Carol, Alice goes 0-3 and Bob goes 1-2, which
            // brings both of them to an identical overall 1-3 (winRate 0.25) record — so only the
            // head-to-head result (not win-rate) can separate them. Carol ends up far ahead of
            // both (5-1) so she isn't part of the tied group.
            { aId: 1, bId: 2, aWins: 1, bWins: 0, draws: 0, games: [game('win')] },
            { aId: 1, bId: 3, aWins: 0, bWins: 3, draws: 0, games: [game('lose'), game('lose'), game('lose')] },
            { aId: 2, bId: 3, aWins: 1, bWins: 2, draws: 0, games: [game('win'), game('lose'), game('lose')] },
        ];
        const standings = buildStandings(roster, pairings);
        const alice = standings.find(s => s.name === 'Alice')!;
        const bob = standings.find(s => s.name === 'Bob')!;
        const carol = standings.find(s => s.name === 'Carol')!;
        expect(alice.winRate).toBeCloseTo(0.25);
        expect(bob.winRate).toBeCloseTo(0.25);
        expect(carol.winRate).toBeCloseTo(5 / 6);
        expect(alice.seed).toBeLessThan(bob.seed);
    });

    it('falls back to damage differential when a tied group is larger than 2', () => {
        // All three go 1-1 (a three-way cycle: Alice > Bob, Bob > Carol, Carol > Alice) —
        // head-to-head can't resolve a tied group of 3 without risking a non-transitive sort, so
        // damage differential must decide it. Numbers are chosen so the correct order (by damage
        // diff: Carol +125, Alice +45, Bob -170) is NOT the same as originalPlayerId order
        // (Alice=1, Bob=2, Carol=3) — if the sort fell back to id instead of actually using
        // damage, this would catch it.
        const pairings: TournamentPairing[] = [
            { aId: 1, bId: 2, aWins: 1, bWins: 0, draws: 0, games: [game('win', 100, 10)] },
            { aId: 2, bId: 3, aWins: 1, bWins: 0, draws: 0, games: [game('win', 10, 90)] },
            { aId: 3, bId: 1, aWins: 1, bWins: 0, draws: 0, games: [game('win', 50, 5)] },
        ];
        const standings = buildStandings(roster, pairings);
        expect(standings.map(s => s.name)).toEqual(['Carol', 'Alice', 'Bob']);
    });

    it('assigns seed 1..N in final order', () => {
        const pairings: TournamentPairing[] = [{ aId: 1, bId: 2, aWins: 1, bWins: 0, draws: 0, games: [game('win')] }];
        const standings = buildStandings(roster, pairings);
        standings.forEach((row, i) => expect(row.seed).toBe(i + 1));
    });
});

// ---------------------------------------------------------------------------------------------
// Headless fight smoke test — requires a live MongoDB (DB_CONNECTION_STRING), same as room.test.ts.
// The critical assertion is #3: a tournament fight must never mutate the `players` collection.
// ---------------------------------------------------------------------------------------------

describe('TournamentFightRoom (headless fights)', () => {
    let colyseus: ColyseusTestServer;

    beforeAll(async () => {
        await mongoose.connect(process.env.DB_CONNECTION_STRING!, { autoIndex: true });
        colyseus = await boot(server);
    });

    afterAll(async () => {
        await colyseus.shutdown();
        mongoose.disconnect();
    });

    afterEach(async () => {
        await colyseus.cleanup();
    });

    async function createThrowawayCharacter(name: string): Promise<number> {
        const playerId = await getNextPlayerId();
        const room = await colyseus.createRoom('draft_room', {});
        const client = await colyseus.connectTo(room, { playerId, name, avatarUrl: 'test_avatar' });
        await new Promise<void>(r => setTimeout(r, 2500));
        await client.leave(true);
        // DraftRoom.onLeave (copyPlayer + updatePlayer) isn't awaited by the leave call — poll
        // until the session clears, same pattern room.test.ts uses before joining a fight room.
        await new Promise<void>((resolve, reject) => {
            const poll = setInterval(async () => {
                const player = await getPlayer(playerId);
                if (player && player.sessionId === '') {
                    clearInterval(poll);
                    resolve();
                }
            }, 200);
            setTimeout(() => { clearInterval(poll); reject(new Error('Timed out waiting for player session to clear')); }, 15000);
        });
        return playerId;
    }

    it('runs a fight headlessly and never mutates either character\'s players document', async () => {
        // Sequential, not Promise.all: getNextPlayerId() (players/db/Player.ts) isn't
        // concurrency-safe — two parallel calls can both read the same "last player" before
        // either insert lands and collide on one playerId.
        const playerIdA = await createThrowawayCharacter('TourneyA');
        const playerIdB = await createThrowawayCharacter('TourneyB');

        const [playerA, playerB] = await Promise.all([getPlayer(playerIdA), getPlayer(playerIdB)]);
        const snapshotA = snapshotPlayer(playerA);
        const snapshotB = snapshotPlayer(playerB);

        const rawBefore = await Promise.all([
            playerModel.findOne({ playerId: playerIdA }).lean(),
            playerModel.findOne({ playerId: playerIdB }).lean(),
        ]);

        const room = (await colyseus.createRoom('tournament_fight', {})) as unknown as TournamentFightRoom;
        await room.initialize();
        const outcome = await room.runFight(snapshotA, snapshotB, 8);

        expect(['win', 'lose', 'draw']).toContain(outcome.result);
        expect(outcome.replay).not.toBeNull();
        expect(outcome.replay!.events.length).toBeGreaterThan(0);
        expect(outcome.durationMs).toBeGreaterThan(0);

        const rawAfter = await Promise.all([
            playerModel.findOne({ playerId: playerIdA }).lean(),
            playerModel.findOne({ playerId: playerIdB }).lean(),
        ]);

        // The guard against progression leakage: a headless fight must be a pure read of the
        // roster snapshots it was given, with zero writes back to `players` for either side.
        expect(rawAfter[0]).toEqual(rawBefore[0]);
        expect(rawAfter[1]).toEqual(rawBefore[1]);
    }, 60000);

    it('runs a second fight in the same room instance without leaking state between fights', async () => {
        const playerIdA = await createThrowawayCharacter('TourneyC');
        const playerIdB = await createThrowawayCharacter('TourneyD');
        const playerIdC = await createThrowawayCharacter('TourneyE');
        const [playerA, playerB, playerC] = await Promise.all([getPlayer(playerIdA), getPlayer(playerIdB), getPlayer(playerIdC)]);
        const snapA = snapshotPlayer(playerA);
        const snapB = snapshotPlayer(playerB);
        const snapC = snapshotPlayer(playerC);

        const room = (await colyseus.createRoom('tournament_fight', {})) as unknown as TournamentFightRoom;
        await room.initialize();

        const first = await room.runFight(snapA, snapB, 8);
        const second = await room.runFight(snapA, snapC, 8);

        expect(['win', 'lose', 'draw']).toContain(first.result);
        expect(['win', 'lose', 'draw']).toContain(second.result);
        // Each fight's replay must stand on its own — a leaked/reused recorder would either share
        // events across fights or come back empty on the second run.
        expect(first.replay!.events.length).toBeGreaterThan(0);
        expect(second.replay!.events.length).toBeGreaterThan(0);
    }, 60000);
});
