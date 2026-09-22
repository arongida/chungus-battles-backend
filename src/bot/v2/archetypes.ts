/**
 * Per-run build identities for the v2 policy. Their purpose is variety: every bot in a batch used
 * to play the identical deterministic policy, so matchmaking filled up with clones and the
 * telemetry had no internal contrast. An archetype is rolled from the run's seed, recorded on the
 * BotRun doc, and compared via getArchetypeWinRates.
 *
 * HARD RULE: an archetype NEVER touches the DPS/EHP terms of the power model (combatModel.ts).
 * It only shifts (a) the synergy/affinity bonus, (b) the economy weights, (c) tie-breaks. If an
 * archetype could bend the power model itself, a bad archetype and a bad power model become
 * indistinguishable in the A/B and the whole comparison stops being attributable.
 */
import { BotClass, StatBlock } from '../BotPolicy';
import { TriggerType } from '../../common/types';
import { mulberry32 } from './rng';

export type ArchetypeId =
    | 'balanced'
    | 'dodge-rogue'
    | 'bruiser-warrior'
    | 'tank-paladin'
    | 'economy-merchant'
    | 'active-caster'
    | 'highroller';

export interface ArchetypeWeights {
    id: ArchetypeId;
    /** The avatar classes allowed to play this archetype. A merchant avatar playing dodge-rogue
     *  fights its own level-up bonuses, so the pairing is locked rather than rolled independently. */
    classes: BotClass[];
    /** Multiplier on how much this build WANTS a stat — applied to the affinity term only. Absent = 1. */
    statAffinity: Partial<Record<keyof StatBlock, number>>;
    /** Multiplier on the value of effects that fire on a given trigger. Absent = 1. */
    triggerAffinity: Partial<Record<string, number>>;
    classAffinity: Partial<Record<'rogue' | 'warrior' | 'merchant', number>>;
    subclassAffinity: Partial<Record<string, number>>;
    /** Scales income/gold-denominated value against combat power. */
    economyWeight: number;
    /** Scales the expected gain of a shop reroll — how willing this build is to dig for a payoff. */
    rerollAppetite: number;
    /** > 1 spends more freely while healthy; < 1 hoards. Feeds economyUrgency. */
    riskTolerance: number;
    /** Extra weight on items carrying a skill or a future skill. */
    skillPremium: number;
}

const ALL_CLASSES: BotClass[] = ['rogue', 'warrior', 'merchant'];

function archetype(
    id: ArchetypeId,
    overrides: Partial<Omit<ArchetypeWeights, 'id'>> = {},
): ArchetypeWeights {
    return {
        id,
        classes: ALL_CLASSES,
        statAffinity: {}, triggerAffinity: {}, classAffinity: {}, subclassAffinity: {},
        economyWeight: 1, rerollAppetite: 1, riskTolerance: 1, skillPremium: 1,
        ...overrides,
    };
}

export const ARCHETYPES: Record<ArchetypeId, ArchetypeWeights> = {
    // The control arm. Every weight at 1, so a v2-vs-v2 comparison always has a neutral baseline
    // to attribute an archetype's result against.
    balanced: archetype('balanced'),

    'dodge-rogue': archetype('dodge-rogue', {
        classes: ['rogue'],
        statAffinity: { dodgeRate: 1.6, attackSpeed: 1.3, accuracy: 1.15 },
        triggerAffinity: { [TriggerType.ON_DODGE]: 1.8, [TriggerType.ON_ATTACK_DODGED]: 1.4 },
        classAffinity: { rogue: 1.4 },
        subclassAffinity: { assassin: 1.35, thief: 1.25 },
        riskTolerance: 1.1,
    }),

    'bruiser-warrior': archetype('bruiser-warrior', {
        classes: ['warrior'],
        statAffinity: { strength: 1.6, attackSpeed: 1.2 },
        triggerAffinity: { [TriggerType.ON_ATTACK]: 1.5, [TriggerType.ON_DAMAGE]: 1.2 },
        classAffinity: { warrior: 1.4 },
        subclassAffinity: { berserker: 1.35 },
        riskTolerance: 1.2,
    }),

    'tank-paladin': archetype('tank-paladin', {
        classes: ['warrior'],
        statAffinity: { maxHp: 1.5, defense: 1.5, hpRegen: 1.4 },
        triggerAffinity: { [TriggerType.ON_ATTACKED]: 1.6, [TriggerType.ON_DAMAGE]: 1.4 },
        classAffinity: { warrior: 1.25 },
        subclassAffinity: { paladin: 1.4 },
        riskTolerance: 0.85,
    }),

    'economy-merchant': archetype('economy-merchant', {
        classes: ['merchant'],
        statAffinity: { income: 1.8 },
        classAffinity: { merchant: 1.4 },
        subclassAffinity: { moneybag: 1.4, fence: 1.25 },
        economyWeight: 1.8,
        rerollAppetite: 1.3,
        riskTolerance: 0.9,
    }),

    // Magic Ring (rogue) and Throw Money (merchant) are the two cooldown-driven class lines.
    'active-caster': archetype('active-caster', {
        classes: ['rogue', 'merchant'],
        statAffinity: { cooldownReduction: 2.0 },
        triggerAffinity: { [TriggerType.ACTIVE]: 1.8 },
        skillPremium: 1.4,
    }),

    // Digs hard for a payoff item instead of settling for filler commons.
    highroller: archetype('highroller', {
        rerollAppetite: 1.8,
        skillPremium: 1.6,
        economyWeight: 1.2,
        riskTolerance: 1.3,
    }),
};

export const ARCHETYPE_IDS = Object.keys(ARCHETYPES) as ArchetypeId[];

export function isArchetypeId(id: string): id is ArchetypeId {
    return Object.prototype.hasOwnProperty.call(ARCHETYPES, id);
}

export const BOT_CLASSES: BotClass[] = ALL_CLASSES;

export function archetypesForClass(cls: BotClass): ArchetypeId[] {
    return ARCHETYPE_IDS.filter((id) => ARCHETYPES[id].classes.includes(cls));
}

/**
 * Class first (uniform, so a batch keeps the three classes evenly spread in the matchmaking pool),
 * then an archetype that class can play. One rng stream, so the pair replays exactly from the seed.
 * A forced archetype picks one of its own classes instead; a forced class restricts the archetype.
 */
export function rollClassAndArchetype(
    seed: number, forced: { archetypeId?: ArchetypeId; avatarClass?: BotClass } = {},
): { avatarClass: BotClass; archetype: ArchetypeWeights } {
    const rand = mulberry32(seed);
    const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];
    if (forced.archetypeId) {
        const a = ARCHETYPES[forced.archetypeId];
        const cls = forced.avatarClass && a.classes.includes(forced.avatarClass) ? forced.avatarClass : pick(a.classes);
        return { avatarClass: cls, archetype: a };
    }
    const cls = forced.avatarClass ?? pick(ALL_CLASSES);
    return { avatarClass: cls, archetype: ARCHETYPES[pick(archetypesForClass(cls))] };
}

/** Uniform over ARCHETYPES, driven by the run's seed so the choice replays exactly. */
export function rollArchetype(seed: number): ArchetypeWeights {
    return rollClassAndArchetype(seed).archetype;
}

export function statAffinity(a: ArchetypeWeights, stat: keyof StatBlock): number {
    return a.statAffinity[stat] ?? 1;
}

export function triggerAffinity(a: ArchetypeWeights, trigger: string): number {
    return a.triggerAffinity[trigger] ?? 1;
}

/** Own-class tags are preferred and off-class tags discounted on top of the archetype's own
 *  weights: class items roll class stats and class level-ups feed the same stats. */
export const OWN_CLASS_AFFINITY = 1.25;
export const OFF_CLASS_AFFINITY = 0.85;

/** Class and subclass share one lookup — `tags` mixes both vocabularies on a talent. */
export function tagAffinity(a: ArchetypeWeights, tag: string, ownClass?: BotClass): number {
    const base = (a.classAffinity as Record<string, number>)[tag] ?? a.subclassAffinity[tag] ?? 1;
    if (!ownClass || !(ALL_CLASSES as string[]).includes(tag)) return base;
    return tag === ownClass ? Math.max(base, OWN_CLASS_AFFINITY) : base * OFF_CLASS_AFFINITY;
}
