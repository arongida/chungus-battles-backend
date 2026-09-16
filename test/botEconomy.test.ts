import {
    economyUrgency, estimateWinRate, goldToPowerRate, incomeValue, isRerollFree, levelUpGoldCost,
    levelUpValue, remainingFights, rerollExpectedGain,
} from '../src/bot/v2/economy';
import { makePlayer } from './helpers/botFixtures';

describe('remainingFights — the horizon that replaces v1\'s round <= 6 cutoff', () => {
    it('reads ~0.5 win rate at an empty record', () => {
        expect(estimateWinRate(makePlayer({ wins: 0, losses: 0 }))).toBeCloseTo(0.5, 6);
    });

    it('is long early with a full life bar', () => {
        expect(remainingFights(makePlayer({ wins: 0, losses: 0, lives: 4 }))).toBeGreaterThan(6);
    });

    it('collapses when one more loss ends the run', () => {
        const desperate = remainingFights(makePlayer({ wins: 9, losses: 3, lives: 1 }));
        const healthy = remainingFights(makePlayer({ wins: 0, losses: 0, lives: 4 }));
        expect(desperate).toBeLessThan(healthy);
        expect(desperate).toBeLessThan(5);
    });

    it('is bounded by the wins still needed, not just by lives', () => {
        // 11 wins in, plenty of lives: only one fight's worth of horizon left.
        expect(remainingFights(makePlayer({ wins: 11, losses: 0, lives: 4 }))).toBeLessThan(3);
    });
});

describe('incomeValue', () => {
    it('prices income as one gold per remaining fight', () => {
        const p = makePlayer({ wins: 0, losses: 0, lives: 4 });
        expect(incomeValue(1, p, 1)).toBeCloseTo(remainingFights(p), 6);
    });

    it('is worth far less at the end of a run than at the start', () => {
        const early = incomeValue(1, makePlayer({ wins: 0, losses: 0, lives: 4 }), 1);
        const late = incomeValue(1, makePlayer({ wins: 9, losses: 3, lives: 1 }), 1);
        expect(late).toBeLessThan(early / 2);
    });

    it('is zero for no change', () => {
        expect(incomeValue(0, makePlayer(), 1)).toBe(0);
    });
});

describe('goldToPowerRate', () => {
    it('is the median power-per-gold across the shop', () => {
        expect(goldToPowerRate([
            { value: 10, price: 10 },   // 1.0
            { value: 4, price: 10 },    // 0.4
            { value: 12, price: 10 },   // 1.2
        ])).toBeCloseTo(1.0, 6);
    });

    it('falls back rather than returning 0 or Infinity for a degenerate shop', () => {
        for (const samples of [
            [],
            [{ value: 5, price: 0 }],
            [{ value: 0, price: 10 }],
            [{ value: NaN, price: 10 }],
        ]) {
            const rate = goldToPowerRate(samples);
            expect(Number.isFinite(rate)).toBe(true);
            expect(rate).toBeGreaterThan(0);
        }
    });

    it('ignores free items rather than treating them as infinitely efficient', () => {
        expect(goldToPowerRate([{ value: 50, price: 0 }, { value: 5, price: 10 }])).toBeCloseTo(0.5, 6);
    });

    it('clamps an absurd outlier', () => {
        expect(goldToPowerRate([{ value: 1e9, price: 1 }])).toBeLessThanOrEqual(5);
    });
});

describe('rerollExpectedGain', () => {
    it('does not take a free reroll on an excellent shop', () => {
        const player = makePlayer({ freeRerollCharges: 1 });
        expect(isRerollFree(player)).toBe(true);
        // One standout slot far above the rest: another draw is unlikely to beat it.
        expect(rerollExpectedGain([40, 2, 1, 1], player, 1)).toBeLessThan(0);
    });

    it('takes a free reroll on a uniformly poor shop', () => {
        const player = makePlayer({ freeRerollCharges: 1 });
        expect(rerollExpectedGain([1, 1, 1, 1], player, 1)).toBeGreaterThanOrEqual(0);
    });

    it('charges the reroll cost when it is not free', () => {
        const free = makePlayer({ freeRerollCharges: 1, refreshShopCost: 5 });
        const paid = makePlayer({ freeRerollCharges: 0, refreshShopCost: 5 });
        expect(rerollExpectedGain([3, 2, 2, 1], paid, 1)).toBeLessThan(rerollExpectedGain([3, 2, 2, 1], free, 1));
    });

    it('scales with archetype reroll appetite', () => {
        const player = makePlayer({ freeRerollCharges: 1 });
        const shop = [5, 2, 2, 1];
        expect(rerollExpectedGain(shop, player, 1, 1.8)).toBeGreaterThan(rerollExpectedGain(shop, player, 1, 1));
    });

    it('is zero for an empty shop', () => {
        expect(rerollExpectedGain([], makePlayer(), 1)).toBe(0);
    });
});

describe('level up', () => {
    it('costs gold in 4-gold steps toward the next level', () => {
        expect(levelUpGoldCost(makePlayer({ xp: 0, maxXp: 10 }))).toBe(12);
        expect(levelUpGoldCost(makePlayer({ xp: 8, maxXp: 10 }))).toBe(4);
        expect(levelUpGoldCost(makePlayer({ xp: 10, maxXp: 10 }))).toBe(0);
    });

    it('is worth more when the talent point it buys is worth more', () => {
        const p = makePlayer({ level: 1 });
        expect(levelUpValue(p, 20, 1)).toBeGreaterThan(levelUpValue(p, 5, 1));
    });

    it('credits the better shop the new level unlocks', () => {
        expect(levelUpValue(makePlayer({ level: 1 }), 0, 1)).toBeGreaterThan(0);
    });
});

describe('economyUrgency', () => {
    it('leans into economy while healthy and into combat when nearly dead', () => {
        const healthy = economyUrgency(makePlayer({ lives: 4, wins: 0, losses: 0 }));
        const dying = economyUrgency(makePlayer({ lives: 1, wins: 4, losses: 3 }));
        expect(healthy.economyWeight).toBeGreaterThan(dying.economyWeight);
        expect(dying.combatWeight).toBeGreaterThan(healthy.combatWeight);
    });

    it('lets a risk-tolerant archetype invest more', () => {
        const p = makePlayer({ lives: 3 });
        expect(economyUrgency(p, 1.3).economyWeight).toBeGreaterThan(economyUrgency(p, 0.85).economyWeight);
    });
});
