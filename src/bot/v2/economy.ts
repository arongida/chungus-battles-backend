/**
 * Puts gold, income and XP on the same scale as combat power, so the policy can compare "buy this
 * sword" against "reroll", "level up" and "bank the gold" with one argmax instead of a fixed
 * priority order.
 *
 * v1's entire economy was a single income weight flipped by a hard `round <= 6` cutoff, plus a
 * one-reroll gold reserve and a 12-gold XP ceiling. None of it knew how many fights were left, and
 * none of it knew the player was one loss from dying. This file replaces all three.
 *
 * Two exact facts from the live game anchor everything here:
 *   - Fight payout is `Math.floor(player.income)` and `baseStats.income += 1` after every fight
 *     (FightRoom's fight-end block). So +1 income is worth exactly +1 gold per REMAINING fight —
 *     the horizon is the only unknown, and remainingFights() estimates it.
 *   - A run ends at WINS_TO_WIN wins or 0 lives, whichever comes first.
 */
import { BotClass, DraftObservation, PlayerView, StatBlock, TalentView } from '../BotPolicy';
import { WINS_TO_WIN } from '../../common/types';
import { TalentType } from '../../talents/types/TalentTypes';

/** Non-warrior start; warriors get 5. Only used to scale urgency, so the 1-life difference on a
 *  warrior just makes it very slightly more cautious than it needs to be. */
const NOMINAL_STARTING_LIVES = 4;

/** Keeps a 0-0 record from claiming certainty in either direction. */
const WIN_RATE_MIN = 0.25;
const WIN_RATE_MAX = 0.85;

const MIN_REMAINING_FIGHTS = 1;
const MAX_REMAINING_FIGHTS = 20;

/** Bounds on power-per-gold, so a degenerate shop (everything sold, everything worthless) can't
 *  produce a rate of 0 or infinity and poison every gold-denominated comparison. */
const RATE_MIN = 0.02;
const RATE_MAX = 5;
const FALLBACK_RATE = 0.35;

/** E[max of n fresh draws] ≈ mean + SPREAD_CAPTURE * σ — an order-statistic stand-in that avoids
 *  modelling the item pool. Must be estimated from DISPERSION, never anchored to the current best:
 *  anchoring makes one standout slot inflate the estimate, i.e. predicts a reroll is most valuable
 *  exactly when the shop is already great. */
const REROLL_SPREAD_CAPTURE = 1.0;
/** Floor on σ as a fraction of the mean. Four identical slots have zero sample variance, which is
 *  a small-sample artifact, not evidence that the pool is flat — without this the bot would sit on
 *  a uniformly terrible shop holding a free reroll. */
const REROLL_MIN_DISPERSION = 0.15;
/** Hard stop on rerolls in one round. A cost-based limit is not enough on its own: Fortune's Fool
 *  makes every reroll free, so without this the bot can keep rerolling a mediocre shop forever
 *  (and Fortune's Fool charges starting HP for each one). */
export const MAX_REROLLS_PER_ROUND = 6;

/** Extra shop value unlocked per level, in gold-equivalent: higher tiers and rarities appear.
 *  Indexed by the level being bought INTO. */
const SHOP_TIER_VALUE: Record<number, number> = { 2: 6, 3: 8, 4: 10, 5: 12 };

const XP_PER_GOLD = 1; // buy_xp is 4 gold -> 4 xp

/** Rerolls a round the bot is assumed to take while each one costs gold. */
export const BASE_REROLLS_PER_ROUND = 1.5;
/** Rerolls a round once they are free — more digging, still bounded by MAX_REROLLS_PER_ROUND and
 *  (for Fortune's Fool) by the HP each one costs. */
export const FREE_REROLLS_PER_ROUND = 3;
/** Mirrors ShopUpgradeUtils' BARGAIN_HUNTER_FREE_REROLLS / VIP_PASS_REROLL_SURCHARGE — not imported,
 *  because that module drags in the Mongoose item models. */
export const BARGAIN_HUNTER_FREE_REROLLS = 3;
export const VIP_PASS_REROLL_SURCHARGE = 1;

/** Stats each class gains on EVERY level up. Mirrors DraftRoom.levelUp's class switch (plus the
 *  flat +20 max HP every class gets) — keep in step with it. */
export const CLASS_LEVEL_UP_STATS: Record<BotClass, Partial<StatBlock>> = {
    warrior: { maxHp: 80, strength: 6 },
    rogue: { maxHp: 20, attackSpeed: 1.2, dodgeRate: 10 },
    merchant: { maxHp: 40, income: 2 },
};

export function clamp(x: number, lo: number, hi: number): number {
    return Math.min(hi, Math.max(lo, x));
}

/** Laplace-smoothed win rate — at 0-0 it reads 0.5 rather than dividing by zero or claiming 100%. */
export function estimateWinRate(p: PlayerView): number {
    return clamp((p.wins + 1) / (p.wins + p.losses + 2), WIN_RATE_MIN, WIN_RATE_MAX);
}

/**
 * How many more fights this run is expected to last — whichever ends it first, reaching
 * WINS_TO_WIN or running out of lives. This is the whole tempo/risk model: at round 1, 0-0 with 4
 * lives it returns ~8, so +1 income is worth ~8 gold and investing is right; at 9-3 with 1 life it
 * returns ~3, income collapses, and the policy spends on combat power instead.
 */
export function remainingFights(p: PlayerView): number {
    const pw = estimateWinRate(p);
    const toWin = (WINS_TO_WIN - p.wins) / pw;
    const toDeath = p.lives / (1 - pw);
    return clamp(Math.min(toWin, toDeath), MIN_REMAINING_FIGHTS, MAX_REMAINING_FIGHTS);
}

/**
 * Power per gold, read off the shop the bot is actually looking at. Self-calibrating: it tracks a
 * rebalance automatically and needs no hand-picked constant.
 *
 * No circularity — `value` here must be a COMBAT-ONLY valuation (marginal power + synergy), which
 * contains no gold term, so there is no fixed point to solve. Callers must not pass a value that
 * was itself computed using this rate.
 */
export function goldToPowerRate(samples: { value: number; price: number }[]): number {
    const rates = samples
        .filter((s) => s.price > 0 && Number.isFinite(s.value))
        .map((s) => s.value / s.price)
        .filter((r) => r > 0)
        .sort((a, b) => a - b);
    if (rates.length === 0) return FALLBACK_RATE;
    const mid = Math.floor(rates.length / 2);
    const median = rates.length % 2 === 0 ? (rates[mid - 1] + rates[mid]) / 2 : rates[mid];
    return clamp(median, RATE_MIN, RATE_MAX);
}

/** +1 income pays +1 gold at the end of every remaining fight. */
export function incomeValue(deltaIncome: number, player: PlayerView, rate: number): number {
    if (!deltaIncome) return 0;
    return deltaIncome * remainingFights(player) * rate;
}

export function goldValue(gold: number, rate: number): number {
    return gold * rate;
}

/**
 * Expected power gained by rerolling, net of its cost. Estimated from the CURRENT shop's own score
 * distribution: a fresh shop is another draw from the same pool, so the spread between its mean
 * and its best slot is what another draw can be expected to reach for.
 *
 * Note this is what fixes v1 burning a free reroll on an excellent shop: a free reroll only sets
 * the cost term to zero, and when the current best is already far above the mean the expected gain
 * is still negative.
 */
export function rerollExpectedGain(
    shopValues: number[], player: PlayerView, rate: number, appetite = 1,
): number {
    if (shopValues.length === 0) return 0;
    const best = Math.max(...shopValues);
    const mean = shopValues.reduce((a, b) => a + b, 0) / shopValues.length;
    const variance = shopValues.reduce((acc, v) => acc + (v - mean) ** 2, 0) / shopValues.length;
    const sigma = Math.max(Math.sqrt(variance), Math.abs(mean) * REROLL_MIN_DISPERSION);
    // Appetite scales the UPSIDE a build believes a fresh draw holds, not the finished gain —
    // multiplying the gain directly would make a reroll-hungry archetype more reluctant whenever
    // the estimate came out negative. Each reroll already taken this round shrinks that upside:
    // more of the pool has been seen, so another draw is less likely to turn up something new.
    const seen = 1 / (1 + player.rerollsThisRound);
    const expectedBest = mean + sigma * REROLL_SPREAD_CAPTURE * appetite * seen;
    const cost = isRerollFree(player) ? 0 : player.refreshShopCost * rate;
    return expectedBest - best - cost;
}

export function isRerollFree(player: PlayerView): boolean {
    return player.freeRerolls || player.freeRerollCharges > 0;
}

/** Gold cost of buying exactly enough XP to reach the next level (buy_xp is 4 gold -> 4 xp). */
export function levelUpGoldCost(player: PlayerView): number {
    const xpNeeded = player.maxXp - player.xp;
    if (xpNeeded <= 0) return 0;
    return Math.ceil(xpNeeded / 4) * 4 * XP_PER_GOLD;
}

/**
 * Value of reaching the next level: the talent point it grants (priced by the caller, which knows
 * the talent catalog), the better shop it unlocks, and — passed in by the caller, which has the
 * power model — the class's level-up stat grant.
 */
export function levelUpValue(player: PlayerView, expectedTalentPower: number, rate: number, classStatPower = 0): number {
    const nextLevel = player.level + 1;
    return expectedTalentPower + (SHOP_TIER_VALUE[nextLevel] ?? 0) * rate + classStatPower;
}

export interface RerollExpectation {
    /** Rerolls a round the build is expected to take. */
    rerolls: number;
    /** How many of those are paid for — the ones a reroll surcharge (Comrade, VIP) actually taxes. */
    paid: number;
}

/**
 * Rerolls a round for a given talent set. This is what makes the reroll-tax talents interact:
 * Comrade's surcharge and VIP's +1 bite only on PAID rerolls, so Fortune's Fool (every reroll free)
 * or Bargain Hunter (the first few free) turns their downside off.
 */
export function expectedRerolls(talents: TalentView[]): RerollExpectation {
    if (talents.some((t) => t.talentId === TalentType.FORTUNES_FOOL)) {
        return { rerolls: FREE_REROLLS_PER_ROUND, paid: 0 };
    }
    if (talents.some((t) => t.talentId === TalentType.BARGAIN_HUNTER)) {
        const free = BARGAIN_HUNTER_FREE_REROLLS;
        const rerolls = Math.max(BASE_REROLLS_PER_ROUND, Math.min(FREE_REROLLS_PER_ROUND, free));
        return { rerolls, paid: Math.max(0, rerolls - free) };
    }
    return { rerolls: BASE_REROLLS_PER_ROUND, paid: BASE_REROLLS_PER_ROUND };
}

/** The reroll price with the talent surcharges taken back out — what a free reroll really saves.
 *  `refreshShopCost` is read live and already includes Comrade's income and VIP's +1. */
export function baseRerollCost(player: PlayerView): number {
    let cost = player.refreshShopCost;
    if (player.talents.some((t) => t.talentId === TalentType.COMRADE)) cost -= Math.floor(Math.max(0, player.stats.income));
    if (player.talents.some((t) => t.talentId === TalentType.VIP_PASS)) cost -= VIP_PASS_REROLL_SURCHARGE;
    return Math.max(1, cost);
}

/**
 * How the build should lean right now. Low lives means a loss ends the run, so combat power gets
 * urgent and long-horizon economy stops paying; a healthy board with many fights left can invest.
 * `riskTolerance` comes from the archetype.
 */
export function economyUrgency(player: PlayerView, riskTolerance = 1): { economyWeight: number; combatWeight: number } {
    const livesFraction = clamp(player.lives / NOMINAL_STARTING_LIVES, 0, 1);
    const horizon = clamp(remainingFights(player) / 8, 0.5, 1.2);
    return {
        economyWeight: clamp(livesFraction * horizon * riskTolerance, 0.2, 1.6),
        combatWeight: 1 + (1 - livesFraction) / riskTolerance,
    };
}

/**
 * How much of the reference enemy should be the actual scouted opponent rather than the generic
 * round curve. The build has to last every remaining fight, so a long run leans generic; when one
 * more loss could end the run, this fight is the one that matters.
 */
export function scoutWeight(player: PlayerView): number {
    const livesFraction = clamp(player.lives / NOMINAL_STARTING_LIVES, 0, 1);
    return clamp(1 / remainingFights(player) + (1 - livesFraction) * 0.4, 0.2, 0.8);
}

/** Convenience for scorers that only have the observation to hand. */
export function urgencyFor(obs: DraftObservation, riskTolerance = 1) {
    return economyUrgency(obs.player, riskTolerance);
}
