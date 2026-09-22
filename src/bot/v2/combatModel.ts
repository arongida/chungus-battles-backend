/**
 * The v2 policy's model of combat strength. Pure — imports only observation types, like every
 * other file under src/bot/ except observation.ts.
 *
 * v1 scored a candidate with a linear weighted sum over its stat DELTA, never looking at the
 * player's absolute stats. That has no diminishing returns and no notion of a balanced build: a
 * 10th point of defense scored exactly like the 1st, and an all-strength glass cannon looked as
 * good as a rounded one. This file replaces that with an estimate of what the stats actually buy:
 *
 *      power = sqrt(DPS * effective HP)
 *
 * The PRODUCT is the right ordering — it is proportional to the damage you can land before dying,
 * and its partial derivatives are exactly the balance pressure we want: d/dDPS = EHP and
 * d/dEHP = DPS, so damage is worth more precisely when you are already tanky, and vice versa. The
 * bot builds balanced characters because the model says lopsided ones are worth less, not because
 * of a hand-tuned penalty. The sqrt is a monotone rescale (it preserves every ordering) that puts
 * the result back in damage-like units, which keeps `Δpower` roughly linear in gold spend across a
 * run so economy.ts's exchange rate stays stable from round 1 to round 15.
 *
 * Every formula below mirrors live game code and must keep mirroring it:
 *   - the damage roll and the per-weapon speed clamp: FightRoom.tryWeaponAttack / startSingleWeaponTimer
 *   - defense and dodge mitigation: PlayerSchema.getDamageAfterDefense / getDodgeChance
 *   - the accuracy-overflow rule and the stat clamps: statsUtils.recalculatePlayerStats
 *
 * Known approximation: scaling sources (scalingGraph.ts's SCALING_ORDER — Titan's Might, Bulwark,
 * Last Stand, ...) are not re-simulated here. For an item the player already OWNS their output is
 * already baked into `player.stats` by the aura pass, so absolute power is right; only the
 * marginal estimate for a CANDIDATE scaling source is understated, and synergy.ts prices those
 * explicitly via the scaling graph.
 */
import { DraftObservation, EnemyBuildView, EquipSlotName, ItemView, PlayerView, StatBlock } from '../BotPolicy';
import { scoutWeight } from './economy';

// --- tunables -------------------------------------------------------------------------------

/** Below this, `fightSeconds` stops shrinking — a nominal floor on how fast a fight can resolve. */
const MIN_FIGHT_SECONDS = 4;
/** FightRoom starts its escalating end-burn at 65s, so no fight realistically runs longer. */
const MAX_FIGHT_SECONDS = 45;
/**
 * The reference opponent's curve by round — see referenceEnemy for why it is a function of the
 * round and nothing else. Together these set the DPS↔EHP exchange the whole policy is calibrated
 * against, so they are the first thing to sweep if v2 underperforms v1: raising the defense/dodge
 * terms makes damage more valuable, raising dps/ehp makes survivability more valuable.
 */
const REF_DEFENSE_PER_ROUND = 8;
const REF_DODGE_PER_ROUND = 3;
const REF_DPS_BASE = 6;
const REF_DPS_PER_ROUND = 5;
const REF_EHP_BASE = 150;
const REF_EHP_PER_ROUND = 90;

/** FightRoom.createFistWeapon — injected when nothing equipped has baseAttackSpeed > 0. */
export const FIST: WeaponProfile = {
    baseMinDamage: 0, baseMaxDamage: 0, bonusMaxDamage: 0, baseAttackSpeed: 0.8, strengthScaling: 1,
};

// --- stat accumulation ----------------------------------------------------------------------

/** A pre-normalization accumulator, mirroring statsUtils' StatsSnapshot. Attack speed is tracked
 *  as a multiplier because that is what it is: AffectedStats.attackSpeed defaults to 1 meaning
 *  "no change", and sources accumulate as Σ(value - 1). */
export interface RawStats {
    strength: number;
    accuracy: number;
    defense: number;
    maxHp: number;
    dodgeRate: number;
    hpRegen: number;
    income: number;
    cooldownReduction: number;
    attackSpeedMultiplier: number;
}

export function rawStatsFromPlayer(p: PlayerView): RawStats {
    const s = p.stats;
    return {
        strength: s.strength, accuracy: s.accuracy, defense: s.defense, maxHp: s.maxHp,
        dodgeRate: s.dodgeRate, hpRegen: s.hpRegen, income: s.income,
        cooldownReduction: s.cooldownReduction, attackSpeedMultiplier: s.attackSpeed,
    };
}

export function cloneRaw(r: RawStats): RawStats {
    return { ...r };
}

/** Folds one affectedStats delta in (sign +1) or out (sign -1). Mirrors statsUtils' accumulate:
 *  additive for everything, and attack speed contributes `value - 1` — with 0 also meaning "no
 *  change", since an AffectedStats that was never assigned reads 0 rather than 1. */
export function addAffected(raw: RawStats, d: Partial<StatBlock> | undefined, sign: 1 | -1): RawStats {
    if (!d) return raw;
    raw.strength += sign * (d.strength ?? 0);
    raw.accuracy += sign * (d.accuracy ?? 0);
    raw.defense += sign * (d.defense ?? 0);
    raw.maxHp += sign * (d.maxHp ?? 0);
    raw.dodgeRate += sign * (d.dodgeRate ?? 0);
    raw.hpRegen += sign * (d.hpRegen ?? 0);
    raw.income += sign * (d.income ?? 0);
    raw.cooldownReduction += sign * (d.cooldownReduction ?? 0);
    const as = d.attackSpeed ?? 0;
    if (as !== 0 && as !== 1) raw.attackSpeedMultiplier += sign * (as - 1);
    return raw;
}

/**
 * The tail of statsUtils.recalculatePlayerStats, reproduced exactly. The accuracy-overflow rule is
 * the reason this can't be skipped: accuracy above strength does NOT keep adding min damage, it
 * splits the excess across both endpoints. Any model that adds accuracy linearly (v1 did, at
 * weight 0.8) is wrong past that knee.
 */
export function normalize(raw: RawStats): StatBlock {
    const rawStrength = Math.max(1, raw.strength);
    const rawAccuracy = Math.max(1, raw.accuracy);
    const overflow = Math.max(0, rawAccuracy - rawStrength) / 2;
    const maxHp = Math.max(1, raw.maxHp);
    return {
        maxHp,
        hp: maxHp,
        strength: rawStrength + overflow,
        accuracy: Math.min(rawAccuracy, rawStrength) + overflow,
        defense: Math.max(0, raw.defense),
        attackSpeed: raw.attackSpeedMultiplier,
        dodgeRate: Math.max(0, raw.dodgeRate),
        hpRegen: Math.max(0, raw.hpRegen),
        income: Math.max(0, raw.income),
        cooldownReduction: Math.max(0, raw.cooldownReduction),
    };
}

// --- weapons --------------------------------------------------------------------------------

export interface WeaponProfile {
    baseMinDamage: number;
    baseMaxDamage: number;
    bonusMaxDamage: number;
    baseAttackSpeed: number;
    strengthScaling: number;
}

export function weaponProfileOf(item: ItemView): WeaponProfile {
    return {
        baseMinDamage: item.baseMinDamage ?? 0,
        baseMaxDamage: item.baseMaxDamage ?? 0,
        bonusMaxDamage: item.bonusMaxDamage ?? 0,
        baseAttackSpeed: item.baseAttackSpeed ?? 0,
        strengthScaling: item.strengthScaling ?? 1,
    };
}

/** Exactly FightRoom.startWeaponAttackTimers' filter: only items with baseAttackSpeed > 0 get a
 *  timer, so a shield (always 0) never swings. Returns the real weapons only — possibly none; the
 *  fist fallback is applied at the point of use by `swingingWeapons`. */
export function weaponProfiles(equipped: Partial<Record<EquipSlotName, ItemView>>): WeaponProfile[] {
    const weapons: WeaponProfile[] = [];
    for (const item of Object.values(equipped)) {
        if (item && item.baseAttackSpeed > 0) weapons.push(weaponProfileOf(item));
    }
    return weapons;
}

/** The set that actually swings: non-swinging profiles dropped, and a fist injected when nothing
 *  is left. Applied inside estimateDps rather than by callers, so handing the model a shield (via
 *  a `LoadoutChange.addWeapon`, say) can never credit it with phantom damage. */
export function swingingWeapons(profiles: WeaponProfile[]): WeaponProfile[] {
    const swinging = profiles.filter((w) => w.baseAttackSpeed > 0);
    return swinging.length > 0 ? swinging : [FIST];
}

export interface ReferenceEnemy {
    defense: number;
    dodgeRate: number;
    dps: number;
    ehp: number;
    /** Swings per second across all of the enemy's weapons — drives on-attacked/on-dodge procs. */
    attackRate: number;
    /** 0 when unknown (the generic curve has no opinion on it). */
    strength: number;
}

/** The generic curve assumes one swing per second. */
export const NOMINAL_ENEMY_ATTACK_RATE = 1.0;
/** Nominal fight length used to fold a scouted enemy's regen into its HP pool. */
const SCOUT_NOMINAL_FIGHT_SECONDS = 20;

/** Fraction of an incoming hit that survives mitigation. Defense and dodge are the SAME reducer
 *  (`100/(100+x)` each) and they multiply — so +100 defense and +100 dodge are worth exactly the
 *  same, and v1's separate 0.9/0.5 weights had no basis. */
export function mitigation(stats: { defense: number; dodgeRate: number }): number {
    return (100 / (100 + Math.max(0, stats.defense))) * (100 / (100 + Math.max(0, stats.dodgeRate)));
}

export function dodgeChance(dodgeRate: number): number {
    return 1 - 100 / (100 + Math.max(0, dodgeRate));
}

/** Expected damage per second against `ref`, summed over every swinging weapon. Each weapon runs
 *  its own timer and applies the SHARED strength through its OWN strengthScaling, which is why a
 *  0.5-scaling staff and a 2.0-scaling greatsword must not be treated alike. */
export function estimateDps(stats: StatBlock, weapons: WeaponProfile[], ref: { defense: number; dodgeRate: number }): number {
    let raw = 0;
    for (const w of swingingWeapons(weapons)) {
        const speed = Math.max(0.1, w.baseAttackSpeed * stats.attackSpeed);
        const minDmg = w.baseMinDamage + stats.accuracy;
        const maxDmg = w.baseMaxDamage + w.bonusMaxDamage + stats.strength * w.strengthScaling;
        const avgHit = (minDmg + Math.max(minDmg, maxDmg)) / 2;
        raw += Math.max(0, avgHit) * speed;
    }
    return raw * mitigation(ref);
}

/** Regen is added to the raw pool BEFORE dividing by mitigation, which is the correct order: heal()
 *  restores real HP, and that HP then absorbs already-mitigated damage. */
export function estimateEhp(stats: StatBlock, fightSeconds: number): number {
    return (stats.maxHp + Math.max(0, stats.hpRegen) * fightSeconds) / mitigation(stats);
}

export function fightSeconds(dps: number, ref: ReferenceEnemy): number {
    const t = ref.ehp / Math.max(dps, 1e-6);
    return Math.min(MAX_FIGHT_SECONDS, Math.max(MIN_FIGHT_SECONDS, t));
}

/** `extra` folds in effects that aren't stats: a skill's per-fight damage total becomes extra DPS
 *  over the fight, and damage it denies or heals becomes extra effective HP. Routing them through
 *  the same sqrt(dps * ehp) keeps them commensurable with stat gains instead of being a second,
 *  unrelated currency. */
export function estimatePower(
    stats: StatBlock, weapons: WeaponProfile[], ref: ReferenceEnemy,
    extra: { dps?: number; ehp?: number } = {},
): number {
    const dps = estimateDps(stats, weapons, ref) + (extra.dps ?? 0);
    const ehp = estimateEhp(stats, fightSeconds(dps, ref)) + (extra.ehp ?? 0);
    return Math.sqrt(Math.max(0, dps) * Math.max(0, ehp));
}

/**
 * The enemy the power model scores against. A function of the ROUND ONLY — deliberately not of the
 * player's own board.
 *
 * Mirroring the player's stats is tempting (opponents come from getSameRoundPlayer, so they really
 * are drawn from the bot's own distribution, and a mirror self-calibrates through a rebalance).
 * It is also wrong, and subtly: with a mirrored reference, `power` stops being a function of the
 * board. Equipping a defense item raises the assumed enemy's defense, which shrinks the player's
 * own DPS term, so on the resulting board that same item looks like a liability — and the policy
 * equips it, unequips it, equips it again, forever. The convergence fuzz in test/botPolicyV2.test.ts
 * caught exactly that. The reference must depend only on state the bot's own decisions cannot
 * move.
 *
 * Balance pressure does not depend on the mirror anyway: it comes from the sqrt(dps * ehp) product,
 * whose marginals already make damage worth more on a tanky board and survivability worth more on
 * a fragile one.
 */
export function referenceEnemy(round: number): ReferenceEnemy {
    const r = Math.max(1, round);
    return {
        defense: REF_DEFENSE_PER_ROUND * r,
        dodgeRate: REF_DODGE_PER_ROUND * r,
        dps: REF_DPS_BASE + REF_DPS_PER_ROUND * r,
        ehp: REF_EHP_BASE + REF_EHP_PER_ROUND * r,
        attackRate: NOMINAL_ENEMY_ATTACK_RATE,
        strength: 0,
    };
}

/**
 * The actual next opponent, in the same units as referenceEnemy: `dps` is raw pre-mitigation
 * damage (the player's own defense/dodge is applied on the player's side), and `ehp` is HP over the
 * enemy's own mitigation — the convention the generic curve was tuned under.
 */
export function scoutedEnemy(build: EnemyBuildView): ReferenceEnemy {
    const stats = build.stats;
    const weapons = swingingWeapons(weaponProfiles(build.equipped));
    const attackRate = weapons.reduce((sum, w) => sum + Math.max(0.1, w.baseAttackSpeed * stats.attackSpeed), 0);
    return {
        defense: Math.max(0, stats.defense),
        dodgeRate: Math.max(0, stats.dodgeRate),
        dps: estimateDps(stats, weapons, { defense: 0, dodgeRate: 0 }),
        ehp: (Math.max(1, stats.maxHp) + Math.max(0, stats.hpRegen) * SCOUT_NOMINAL_FIGHT_SECONDS) / mitigation(stats),
        attackRate,
        strength: Math.max(0, stats.strength),
    };
}

/** Linear mix: `w` = 0 is the generic curve, 1 is the scouted enemy. Strength stays unknown (0)
 *  only when there is no scouted enemy at all. */
export function blendReference(generic: ReferenceEnemy, scouted: ReferenceEnemy | null, w: number): ReferenceEnemy {
    if (!scouted || w <= 0) return generic;
    const mix = (a: number, b: number) => a + (b - a) * w;
    return {
        defense: mix(generic.defense, scouted.defense),
        dodgeRate: mix(generic.dodgeRate, scouted.dodgeRate),
        dps: mix(generic.dps, scouted.dps),
        ehp: mix(generic.ehp, scouted.ehp),
        attackRate: mix(generic.attackRate, scouted.attackRate),
        strength: scouted.strength,
    };
}

/**
 * The reference a decision is scored against. Still a function of the OBSERVATION only — the
 * scouted enemy is fixed for the round and none of the bot's own actions can move it — so the
 * no-oscillation argument above holds. `weight` defaults to the stakes-based blend (economy.ts's
 * scoutWeight); a one-fight effect (a potion) passes 1.
 */
export function referenceFor(obs: DraftObservation, weight?: number): ReferenceEnemy {
    const generic = referenceEnemy(obs.round);
    if (!obs.nextEnemyBuild) return generic;
    return blendReference(generic, scoutedEnemy(obs.nextEnemyBuild), weight ?? scoutWeight(obs.player));
}

// --- marginal evaluation --------------------------------------------------------------------

/** Built once per decideDraft call and threaded through every scorer, so a decision costs one
 *  normalization plus N cheap deltas instead of N full rebuilds. */
export interface PowerContext {
    round: number;
    raw: RawStats;
    stats: StatBlock;
    weapons: WeaponProfile[];
    ref: ReferenceEnemy;
    basePower: number;
    /** Nominal fight length at the current board — the horizon per-proc effects are valued over. */
    fightSeconds: number;
}

export function buildPowerContext(obs: DraftObservation, scoutWeightOverride?: number): PowerContext {
    const raw = rawStatsFromPlayer(obs.player);
    const stats = normalize(cloneRaw(raw));
    const weapons = weaponProfiles(obs.player.equipped);
    const ref = referenceFor(obs, scoutWeightOverride);
    const dps = estimateDps(stats, weapons, ref);
    return {
        round: obs.round,
        raw, stats, weapons, ref,
        basePower: estimatePower(stats, weapons, ref),
        fightSeconds: fightSeconds(dps, ref),
    };
}

export interface LoadoutChange {
    /** Stat deltas gained (a candidate item/talent's affectedStats, a skill's aura output). */
    addStats?: (Partial<StatBlock> | undefined)[];
    /** Stat deltas lost (an incumbent being displaced, an item being sold). */
    removeStats?: (Partial<StatBlock> | undefined)[];
    addWeapon?: WeaponProfile;
    removeWeapon?: WeaponProfile;
    /** Raw damage an effect adds across one reference fight (a proc total, not a rate). */
    addDamagePerFight?: number;
    /** Incoming raw damage an effect denies, absorbs or heals back over one fight. */
    addEhp?: number;
}

function sameWeapon(a: WeaponProfile, b: WeaponProfile): boolean {
    return a.baseMinDamage === b.baseMinDamage && a.baseMaxDamage === b.baseMaxDamage
        && a.bonusMaxDamage === b.bonusMaxDamage && a.baseAttackSpeed === b.baseAttackSpeed
        && a.strengthScaling === b.strengthScaling;
}

/**
 * Power gained by applying `change`. The reference enemy is held FIXED at its pre-change value:
 * with a mirrored reference, letting it move would make every purchase partly cancel itself out
 * (buy defense -> enemy gets more defense -> your DPS term drops).
 */
export function marginalPower(ctx: PowerContext, change: LoadoutChange): number {
    const raw = cloneRaw(ctx.raw);
    for (const d of change.addStats ?? []) addAffected(raw, d, 1);
    for (const d of change.removeStats ?? []) addAffected(raw, d, -1);
    const stats = normalize(raw);

    // ctx.weapons holds only real swinging weapons (possibly none) — estimateDps injects the fist
    // when the list comes up empty, so adding the first real weapon displaces it for free.
    let weapons = ctx.weapons;
    if (change.removeWeapon || change.addWeapon) {
        weapons = [...weapons];
        if (change.removeWeapon) {
            const i = weapons.findIndex((w) => sameWeapon(w, change.removeWeapon!));
            if (i >= 0) weapons.splice(i, 1);
        }
        if (change.addWeapon) weapons.push(change.addWeapon);
    }

    const extra = {
        dps: (change.addDamagePerFight ?? 0) / ctx.fightSeconds,
        ehp: change.addEhp ?? 0,
    };
    return estimatePower(stats, weapons, ctx.ref, extra) - ctx.basePower;
}
