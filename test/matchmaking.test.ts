import { pickVariedOpponent } from '../src/players/db/Player';

// Pure unit tests for the matchmaking picker used by getSameRoundPlayer — no live MongoDB
// required (unlike room.test.ts), since pickVariedOpponent takes plain candidate/history arrays.
describe('pickVariedOpponent', () => {
    it('returns null when there are no candidates', () => {
        expect(pickVariedOpponent([], [1, 2, 3])).toBeNull();
    });

    it('prefers a candidate not in the recent-opponent history', () => {
        const candidates = [
            { playerId: 10, originalPlayerId: 1 }, // recently fought
            { playerId: 20, originalPlayerId: 2 }, // fresh
        ];
        expect(pickVariedOpponent(candidates, [1])).toBe(20);
    });

    it('dedupes candidates by originalPlayerId so a multi-snapshot character is not weighted higher', () => {
        // Character 2 has three snapshots at this round; character 3 has one. With character 2
        // marked recent, the only fresh originalPlayerId is 3, so its snapshot must always win
        // regardless of how many duplicate rows character 2 contributed.
        const candidates = [
            { playerId: 21, originalPlayerId: 2 },
            { playerId: 22, originalPlayerId: 2 },
            { playerId: 23, originalPlayerId: 2 },
            { playerId: 30, originalPlayerId: 3 },
        ];
        expect(pickVariedOpponent(candidates, [2])).toBe(30);
    });

    it('falls back to the least-recently-fought character when every candidate is recent', () => {
        // recentIds is oldest → newest, so originalPlayerId 1 was fought longest ago.
        const candidates = [
            { playerId: 10, originalPlayerId: 1 },
            { playerId: 20, originalPlayerId: 2 },
            { playerId: 30, originalPlayerId: 3 },
        ];
        expect(pickVariedOpponent(candidates, [1, 2, 3])).toBe(10);
    });

    it('ignores recent-opponent ids that are not present in the candidate pool', () => {
        const candidates = [{ playerId: 10, originalPlayerId: 1 }];
        expect(pickVariedOpponent(candidates, [99, 100])).toBe(10);
    });

    it('treats an empty history as "everyone is fresh"', () => {
        const candidates = [{ playerId: 10, originalPlayerId: 1 }];
        expect(pickVariedOpponent(candidates, [])).toBe(10);
    });
});
