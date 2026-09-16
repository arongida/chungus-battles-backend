/**
 * Turns "what does this item/talent actually do for THIS build" into a power-unit number.
 *
 * Four independent signals, each an ADDEND on top of marginalPower (never a multiplier on it — a
 * multiplier would let one mis-tuned hint swing a decision by an order of magnitude):
 *
 *  1. Activation realism (expectedActivations)  — derived, no catalog. How often the effect
 *     actually fires for this build. An on-dodge proc at 0 dodge fires never, and is worth 0.
 *  2. Effect value (skillCatalog / talentCatalog) — per-proc damage/EHP/gold, multiplied by (1).
 *  3. Scaling-graph synergy (scalingSynergy)    — derived from SCALING_DECLARATIONS. Values a
 *     source by the stat it feeds on, and rewards chains where one source writes what another reads.
 *  4. Tag affinity (affinityBonus)              — concentration in a class/subclass, bounded to a
 *     fraction of the candidate's own value so it only re-ranks near-ties.
 *
 * Note on items: only talents carry subclass tags in the database (assassin, berserker, fence,
 * moneybag, thief, paladin); items carry class and type tags only. Item <-> talent synergy
 * therefore flows through (3) and through SkillHint.wants, not through shared subclass tags —
 * don't go looking for subclass tags on items, they aren't there.
 */
import { DraftObservation, ItemView, PlayerView, StatBlock, TalentView } from '../BotPolicy';
import { TriggerType } from '../../common/types';
import { POISON_DURATION_MS } from '../../common/poisonBalance';
import { BURN_DURATION_MS } from '../../items/behavior/uniqueItemBalance';
import { SCALING_DECLARATIONS } from '../../common/scalingRegistry';
import { ScalingNodeId, skillNode, StatKey, talentNode } from '../../common/scalingGraph';
import {
    dodgeChance, estimateDps, PowerContext, ReferenceEnemy, WeaponProfile, weaponProfileOf,
} from './combatModel';
import { SKILL_HINTS, SkillHint, skillTriggerTypes, valuesFor } from './skillCatalog';
import { TALENT_HINTS, TalentContext } from './talentCatalog';
import { ArchetypeWeights, statAffinity, tagAffinity, triggerAffinity } from './archetypes';

/** Swings per second the reference enemy is assumed to take. The scouted-enemy fields could refine
 *  this later; a nominal rate is enough for ranking, since it scales every on-attacked effect
 *  equally. */
const ENEMY_NOMINAL_ATTACK_RATE = 1.0;
/** Damage one poison stack ticks per second (poisonBalance.ts's per-tick damage). */
const POISON_DAMAGE_PER_STACK_PER_SECOND = 1;
/** Ceiling on the affinity bonus, as a fraction of the candidate's own value. */
const MAX_AFFINITY_FRACTION = 0.35;
/** Per-stat nominal scale used to normalize "how much fuel does this build have" to ~[0,1]. */
const STAT_NOMINAL: Partial<Record<StatKey, number>> = {
    maxHp: 1500, defense: 200, dodgeRate: 150, hpRegen: 30, strength: 80, accuracy: 60, income: 20,
};
/** Power credited for each scaling chain link (one source feeding another). */
const CHAIN_BONUS = 4;
const SCALING_FUEL_WEIGHT = 8;

/** Everything a hint needs about the current board to price one proc. Built once per decision. */
export interface ActivationContext {
    stats: StatBlock;
    weapons: WeaponProfile[];
    ref: ReferenceEnemy;
    fightSeconds: number;
    enemyAttackRate: number;
    /** Average damage of one of the player's own swings, pre-mitigation. */
    averageHitDamage: number;
    /** Average damage of one enemy swing after the player's mitigation. */
    incomingHitDamage: number;
    expectedDodges: number;
    expectedHitsTaken: number;
    /**
     * Average poison/burn stacks sitting on the enemy (and on the player, for self-inflicted burn)
     * during a fight, produced by the sources the build ACTUALLY has — see buildSupply.
     *
     * This is what makes cross-source synergy real rather than thematic: Plague Bearer converts
     * enemy poison stacks into attack speed, so it is worth nothing on a build with no way to
     * apply poison and a great deal on one running Coated Edge or Poison II.
     */
    enemyPoisonStacks: number;
    enemyBurnStacks: number;
    selfBurnStacks: number;
    poisonDamagePerStackPerSecond: number;
    expectedPoisonDamageTaken: number;
    expectedBurnDamageTaken: number;
    gold: number;
    luckyFindChance: number;
    refreshShopCost: number;
    averageShopPrice: number;
    round: number;
    level: number;
}

/** Uniques that apply a DoT through their own item behavior instead of a rolled skill, so there is
 *  no ITEM_SKILLS entry to read. Keyed by itemId, returning stacks per landed hit.
 *  Dagger of Poison (18) applies `rarity` stacks — see ItemBehaviors' entry for it, and note that
 *  Festering Wounds grants this exact weapon, which is what makes that pair work. */
const UNIQUE_POISON_STACKS_PER_HIT: Record<number, (rarity: number) => number> = {
    18: (rarity) => rarity,
};

/** DoT supply a source contributes over one fight, in stacks APPLIED (not concurrent). */
export interface Supply {
    enemyPoison: number;
    enemyBurn: number;
    selfBurn: number;
}

export const NO_SUPPLY: Supply = { enemyPoison: 0, enemyBurn: 0, selfBurn: 0 };

export function addSupply(a: Supply, b: Supply): Supply {
    return {
        enemyPoison: a.enemyPoison + b.enemyPoison,
        enemyBurn: a.enemyBurn + b.enemyBurn,
        selfBurn: a.selfBurn + b.selfBurn,
    };
}

export function hasSupply(s: Supply): boolean {
    return s.enemyPoison > 0 || s.enemyBurn > 0 || s.selfBurn > 0;
}

/** Stacks applied over a fight -> average stacks standing at any moment. A stack lives for its
 *  DoT duration, so a build applying N over T seconds is carrying about `N * duration / T`. */
function concurrentStacks(applied: number, durationMs: number, fightSeconds: number): number {
    if (applied <= 0 || fightSeconds <= 0) return 0;
    return (applied * (durationMs / 1000)) / fightSeconds;
}

/** Folds a supply into the context the hints read. */
export function withSupply(ctx: ActivationContext, supply: Supply): ActivationContext {
    return {
        ...ctx,
        enemyPoisonStacks: ctx.enemyPoisonStacks + concurrentStacks(supply.enemyPoison, POISON_DURATION_MS, ctx.fightSeconds),
        enemyBurnStacks: ctx.enemyBurnStacks + concurrentStacks(supply.enemyBurn, BURN_DURATION_MS, ctx.fightSeconds),
        selfBurnStacks: ctx.selfBurnStacks + concurrentStacks(supply.selfBurn, BURN_DURATION_MS, ctx.fightSeconds),
    };
}

/** What one item's skills apply over a fight. */
export function supplyOfItem(item: ItemView, ctx: ActivationContext): Supply {
    let supply = NO_SUPPLY;
    for (const skillId of [item.skillId, item.skillId2]) {
        const hint = skillId ? SKILL_HINTS[skillId] : undefined;
        if (!hint?.provides) continue;
        const triggers = skillTriggerTypes(skillId).filter((trigger) => trigger !== TriggerType.FIGHT_START && trigger !== TriggerType.FIGHT_END);
        const procs = expectedActivations(triggers.length ? triggers : item.triggerTypes, ctx, {
            activationRate: item.activationRate,
            weapon: item.baseAttackSpeed > 0 ? weaponProfileOf(item) : undefined,
        });
        supply = addSupply(supply, scaleSupply(hint.provides(valuesFor(skillId, item.rarity), ctx), procs));
    }
    // A few uniques apply a DoT through their own item behavior rather than a rolled skill.
    const uniqueStacks = UNIQUE_POISON_STACKS_PER_HIT[item.itemId];
    if (uniqueStacks && item.baseAttackSpeed > 0) {
        const swings = Math.max(0.1, item.baseAttackSpeed * ctx.stats.attackSpeed) * ctx.fightSeconds;
        supply = addSupply(supply, { enemyPoison: uniqueStacks(item.rarity) * swings, enemyBurn: 0, selfBurn: 0 });
    }
    return supply;
}

export function supplyOfTalent(talent: TalentView, ctx: ActivationContext): Supply {
    const hint = TALENT_HINTS[talent.talentId];
    if (!hint?.provides) return NO_SUPPLY;
    const procs = expectedActivations(talent.triggerTypes, ctx, { activationRate: talent.activationRate });
    return scaleSupply(hint.provides(talent, { ...ctx, procs }), procs);
}

function scaleSupply(perProc: Supply, procs: number): Supply {
    return {
        enemyPoison: perProc.enemyPoison * procs,
        enemyBurn: perProc.enemyBurn * procs,
        selfBurn: perProc.selfBurn * procs,
    };
}

/** Everything the build currently applies, across equipped items and owned talents. */
export function buildSupply(obs: DraftObservation, ctx: ActivationContext): Supply {
    let supply = NO_SUPPLY;
    for (const item of Object.values(obs.player.equipped)) {
        if (item) supply = addSupply(supply, supplyOfItem(item, ctx));
    }
    for (const talent of obs.player.talents) supply = addSupply(supply, supplyOfTalent(talent, ctx));
    return supply;
}

function buildBaseActivationContext(obs: DraftObservation, ctx: PowerContext): ActivationContext {
    const { stats, weapons, ref, fightSeconds } = ctx;
    const enemyAttackRate = ENEMY_NOMINAL_ATTACK_RATE;
    const ownAttackRate = weapons.reduce((sum, w) => sum + Math.max(0.1, w.baseAttackSpeed * stats.attackSpeed), 0)
        || Math.max(0.1, 0.8 * stats.attackSpeed);
    const rawDps = estimateDps(stats, weapons, { defense: 0, dodgeRate: 0 });
    const enemySwings = enemyAttackRate * fightSeconds;
    const dodged = enemySwings * dodgeChance(stats.dodgeRate);
    const shopPrices = obs.shop.filter((i) => i.price > 0).map((i) => i.price);

    return {
        stats, weapons, ref, fightSeconds, enemyAttackRate,
        averageHitDamage: rawDps / Math.max(0.1, ownAttackRate),
        incomingHitDamage: (ref.dps / enemyAttackRate),
        expectedDodges: dodged,
        expectedHitsTaken: enemySwings - dodged,
        // Filled in below from the build's actual DoT sources — zero here so buildSupply can use
        // this same context to evaluate them without reading a half-built value.
        enemyPoisonStacks: 0,
        enemyBurnStacks: 0,
        selfBurnStacks: 0,
        poisonDamagePerStackPerSecond: POISON_DAMAGE_PER_STACK_PER_SECOND,
        expectedPoisonDamageTaken: 0,
        expectedBurnDamageTaken: 0,
        gold: obs.player.gold,
        luckyFindChance: obs.player.luckyFindChance,
        refreshShopCost: obs.player.refreshShopCost,
        averageShopPrice: shopPrices.length
            ? shopPrices.reduce((a, b) => a + b, 0) / shopPrices.length
            : 0,
        round: obs.round,
        level: obs.player.level,
    };
}

export function buildActivationContext(obs: DraftObservation, ctx: PowerContext): ActivationContext {
    // Two phases: the DoT supply is computed from sources that themselves need a context (their
    // proc rates depend on attack speed and dodge), so build a supply-free context first and fold
    // the result back in. Supply never feeds its own computation, so one pass is enough.
    const base = buildBaseActivationContext(obs, ctx);
    return withSupply(base, buildSupply(obs, base));
}

/**
 * Expected number of times an effect fires over one reference fight.
 *
 * This is the single most important derived signal in the policy: it is what makes an on-dodge
 * Legendary worth nothing on a zero-dodge build, and what lets cooldownReduction pay for itself on
 * an active-skill build.
 */
export function expectedActivations(
    triggerTypes: string[],
    ctx: ActivationContext,
    opts: { weapon?: WeaponProfile; activationRate?: number } = {},
): number {
    if (!triggerTypes || triggerTypes.length === 0) return 0;
    const { stats, fightSeconds, enemyAttackRate } = ctx;
    const ownAttackRate = opts.weapon
        ? Math.max(0.1, opts.weapon.baseAttackSpeed * stats.attackSpeed)
        : ctx.weapons.reduce((sum, w) => sum + Math.max(0.1, w.baseAttackSpeed * stats.attackSpeed), 0)
          || Math.max(0.1, 0.8 * stats.attackSpeed);

    let total = 0;
    for (const trigger of triggerTypes) {
        switch (trigger) {
            case TriggerType.ACTIVE:
                // Exactly src/common/cooldown.ts: cooldownReduction shortens the interval.
                total += (opts.activationRate ?? 0) * ((100 + stats.cooldownReduction) / 100) * fightSeconds;
                break;
            case TriggerType.ON_ATTACK:
                total += ownAttackRate * fightSeconds;
                break;
            case TriggerType.ON_DODGE:
                total += enemyAttackRate * fightSeconds * dodgeChance(stats.dodgeRate);
                break;
            case TriggerType.ON_ATTACK_DODGED:
                total += ownAttackRate * fightSeconds * dodgeChance(ctx.ref.dodgeRate);
                break;
            case TriggerType.ON_ATTACKED:
                total += enemyAttackRate * fightSeconds;
                break;
            case TriggerType.ON_DAMAGE:
                total += enemyAttackRate * fightSeconds * (1 - dodgeChance(stats.dodgeRate));
                break;
            case TriggerType.AURA:
            case TriggerType.FIGHT_START:
            case TriggerType.FIGHT_END:
                total += 1;
                break;
            default:
                // Shop-phase triggers (shop-start, after-refresh, on-sell, level-up) produce no
                // combat activations — their value is routed through the economy model instead.
                break;
        }
    }
    return total;
}

// --- scaling-graph synergy --------------------------------------------------------------------

function normalizedStat(stat: StatKey, stats: StatBlock): number {
    const nominal = STAT_NOMINAL[stat] ?? 100;
    const value = (stats as unknown as Record<string, number>)[stat] ?? 0;
    return Math.min(2, Math.max(0, value) / nominal);
}

export function ownedScalingNodes(player: PlayerView): Set<ScalingNodeId> {
    const owned = new Set<ScalingNodeId>();
    for (const talent of player.talents) {
        const id = talentNode(talent.talentId);
        if (SCALING_DECLARATIONS.has(id)) owned.add(id);
    }
    for (const item of Object.values(player.equipped)) {
        if (!item) continue;
        for (const skillId of [item.skillId, item.skillId2]) {
            if (!skillId) continue;
            const id = skillNode(skillId);
            if (SCALING_DECLARATIONS.has(id)) owned.add(id);
        }
    }
    return owned;
}

/**
 * Values a scaling source by (a) how much of the stat it eats the build already has, and (b) how
 * well it chains with sources already owned — read straight out of the read/write topology the
 * server computes for its own aura ordering, so it needs no hand-authored pair list.
 */
export function scalingSynergy(
    nodeId: ScalingNodeId, stats: StatBlock, owned: Set<ScalingNodeId>,
): number {
    const decl = SCALING_DECLARATIONS.get(nodeId);
    if (!decl) return 0;

    let fuel = 0;
    for (const stat of decl.reads) fuel += normalizedStat(stat, stats);

    let chain = 0;
    for (const otherId of owned) {
        if (otherId === nodeId) continue;
        const other = SCALING_DECLARATIONS.get(otherId);
        if (!other) continue;
        if (other.writes.some((s) => decl.reads.includes(s))) chain += CHAIN_BONUS;
        if (decl.writes.some((s) => other.reads.includes(s))) chain += CHAIN_BONUS;
    }

    return fuel * SCALING_FUEL_WEIGHT + chain;
}

// --- tag affinity -----------------------------------------------------------------------------

const CLASS_TAGS = ['rogue', 'warrior', 'merchant'];
const SUBCLASS_TAGS = ['assassin', 'berserker', 'fence', 'moneybag', 'thief', 'paladin'];
const AFFINITY_TAGS = new Set([...CLASS_TAGS, ...SUBCLASS_TAGS]);

/** Tag -> share of the build's tagged picks. A concentration, not a count, so a 5-talent build
 *  that is all-assassin reads stronger than a 15-talent build with 5 assassin picks. */
export function buildAffinity(player: PlayerView): Map<string, number> {
    const counts = new Map<string, number>();
    let total = 0;
    const bump = (tag: string) => {
        if (!AFFINITY_TAGS.has(tag)) return;
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
        total++;
    };
    for (const talent of player.talents) talent.tags.forEach(bump);
    for (const item of Object.values(player.equipped)) if (item?.class) bump(item.class);

    const affinity = new Map<string, number>();
    if (total === 0) return affinity;
    for (const [tag, count] of counts) affinity.set(tag, count / total);
    return affinity;
}

/**
 * A bounded nudge toward the build the bot is already committed to. Deliberately expressed as a
 * fraction of the candidate's own value: v1 used a flat +6/+8 on a scale where most talents scored
 * 0-12, which meant the class tag WAS the decision.
 */
export function affinityBonus(
    tags: string[], ownValue: number, affinity: Map<string, number>, archetype: ArchetypeWeights,
): number {
    if (tags.length === 0) return 0;
    let fraction = 0;
    for (const tag of tags) {
        if (!AFFINITY_TAGS.has(tag)) continue;
        fraction += (affinity.get(tag) ?? 0) * tagAffinity(archetype, tag);
    }
    return Math.abs(ownValue) * Math.min(MAX_AFFINITY_FRACTION, fraction);
}

/** How much this archetype wants the stats an effect feeds on. Returns a multiplier near 1. */
export function wantsBonus(wants: (keyof StatBlock)[] | undefined, archetype: ArchetypeWeights): number {
    if (!wants || wants.length === 0) return 1;
    let sum = 0;
    for (const stat of wants) sum += statAffinity(archetype, stat);
    return sum / wants.length;
}

// --- item skills ------------------------------------------------------------------------------

export interface SkillValuation {
    /** Raw damage the skill's procs add over one fight. Kept separate from ehpPerFight on purpose:
     *  the power model values damage and survivability differently depending on the board, which is
     *  the whole point of it — collapsing them into one number would throw that away. */
    damagePerFight: number;
    /** Incoming damage the skill's procs deny, absorb or heal back over one fight. */
    ehpPerFight: number;
    /** Persistent stat grant to fold through the power model (undefined when the skill has none). */
    auraStats?: Partial<StatBlock>;
    /** Gold-equivalent produced per round, for the economy model. */
    goldPerRound: number;
    /** True when the skill's output is already inside player.stats and must not be re-counted. */
    measuredByAura: boolean;
}

const EMPTY_VALUATION: SkillValuation = { damagePerFight: 0, ehpPerFight: 0, goldPerRound: 0, measuredByAura: false };

/**
 * Values ONE skill slot on an item. `isEquipped` matters: for an item the player already wears,
 * a scaling skill's output is already folded into player.stats by the aura pass, so counting the
 * hint again would double it.
 */
export function valueSkill(
    skillId: number, rarity: number, ctx: ActivationContext, archetype: ArchetypeWeights,
    item: { triggerTypes: string[]; activationRate: number; baseAttackSpeed: number },
    isEquipped: boolean,
    onUnknown?: (id: number) => void,
): SkillValuation {
    if (!skillId) return EMPTY_VALUATION;
    const hint: SkillHint | undefined = SKILL_HINTS[skillId];
    if (!hint) {
        onUnknown?.(skillId);
        return EMPTY_VALUATION;
    }
    if (hint.measuredByAura && isEquipped) return { ...EMPTY_VALUATION, measuredByAura: true };

    const v = valuesFor(skillId, rarity);
    // The skill's own triggers, not the item's union of them (see skillTriggerTypes).
    const triggers = skillTriggerTypes(skillId);
    const triggerTypes = triggers.length ? triggers : item.triggerTypes;
    const procs = expectedActivations(triggerTypes, ctx, {
        activationRate: item.activationRate,
        // An ON_ATTACK skill fires on the weapon that swung, so it is that weapon's rate that
        // matters, not the player's total across both hands.
        weapon: item.baseAttackSpeed > 0
            ? { baseMinDamage: 0, baseMaxDamage: 0, bonusMaxDamage: 0, baseAttackSpeed: item.baseAttackSpeed, strengthScaling: 1 }
            : undefined,
    });
    const want = wantsBonus(hint.wants, archetype);
    const triggerWeight = triggerTypes.length
        ? triggerTypes.reduce((acc, t) => acc + triggerAffinity(archetype, t), 0) / triggerTypes.length
        : 1;

    const weight = want * triggerWeight;
    return {
        damagePerFight: (hint.damagePerProc?.(v, ctx) ?? 0) * procs * weight,
        ehpPerFight: (hint.ehpPerProc?.(v, ctx) ?? 0) * procs * weight,
        auraStats: hint.auraStats?.(v, ctx),
        goldPerRound: (hint.goldPerRound?.(v, ctx) ?? 0) + (hint.goldPerFight?.(v, ctx) ?? 0),
        measuredByAura: !!hint.measuredByAura,
    };
}

/** Both skill slots of an item (Weapon Whisperer grants a second one). */
export function valueItemSkills(
    item: ItemView, ctx: ActivationContext, archetype: ArchetypeWeights, isEquipped: boolean,
    onUnknown?: (id: number) => void,
): SkillValuation {
    const slots = [
        { id: item.skillId, rarity: item.rarity },
        { id: item.skillId2, rarity: item.rarity },
    ].filter((s) => s.id);
    if (slots.length === 0) return EMPTY_VALUATION;

    let damagePerFight = 0;
    let ehpPerFight = 0;
    let goldPerRound = 0;
    let measuredByAura = false;
    const auraStats: Partial<StatBlock> = {};
    for (const slot of slots) {
        const valuation = valueSkill(slot.id, slot.rarity, ctx, archetype, item, isEquipped, onUnknown);
        damagePerFight += valuation.damagePerFight;
        ehpPerFight += valuation.ehpPerFight;
        goldPerRound += valuation.goldPerRound;
        measuredByAura ||= valuation.measuredByAura;
        for (const [k, v] of Object.entries(valuation.auraStats ?? {})) {
            const key = k as keyof StatBlock;
            if (key === 'attackSpeed') auraStats.attackSpeed = (auraStats.attackSpeed ?? 1) + (v - 1);
            else auraStats[key] = (auraStats[key] ?? 0) + v;
        }
    }
    return {
        damagePerFight, ehpPerFight, goldPerRound, measuredByAura,
        auraStats: Object.keys(auraStats).length ? auraStats : undefined,
    };
}

/** The scaling-graph contribution of whatever skills an item carries. */
export function itemScalingSynergy(item: ItemView, stats: StatBlock, owned: Set<ScalingNodeId>): number {
    let total = 0;
    for (const skillId of [item.skillId, item.skillId2]) {
        if (skillId) total += scalingSynergy(skillNode(skillId), stats, owned);
    }
    return total;
}

export function talentScalingSynergy(talent: TalentView, stats: StatBlock, owned: Set<ScalingNodeId>): number {
    return scalingSynergy(talentNode(talent.talentId), stats, owned);
}

// --- talents ----------------------------------------------------------------------------------

export interface TalentValuation {
    /** Raw damage the behavior adds over one fight. */
    damagePerFight: number;
    /** Incoming damage it denies, absorbs or heals back over one fight. */
    ehpPerFight: number;
    /** Stats held for a fight, to fold through the power model. */
    auraStats?: Partial<StatBlock>;
    /** Stats gained permanently per fight — worth more the more fights remain. */
    statsPerFight?: Partial<StatBlock>;
    goldPerRound: number;
    goldOnce: number;
    xpPerRound: number;
}

const EMPTY_TALENT_VALUATION: TalentValuation = { damagePerFight: 0, ehpPerFight: 0, goldPerRound: 0, goldOnce: 0, xpPerRound: 0 };

/**
 * Values a talent's BEHAVIOR. Its `affectedStats` are handled separately by the caller through the
 * power model, so a hint must never restate them.
 *
 * An unmapped talent returns null so the caller can fall back to a tier median and record the gap
 * — scoring it 0 would make any newly added talent look strictly worse than everything else and
 * get rerolled away, which is exactly v1's failure mode.
 */
export function valueTalent(
    talent: TalentView, ctx: ActivationContext, archetype: ArchetypeWeights,
    onUnknown?: (id: number) => void,
): TalentValuation | null {
    const hint = TALENT_HINTS[talent.talentId];
    if (!hint) {
        onUnknown?.(talent.talentId);
        return null;
    }

    const procs = expectedActivations(talent.triggerTypes, ctx, { activationRate: talent.activationRate });
    const talentCtx: TalentContext = { ...ctx, procs };
    if (hint.requires && !hint.requires(talentCtx)) return EMPTY_TALENT_VALUATION;

    const want = wantsBonus(hint.wants, archetype);
    const triggerWeight = talent.triggerTypes.length
        ? talent.triggerTypes.reduce((acc, t) => acc + triggerAffinity(archetype, t), 0) / talent.triggerTypes.length
        : 1;

    const weight = want * triggerWeight;
    return {
        damagePerFight: (hint.damagePerProc?.(talent, talentCtx) ?? 0) * procs * weight,
        ehpPerFight: (hint.ehpPerProc?.(talent, talentCtx) ?? 0) * procs * weight,
        auraStats: hint.auraStats?.(talent, talentCtx),
        statsPerFight: hint.statsPerFight?.(talent, talentCtx),
        goldPerRound: hint.goldPerRound?.(talent, talentCtx) ?? 0,
        goldOnce: hint.goldOnce?.(talent, talentCtx) ?? 0,
        xpPerRound: hint.xpPerRound?.(talent, talentCtx) ?? 0,
    };
}
