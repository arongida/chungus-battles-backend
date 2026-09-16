/**
 * What each talent is actually worth to the v2 policy.
 *
 * This catalog has to be coverage-complete, unlike the item-skill one, because talents carry
 * almost no stats: of the 47 offerable talents only 10 have any non-zero `affectedStats`, and for
 * most of those it is just the self-granted cooldownReduction on an active. Rage, Zealot, Berserk,
 * Stab, Joker, Dual Wield and 30 others are pure behavior — so a stat-based scorer (v1's) sees
 * zero for nearly every talent and picks essentially at random.
 *
 * Rules for an entry:
 *  - Read numbers off the TalentView (`base`, `scaling`, `activationRate`). Never restate a value
 *    that lives in the database, or a balance pass silently desyncs the bot.
 *  - Never restate `affectedStats` either: the policy already folds those through the power model.
 *    A hint covers only what the BEHAVIOR does on top.
 *  - `ctx.procs` is how many times this talent is expected to fire in one reference fight, already
 *    computed from its trigger types (see synergy.expectedActivations) — an on-dodge talent has
 *    procs ≈ 0 on a no-dodge build, which is what makes those picks correctly worthless.
 *
 * Units: `damagePerProc`/`ehpPerProc` are raw HP, per activation. `auraStats` is a stat block held
 * for the fight (ramping effects should return their AVERAGE, not their peak). `statsPerFight` is
 * permanent accrual that survives fight end. Gold fields are gold, valued by economy.ts.
 */
import { StatBlock, TalentView } from '../BotPolicy';
import { FIRE_WITH_FIRE_MAX_STACKS } from '../../items/behavior/uniqueItemBalance';
import { TalentType } from '../../talents/types/TalentTypes';
import type { ActivationContext, Supply } from './synergy';

/** An ActivationContext plus how many times the talent under evaluation fires per fight. */
export interface TalentContext extends ActivationContext {
    procs: number;
}

export interface TalentHint {
    kind: 'combat' | 'economy' | 'enabler' | 'utility';
    damagePerProc?(t: TalentView, ctx: TalentContext): number;
    ehpPerProc?(t: TalentView, ctx: TalentContext): number;
    /** Stats held during a fight. Ramping effects return the fight-average, not the peak. */
    auraStats?(t: TalentView, ctx: TalentContext): Partial<StatBlock>;
    /** Stats gained PERMANENTLY each fight (Snitch's stolen strength, Joker's cards). */
    statsPerFight?(t: TalentView, ctx: TalentContext): Partial<StatBlock>;
    goldPerRound?(t: TalentView, ctx: TalentContext): number;
    /** One-off gold, e.g. a free item granted the moment the talent is taken. */
    goldOnce?(t: TalentView, ctx: TalentContext): number;
    xpPerRound?(t: TalentView, ctx: TalentContext): number;
    /** False means the talent does nothing for this build right now (no shield, one weapon, ...). */
    requires?(ctx: TalentContext): boolean;
    wants?: (keyof StatBlock)[];
    /**
     * DoT stacks this talent applies PER PROC. This is how cross-source synergy is expressed:
     * a supplier declares what it puts on the enemy, and consumers elsewhere (Plague Bearer,
     * Festering Wounds, Fire with Fire) are then valued against what the build can really apply.
     * See synergy.ts's buildSupply.
     */
    provides?(t: TalentView, ctx: TalentContext): Supply;
}

// --- shared helpers ---------------------------------------------------------------------------

/** The enemy's max HP, backed out of its effective HP and its own mitigation. */
function enemyMaxHp(ctx: TalentContext): number {
    const mit = (100 / (100 + ctx.ref.defense)) * (100 / (100 + ctx.ref.dodgeRate));
    return ctx.ref.ehp * mit;
}

function hasWeapon(ctx: TalentContext): boolean {
    return ctx.weapons.length > 0;
}

function mainWeaponRate(ctx: TalentContext): number {
    const w = ctx.weapons[0];
    if (!w) return Math.max(0.1, 0.8 * ctx.stats.attackSpeed);
    return Math.max(0.1, w.baseAttackSpeed * ctx.stats.attackSpeed);
}

/** Damage one extra weapon-equivalent adds across a whole fight. */
function extraWeaponDamage(ctx: TalentContext, fraction = 1): number {
    return ctx.averageHitDamage * mainWeaponRate(ctx) * ctx.fightSeconds * fraction;
}

/** Burn/poison DoT: each stack ticks for the rest of the fight, so landing one early is worth
 *  more. Averaged over the fight, a stack realizes about half its theoretical total. */
const BURN_DAMAGE_PER_STACK_PER_SECOND = 2;
const BURN_DURATION_SECONDS = 3;

/** A talent the shop can never offer (tier 99/999, or a legacy id kept for old save data). Present
 *  so the coverage test stays strict, and so a talent that somehow IS owned scores 0 rather than
 *  falling back to a median that would overvalue it. */
export const NON_OFFERABLE: TalentHint = { kind: 'utility' };

export const TALENT_HINTS: Record<number, TalentHint> = {
    // =========================================================================== TIER 1 ====
    [TalentType.PENNY_STOCKS]: {
        kind: 'economy',
        goldOnce: (t, ctx) => (ctx.level < 5 ? t.activationRate : 0),
    },
    [TalentType.SNITCH]: {
        kind: 'combat',
        // +1 strength to self per proc, kept across fights (only the enemy debuff resets).
        statsPerFight: (t, ctx) => ({ strength: ctx.procs }),
        // The enemy loses the same strength for the rest of this fight.
        ehpPerProc: (t, ctx) => ctx.enemyAttackRate * ctx.fightSeconds * 0.5,
    },
    [TalentType.MARTIAL_ARTIST]: {
        kind: 'enabler',
        // Weapons in every slot, plus a free weapon now and on each level up.
        goldOnce: (t, ctx) => ctx.averageShopPrice,
        goldPerRound: (t, ctx) => ctx.averageShopPrice / 3,
        wants: ['attackSpeed', 'strength'],
    },
    [TalentType.COMRADE]: {
        kind: 'economy',
        // One free item per shop, paid for with a reroll surcharge equal to income.
        goldPerRound: (t, ctx) => ctx.averageShopPrice - ctx.stats.income,
    },
    [TalentType.GAMBLER]: {
        kind: 'enabler',
        goldOnce: (t, ctx) => ctx.averageShopPrice,
        wants: ['income'],
    },
    [TalentType.MAGIC_RING_WEAPON]: {
        kind: 'enabler',
        goldOnce: (t, ctx) => ctx.averageShopPrice,
        wants: ['cooldownReduction'],
    },
    [TalentType.JOKER]: {
        kind: 'combat',
        // One permanent stat card after every fight. Averaged to a strength-equivalent rather than
        // modelling the individual cards, which vary by stat.
        statsPerFight: () => ({ strength: 3 }),
    },
    [TalentType.SHADY_SHIELDS]: {
        kind: 'enabler',
        goldOnce: (t, ctx) => ctx.averageShopPrice,
        wants: ['defense'],
    },
    [TalentType.MERCENARY]: {
        kind: 'economy',
        // 1 gold per `base` damage of the fight's hardest hit.
        goldPerRound: (t, ctx) => (t.base > 0 ? (ctx.averageHitDamage * 1.5) / t.base : 0),
        wants: ['strength'],
    },
    [TalentType.ROGUE_1]: { // Pickpocket
        kind: 'economy',
        // base-to-scaling gold per dodge, capped at one payout per second.
        goldPerRound: (t, ctx) => Math.min(ctx.procs, ctx.fightSeconds) * ((t.base + t.scaling) / 2),
        wants: ['dodgeRate'],
    },
    [TalentType.MERCHANT_1]: { // Pharmacist
        kind: 'economy',
        goldPerRound: (t, ctx) => ctx.averageShopPrice * 0.5,
    },

    // =========================================================================== TIER 2 ====
    [TalentType.RAGE]: {
        kind: 'combat',
        // Ramps all fight, resetting at fight end — the average held is about half the peak.
        auraStats: (t, ctx) => ({ strength: ctx.procs * t.activationRate * 0.5 }),
    },
    [TalentType.THROW_MONEY]: {
        kind: 'combat',
        damagePerProc: (t, ctx) => 1.2 * ctx.stats.income,
        wants: ['income', 'cooldownReduction'],
    },
    [TalentType.WITS_END]: {
        kind: 'economy',
        // Class-dependent payout (income / gold / xp); averaged across the three.
        goldPerRound: (t, ctx) => t.base * 2,
    },
    [TalentType.FUTURE_NOW]: {
        kind: 'economy',
        xpPerRound: (t, ctx) => ctx.round * (t.scaling || 2),
    },
    [TalentType.ROBBERY]: {
        kind: 'economy',
        goldPerRound: (t, ctx) => ctx.averageShopPrice - 1,
    },
    [TalentType.DUAL_WIELD]: {
        kind: 'enabler',
        // Copies the main hand into the off hand: close to a second weapon's worth of damage.
        requires: (ctx) => ctx.weapons.length === 1,
        damagePerProc: (t, ctx) => extraWeaponDamage(ctx, 1 + t.scaling),
        wants: ['strength', 'attackSpeed'],
    },
    [TalentType.WARRIOR_2]: { // Bully
        kind: 'combat',
        // Only lands while your strength exceeds the enemy's — call that a coin flip.
        ehpPerProc: (t, ctx) => t.base * ctx.ref.dps * 0.5,
        wants: ['strength', 'cooldownReduction'],
    },
    [TalentType.BARGAIN_HUNTER]: {
        kind: 'economy',
        goldPerRound: (t, ctx) => t.base * ctx.refreshShopCost,
    },
    [TalentType.POISON_2]: {
        kind: 'combat',
        // `activationRate` stacks per hit, each ticking `base` of the enemy's max HP.
        damagePerProc: (t, ctx) => t.activationRate * t.base * enemyMaxHp(ctx),
        provides: (t) => ({ enemyPoison: t.activationRate, enemyBurn: 0, selfBurn: 0 }),
        wants: ['attackSpeed'],
    },

    // =========================================================================== TIER 3 ====
    [TalentType.SCAM]: {
        kind: 'economy',
        goldPerRound: (t, ctx) => ctx.procs * t.base,
        // The mark wises up: the enemy gains strength for the rest of the fight, stacking.
        ehpPerProc: (t, ctx) => -t.scaling * ctx.fightSeconds * ctx.enemyAttackRate * 0.25,
        wants: ['cooldownReduction'],
    },
    [TalentType.BURNING_BLOOD]: {
        kind: 'combat',
        damagePerProc: (t, ctx) =>
            (1 + ctx.stats.hpRegen) * BURN_DAMAGE_PER_STACK_PER_SECOND * BURN_DURATION_SECONDS,
        // A third as many stacks land on you.
        ehpPerProc: (t, ctx) =>
            -((1 + ctx.stats.hpRegen) / 3) * BURN_DAMAGE_PER_STACK_PER_SECOND * BURN_DURATION_SECONDS,
        provides: (t, ctx) => {
            const stacks = 1 + ctx.stats.hpRegen;
            return { enemyPoison: 0, enemyBurn: stacks, selfBurn: Math.ceil(stacks / 3) };
        },
        wants: ['hpRegen', 'cooldownReduction'],
    },
    [TalentType.STRONG]: {
        kind: 'combat',
        auraStats: (t, ctx) => ({ maxHp: ctx.stats.maxHp * t.activationRate, strength: 10 }),
        wants: ['maxHp'],
    },
    [TalentType.INTIMIDATING_WEALTH]: {
        kind: 'combat',
        auraStats: (t, ctx) => ({ attackSpeed: 1 + Math.min(0.5, ctx.stats.income * t.activationRate) }),
        // The enemy is slowed by the same amount, which is survivability.
        ehpPerProc: (t, ctx) =>
            Math.min(0.5, ctx.stats.income * t.activationRate) * ctx.ref.dps * ctx.fightSeconds,
        wants: ['income'],
    },
    [TalentType.ZEALOT]: {
        kind: 'combat',
        // Converts half your defense into attack speed: +1% per point converted.
        auraStats: (t, ctx) => {
            const converted = Math.round(Math.max(0, ctx.stats.defense) * t.activationRate);
            return { defense: -converted, attackSpeed: 1 + converted * 0.01 };
        },
        wants: ['defense'],
    },
    [TalentType.FESTERING_WOUNDS]: {
        kind: 'enabler',
        goldOnce: (t, ctx) => ctx.averageShopPrice,
        // Doubles the poison tick rate, but only once the enemy is carrying `base` stacks — so its
        // payoff is entirely a function of how much poison the rest of the build applies. The
        // Dagger of Poison it grants is counted as supply once that weapon is actually equipped.
        damagePerProc: (t, ctx) => (ctx.enemyPoisonStacks >= t.base
            ? ctx.enemyPoisonStacks * ctx.poisonDamagePerStackPerSecond * ctx.fightSeconds
            : 0),
        wants: ['attackSpeed'],
    },
    [TalentType.WARRIOR_3]: { // Unstoppable Force
        kind: 'combat',
        damagePerProc: (t, ctx) => ctx.averageHitDamage * t.scaling,
        wants: ['cooldownReduction', 'strength'],
    },
    [TalentType.FORTUNES_FOOL]: {
        kind: 'economy',
        goldPerRound: (t, ctx) => 3 * ctx.refreshShopCost,
        // Each reroll costs starting HP next fight — assume a few rerolls a round.
        ehpPerProc: (t, ctx) => -Math.min(t.scaling, 3 * t.base) * ctx.stats.maxHp,
    },
    [TalentType.JUST_A_SCRATCH]: {
        kind: 'economy',
        goldPerRound: (t, ctx) => ctx.expectedHitsTaken * ctx.incomingHitDamage * 0.05,
    },

    // =========================================================================== TIER 4 ====
    [TalentType.GUARDIAN_ANGEL]: {
        kind: 'combat',
        // Cheats death once, then a window of invulnerability (activationRate is in ms).
        ehpPerProc: (t, ctx) => ctx.stats.maxHp * 0.5 + (t.activationRate / 1000) * ctx.ref.dps,
    },
    [TalentType.INVIGORATE]: {
        kind: 'combat',
        // Leeches a flat amount plus a share of the damage dealt, on every hit.
        ehpPerProc: (t, ctx) => ctx.averageHitDamage * 0.15 + 2,
        wants: ['attackSpeed', 'strength'],
    },
    [TalentType.SMART_INVESTMENT]: {
        kind: 'economy',
        // Income is permanent, so even a small per-attack chance compounds hard.
        goldPerRound: (t, ctx) => ctx.procs * t.activationRate * t.base,
        wants: ['attackSpeed'],
    },
    [TalentType.STAB]: {
        kind: 'combat',
        damagePerProc: (t, ctx) => enemyMaxHp(ctx) * t.scaling,
        ehpPerProc: (t, ctx) => -0.05 * ctx.stats.maxHp,
        wants: ['cooldownReduction'],
    },
    [TalentType.FIRE_WITH_FIRE]: {
        kind: 'combat',
        // Consumes up to the configured cap from EACH player; healing scales with talent.base —
        // so it is worth nothing at all without a burn source, and best alongside Burning Blood
        // (whose self-burn it also cleans up).
        ehpPerProc: (t, ctx) =>
            (Math.min(FIRE_WITH_FIRE_MAX_STACKS, ctx.enemyBurnStacks)
                + Math.min(FIRE_WITH_FIRE_MAX_STACKS, ctx.selfBurnStacks)) * (t.base / 100) * ctx.stats.maxHp,
        wants: ['cooldownReduction'],
    },
    [TalentType.SHARPENING_STONE]: {
        kind: 'combat',
        auraStats: (t) => ({ strength: t.base }),
        wants: ['strength'],
    },
    [TalentType.VIP_PASS]: {
        kind: 'economy',
        // A guaranteed upgrade slot each shop, minus the reroll surcharge.
        goldPerRound: (t, ctx) => ctx.averageShopPrice * 0.3 - 1,
    },
    [TalentType.BERSERK]: {
        kind: 'combat',
        // Only live below the HP threshold — roughly the back half of a fight.
        auraStats: (t, ctx) => ({
            attackSpeed: 1 + t.scaling * 0.4,
            strength: ctx.stats.strength * t.scaling * 0.4,
        }),
        wants: ['strength', 'attackSpeed'],
    },
    [TalentType.MISCONDUCT]: {
        kind: 'economy',
        goldPerRound: (t, ctx) => ctx.averageShopPrice - 1,
    },

    // =========================================================================== TIER 5 ====
    [TalentType.EYE_FOR_AN_EYE]: {
        kind: 'combat',
        damagePerProc: (t, ctx) => t.activationRate * ctx.incomingHitDamage,
        wants: ['maxHp', 'defense'],
    },
    [TalentType.WEAPON_WHISPERER]: {
        kind: 'enabler',
        requires: hasWeapon,
        // Main hand becomes Mythic and gains a second skill.
        damagePerProc: (t, ctx) => extraWeaponDamage(ctx, 0.25),
        wants: ['strength'],
    },
    [TalentType.GOLD_GENIE]: {
        kind: 'economy',
        goldPerRound: (t, ctx) => ctx.averageShopPrice,
    },
    [TalentType.ASSASSIN_AMUSEMENT]: {
        kind: 'combat',
        // Ramps per attack within a fight, reset at fight end: average is about half the peak.
        auraStats: (t, ctx) => ({ attackSpeed: 1 + t.activationRate * ctx.procs * 0.5 }),
        wants: ['attackSpeed'],
    },
    [TalentType.HIDDEN_VIALS]: {
        kind: 'combat',
        damagePerProc: (t, ctx) =>
            t.activationRate * (BURN_DAMAGE_PER_STACK_PER_SECOND * BURN_DURATION_SECONDS
                + 0.01 * enemyMaxHp(ctx)),
        // Applies both DoTs at once, which makes it the natural enabler for a poison or burn
        // payoff on a dodge build.
        provides: (t) => ({ enemyPoison: t.activationRate, enemyBurn: t.activationRate, selfBurn: 0 }),
        wants: ['dodgeRate'],
    },
    [TalentType.MERCHANT_5]: { // Income inequality
        kind: 'combat',
        auraStats: (t, ctx) => {
            const ratio = Math.max(0, ctx.stats.income) * t.scaling / 100;
            return {
                income: t.base,
                strength: Math.ceil(ctx.stats.strength * ratio),
                accuracy: Math.ceil(ctx.stats.accuracy * ratio),
                attackSpeed: 1 + ratio,
                defense: Math.ceil(ctx.stats.defense * ratio),
                maxHp: Math.ceil(ctx.stats.maxHp * ratio),
                dodgeRate: Math.ceil(ctx.stats.dodgeRate * ratio),
                hpRegen: Math.ceil(ctx.stats.hpRegen * ratio),
            };
        },
        wants: ['income'],
    },
    [TalentType.WARRIOR_5]: {
        kind: 'combat',
        auraStats: (t) => ({ strength: t.base }),
    },
    [TalentType.GRAND_ROBBERY]: {
        kind: 'economy',
        // Once per run: the entire shop, twice over, every item upgraded a rarity.
        goldOnce: (t, ctx) => ctx.averageShopPrice * 8,
    },
    [TalentType.BLACK_MARKET_CONTRACT]: {
        kind: 'economy',
        goldPerRound: (t, ctx) => ctx.averageShopPrice * (1 + ctx.luckyFindChance),
    },

    // ============================================================ NEVER OFFERED / LEGACY ====
    // tier 99/999 or superseded ids, kept so coverage stays provable. getRandomTalents matches
    // `{tier: level}` exactly, so none of these can ever appear in an offer.
    [TalentType.PICKPOCKET]: NON_OFFERABLE,        // superseded by ROGUE_1 (102)
    [TalentType.NOT_SO_GUARDIAN_ANGEL]: NON_OFFERABLE,
    [TalentType.BROKEN_PENNY_STOCKS]: NON_OFFERABLE,
    [TalentType.EVASION]: NON_OFFERABLE,
    [TalentType.BRIBE]: NON_OFFERABLE,
    [TalentType.EXECUTE]: NON_OFFERABLE,
    [TalentType.STEAL]: NON_OFFERABLE,
    [TalentType.DISARM]: NON_OFFERABLE,
    [TalentType.THORNY_FENCE]: NON_OFFERABLE,
    [TalentType.TRICKSTER]: NON_OFFERABLE,
    [TalentType.ARMOR_ADDICT]: NON_OFFERABLE,
    [TalentType.CORRODING_COLLECTION]: NON_OFFERABLE,
};

export function talentHint(talentId: number): TalentHint | null {
    return TALENT_HINTS[talentId] ?? null;
}
