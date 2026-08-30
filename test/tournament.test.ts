import { ColyseusTestServer, boot } from '@colyseus/testing';
import { server } from '../src/app.config';
import { getNextPlayerId, getPlayer, playerModel, snapshotPlayer } from '../src/players/db/Player';
import { generatePlayerToken, reservePlayerId } from '../src/players/db/PlayerToken';
import { TournamentFightRoom } from '../src/tournament/TournamentFightRoom';
import {
    buildPlayoffBracket,
    buildStandings,
    computeGamesPerPairing,
    sideForGauntletGame,
    sideForPlayoffGame,
} from '../src/tournament/TournamentRunner';
import { PlayoffStage, TournamentPairing } from '../src/tournament/db/Tournament';
import mongoose from 'mongoose';
import { waitFor } from './helpers/waitFor';

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

describe('buildPlayoffBracket', () => {
    it('returns no matches for 0 or 1 entrants', () => {
        expect(buildPlayoffBracket(0)).toEqual([]);
        expect(buildPlayoffBracket(1)).toEqual([]);
    });

    it('2 entrants: a straight final', () => {
        expect(buildPlayoffBracket(2)).toEqual([
            { stage: 'FIN', aSeedIndex: 0, bSeedIndex: 1 },
        ]);
    });

    it('3 entrants: seed 1 byes to the final, 2v3 play in', () => {
        expect(buildPlayoffBracket(3)).toEqual([
            { stage: 'SF2', aSeedIndex: 1, bSeedIndex: 2 },
            { stage: 'FIN', aSeedIndex: 0, bSeedIndex: null, bDependsOn: 'SF2' },
        ]);
    });

    it('4 entrants: today\'s unchanged bracket (1v4, 2v3, final)', () => {
        expect(buildPlayoffBracket(4)).toEqual([
            { stage: 'SF1', aSeedIndex: 0, bSeedIndex: 3 },
            { stage: 'SF2', aSeedIndex: 1, bSeedIndex: 2 },
            { stage: 'FIN', aSeedIndex: null, bSeedIndex: null, aDependsOn: 'SF1', bDependsOn: 'SF2' },
        ]);
    });

    it('5 entrants: seed 1 byes to SF1, 4v5 play in, 2v3 is a normal semi', () => {
        expect(buildPlayoffBracket(5)).toEqual([
            { stage: 'PI', aSeedIndex: 3, bSeedIndex: 4 },
            { stage: 'SF1', aSeedIndex: 0, bSeedIndex: null, bDependsOn: 'PI' },
            { stage: 'SF2', aSeedIndex: 1, bSeedIndex: 2 },
            { stage: 'FIN', aSeedIndex: null, bSeedIndex: null, aDependsOn: 'SF1', bDependsOn: 'SF2' },
        ]);
    });

    it('6 entrants: seeds 1-2 bye to the semis, 3v6 and 4v5 play in', () => {
        expect(buildPlayoffBracket(6)).toEqual([
            { stage: 'QF1', aSeedIndex: 2, bSeedIndex: 5 },
            { stage: 'QF2', aSeedIndex: 3, bSeedIndex: 4 },
            { stage: 'SF1', aSeedIndex: 0, bSeedIndex: null, bDependsOn: 'QF2' },
            { stage: 'SF2', aSeedIndex: 1, bSeedIndex: null, bDependsOn: 'QF1' },
            { stage: 'FIN', aSeedIndex: null, bSeedIndex: null, aDependsOn: 'SF1', bDependsOn: 'SF2' },
        ]);
    });

    // Structural sanity check across every real bracket shape: runPlayoffStage executes slots in
    // array order and resolves a null seed index by reading `winners[dependsOn]`, populated by an
    // earlier iteration. If a dependsOn ever pointed at a stage that hadn't run yet, that read
    // would be undefined at runtime — this catches that class of bug at the data-table level,
    // without needing to run an actual tournament.
    it.each([2, 3, 4, 5, 6])('every dependsOn stage appears earlier in the array (N=%i)', (n) => {
        const bracket = buildPlayoffBracket(n);
        const seenStages = new Set<PlayoffStage>();
        for (const slot of bracket) {
            if (slot.aDependsOn) expect(seenStages.has(slot.aDependsOn)).toBe(true);
            if (slot.bDependsOn) expect(seenStages.has(slot.bDependsOn)).toBe(true);
            seenStages.add(slot.stage);
        }
    });

    it.each([2, 3, 4, 5, 6])('every slot has exactly one seed/dependsOn source per side (N=%i)', (n) => {
        for (const slot of buildPlayoffBracket(n)) {
            expect(slot.aSeedIndex !== null || slot.aDependsOn !== undefined).toBe(true);
            expect(slot.aSeedIndex !== null && slot.aDependsOn !== undefined).toBe(false);
            expect(slot.bSeedIndex !== null || slot.bDependsOn !== undefined).toBe(true);
            expect(slot.bSeedIndex !== null && slot.bDependsOn !== undefined).toBe(false);
        }
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
        // Required by DraftRoom.onAuth — see PlayerToken.ts and room.test.ts's
        // mintPlayerIdAndToken, which does the same thing (mirrors the real /playerid route).
        const playerToken = generatePlayerToken();
        await reservePlayerId(playerId, playerToken);
        const room = await colyseus.createRoom('draft_room', {});
        const client = await colyseus.connectTo(room, { playerId, playerToken, name, avatarUrl: 'test_avatar' });
        // onJoin has a 1000ms clock delay before any DB work, then builds the shop — waiting for
        // a populated shop is the concrete signal setup actually finished (same pattern
        // room.test.ts's createAndJoinDraftRoom uses), rather than a flat guess.
        await waitFor(() => room.state.shop.length > 0, { timeout: 5000, message: 'draft room shop to populate' });
        await client.leave(true);
        // DraftRoom.onLeave (copyPlayer + updatePlayer) isn't awaited by the leave call — poll
        // until the session clears, same pattern room.test.ts uses before joining a fight room.
        await waitFor(async () => {
            const player = await getPlayer(playerId);
            return !!player && player.sessionId === '';
        }, { timeout: 15000, interval: 100, message: `player ${playerId}'s session to clear` });
        return playerId;
    }

    it('runs a fight headlessly and never mutates either character\'s players document', async () => {
        // Sequential, not Promise.all: getNextPlayerId() is now atomic (see Counter.ts), so this
        // is no longer required for correctness — kept sequential anyway since these two throwaway
        // characters don't need to be created concurrently and it keeps the test's timing simple.
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
