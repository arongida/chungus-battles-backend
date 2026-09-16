/**
 * How the v2 policy reads each item skill. v1 knew only whether `skillId !== 0` and paid a flat
 * +18 for any skill in the game — so a Legendary on-dodge proc on a zero-dodge build scored the
 * same as Titan's Might on a 3000-HP tank.
 *
 * These hints deliberately restate NO tuning numbers: every entry reads its values out of
 * `skillValues(ITEM_SKILLS[id], rarity)`, so a balance pass in itemSkillBalance.ts flows straight
 * through to the bot. An entry only encodes what the value KEYS mean. The keys themselves are
 * asserted live by test/botKnowledge.test.ts, which is what catches a rename.
 *
 * A hint returns per-PROC quantities; synergy.ts multiplies them by how often the skill actually
 * fires for this build (expectedActivations), which is where "an on-dodge skill is worthless at
 * 0 dodge" comes from.
 */
import { StatBlock } from '../BotPolicy';
import { ITEM_SKILLS, skillValues } from '../../items/behavior/itemSkillBalance';
import { ItemSkillType } from '../../items/types/ItemSkillTypes';
import { ItemRarity } from '../../items/types/ItemTypes';
import type { ActivationContext, Supply } from './synergy';

export interface SkillHint {
    /** Extra raw (pre-mitigation) damage per proc. */
    damagePerProc?(v: Record<string, number>, ctx: ActivationContext): number;
    /** Raw HP healed or prevented per proc. */
    ehpPerProc?(v: Record<string, number>, ctx: ActivationContext): number;
    /** A persistent stat grant, folded through the power model like any other affectedStats. */
    auraStats?(v: Record<string, number>, ctx: ActivationContext): Partial<StatBlock>;
    /** Gold produced per fight — routed to the economy model, not to power. */
    goldPerFight?(v: Record<string, number>, ctx: ActivationContext): number;
    /** Shop-economy value per round in gold-equivalent (free rerolls, discounts, free claims). */
    goldPerRound?(v: Record<string, number>, ctx: ActivationContext): number;
    /** Stats this skill wants the build to already have — drives archetype affinity. */
    wants?: (keyof StatBlock)[];
    /**
     * DoT stacks this skill applies PER PROC. Declaring it here is what lets a consumer elsewhere
     * (Plague Bearer's attack speed per enemy poison stack, Fire with Fire's burn consumption) be
     * valued against what this build can actually apply, instead of against a guess — see
     * synergy.ts's buildSupply.
     */
    provides?(v: Record<string, number>, ctx: ActivationContext): Supply;
    /**
     * True when the skill's real output is already visible in the item's live `skillAffectedStats`
     * once equipped (every scaling-graph source works this way). Prevents counting it twice: the
     * aura pass has already folded it into player.stats.
     */
    measuredByAura?: boolean;
}

export const SKILL_HINTS: Record<number, SkillHint> = {
    // ------------------------------------------------------------------ ROGUE ----
    [ItemSkillType.EXPLOIT_WEAKNESS]: {
        damagePerProc: (v, ctx) => v.ratio * ctx.ref.defense,
        wants: ['attackSpeed'],
    },
    [ItemSkillType.FLUID_MOTION]: {
        // Ramps over the fight; the average bonus held is about half the final value.
        auraStats: (v, ctx) => ({ attackSpeed: 1 + v.attackSpeedPerDodge * ctx.expectedDodges * 0.5 }),
        wants: ['dodgeRate'],
    },
    [ItemSkillType.PLAGUE_BEARER]: {
        // Pure payoff card: worth nothing without a poison source in the build, and scales with
        // however many stacks that source actually keeps on the enemy.
        auraStats: (v, ctx) => ({ attackSpeed: 1 + v.ratioPerStack * ctx.enemyPoisonStacks }),
        wants: ['attackSpeed'],
    },
    [ItemSkillType.COATED_EDGE]: {
        // Poison is a DoT: each stack ticks for the rest of the fight, so value scales with how
        // much fight is left when it lands.
        damagePerProc: (v, ctx) => (v.stacks / v.every) * ctx.poisonDamagePerStackPerSecond * (ctx.fightSeconds / 2),
        // Every `every`-th attack applies `stacks` — the build's main poison engine.
        provides: (v) => ({ enemyPoison: v.stacks / v.every, enemyBurn: 0, selfBurn: 0 }),
        wants: ['attackSpeed'],
    },
    [ItemSkillType.SHADOWSTEP]: {
        ehpPerProc: (v, ctx) => v.healRatio * ctx.stats.maxHp,
        auraStats: (v, ctx) => ({ dodgeRate: -v.dodgeCost / 100 * ctx.stats.dodgeRate * ctx.expectedDodges * 0.5 }),
        wants: ['dodgeRate', 'maxHp'],
    },
    [ItemSkillType.OPENING_ACT]: {
        // A fixed number of empowered opening swings, not a per-proc rate.
        damagePerProc: (v, ctx) => v.count * ctx.averageHitDamage * 0.5,
    },
    [ItemSkillType.SMOKE_BOMB]: {
        // A survival window once per fight — worth roughly the damage it denies, minus the damage
        // it costs you (attacks deal nothing while vanished).
        ehpPerProc: (v, ctx) => (v.durationMs / 1000) * ctx.ref.dps,
    },
    [ItemSkillType.LIGHT_FINGERS]: {
        goldPerRound: (v, ctx) => ctx.averageShopPrice,
    },

    // ---------------------------------------------------------------- WARRIOR ----
    [ItemSkillType.RETRIBUTION]: {
        damagePerProc: (v, ctx) => ctx.averageHitDamage * 0.5,
        ehpPerProc: (v, ctx) => -v.hpRatio * ctx.stats.maxHp,
    },
    [ItemSkillType.INTIMIDATING_PRESENCE]: {
        // Slowing the enemy is survivability: fewer incoming swings over the same fight.
        ehpPerProc: (v, ctx) => v.ratio * ctx.ref.dps * ctx.fightSeconds,
    },
    [ItemSkillType.TITANS_MIGHT]: {
        measuredByAura: true,
        auraStats: (v, ctx) => ({ strength: Math.floor(Math.max(0, ctx.stats.maxHp) / v.divisor) }),
        wants: ['maxHp'],
    },
    [ItemSkillType.IRONBLOOD]: {
        measuredByAura: true,
        auraStats: (v, ctx) => ({ hpRegen: Math.round(Math.max(0, ctx.stats.hpRegen) * v.regenBonus) }),
        wants: ['hpRegen'],
    },
    [ItemSkillType.BULWARK]: {
        measuredByAura: true,
        auraStats: (v, ctx) => ({ maxHp: Math.round(Math.max(0, ctx.stats.maxHp) * v.hpRatio) }),
        wants: ['maxHp'],
    },
    // Below-half-health bonuses use a half-fight uptime estimate.
    [ItemSkillType.LAST_STAND]: {
        measuredByAura: true,
        auraStats: (v, ctx) => ({ defense: Math.round(ctx.stats.defense * v.defenseRatio) * 0.5, hpRegen: v.hpRegen * 0.5 }),
        wants: ['defense'],
    },
    [ItemSkillType.WARLORDS_ROAR]: {
        ehpPerProc: (v, ctx) => v.ratio * ctx.ref.dps * ctx.fightSeconds,
    },
    [ItemSkillType.CRUSHING_BLOW]: {
        damagePerProc: (v, ctx) => (1 / v.every) * ctx.averageHitDamage * 0.5,
        wants: ['attackSpeed'],
    },

    // --------------------------------------------------------------- MERCHANT ----
    [ItemSkillType.HAGGLER]: {
        goldPerRound: (v, ctx) => v.count * ctx.refreshShopCost,
    },
    [ItemSkillType.STORE_CREDIT]: {
        goldPerRound: (v, ctx) => Math.min(v.cap, ctx.averageShopPrice),
    },
    [ItemSkillType.CASH_BACK]: {
        goldPerRound: (v) => v.gold,
    },
    [ItemSkillType.COMPOUND_INTEREST]: {
        measuredByAura: true,
        auraStats: (v, ctx) => ({ income: Math.round(Math.max(0, ctx.stats.income) * v.ratio) }),
        wants: ['income'],
    },
    // Enum member is MARKET_MANIPULATION; its display name is "Insider Trading".
    [ItemSkillType.MARKET_MANIPULATION]: {
        // Lucky find upgrades shop rolls for free — worth a fraction of an item per round.
        goldPerRound: (v, ctx) => v.chance * ctx.averageShopPrice,
    },
    [ItemSkillType.BULK_DISCOUNT]: {
        goldPerRound: (v, ctx) => v.percentPerLuckPercent * ctx.luckyFindChance * 100 * ctx.averageShopPrice,
    },
    [ItemSkillType.PROTECTION_MONEY]: {
        // Rate-limited to once per cooldownMs, so it cannot pay more than that per fight.
        goldPerFight: (v, ctx) => v.gold * Math.min(
            ctx.enemyAttackRate * ctx.fightSeconds,
            ctx.fightSeconds / (v.cooldownMs / 1000),
        ),
    },
    [ItemSkillType.WAR_CHEST]: {
        // Converts gold into a one-fight stat spike; only as good as the gold actually on hand.
        auraStats: (v, ctx) => {
            const spend = Math.min(v.maxGold, ctx.gold);
            return { strength: spend * v.strengthPerGold, defense: spend * v.defensePerGold };
        },
    },

    // ----------------------------------------------------------------- SHIELD ----
    [ItemSkillType.AEGIS]: {
        ehpPerProc: (v, ctx) => (v.invulnMs / 1000) * ctx.ref.dps,
    },
    [ItemSkillType.RIPOSTE]: {
        damagePerProc: (v, ctx) => v.ratio * ctx.incomingHitDamage,
        auraStats: (v, ctx) => ({ defense: -v.defenseCost / 100 * ctx.stats.defense * 0.5 }),
        wants: ['defense'],
    },
    [ItemSkillType.SHIELD_WALL]: {
        // Ramps toward its cap over the fight; the attack-speed penalty is permanent and flat.
        auraStats: (v, ctx) => ({
            defense: Math.min(v.maxDefense, v.defensePerHit * ctx.expectedHitsTaken) * 0.5,
            attackSpeed: 1 - v.attackSpeedPenalty,
        }),
    },
    [ItemSkillType.SHIELD_BASH]: {
        // A stun denies the enemy attacks AND their dodge for its duration.
        ehpPerProc: (v, ctx) => (v.stunMs / 1000) * ctx.ref.dps,
    },
    [ItemSkillType.BRACE]: {
        ehpPerProc: (v, ctx) => ctx.incomingHitDamage / v.every,
    },

    // ----------------------------------------------------------------- POTION ----
    // Brew effects are summed straight into the next fight's stats by statsUtils, so they are
    // ordinary one-fight aura stats.
    [ItemSkillType.REGENERATION]: { auraStats: (v) => ({ hpRegen: v.hpRegen }) },
    [ItemSkillType.EVASION]: { auraStats: (v) => ({ dodgeRate: v.dodgeRate }) },
    [ItemSkillType.STONESKIN]: { auraStats: (v) => ({ defense: v.defense }) },
    [ItemSkillType.FORTITUDE]: { auraStats: (v) => ({ maxHp: v.maxHp }) },
    [ItemSkillType.LIQUID_COURAGE]: {
        ehpPerProc: (v, ctx) => (v.invulnMs / 1000) * ctx.ref.dps,
    },
    [ItemSkillType.ANTIDOTE]: {
        ehpPerProc: (v, ctx) => v.resistFraction * ctx.expectedPoisonDamageTaken,
    },
    [ItemSkillType.SALVE]: {
        ehpPerProc: (v, ctx) => v.resistFraction * ctx.expectedBurnDamageTaken,
    },
};

/** No hint (a skill added since this catalog was last touched). Contributes nothing rather than
 *  guessing — the coverage test and the runtime unknown-id counter are what surface it. */
export const UNKNOWN_SKILL_HINT: SkillHint = {};

export function skillHint(skillId: number): SkillHint | null {
    if (!skillId) return null;
    return SKILL_HINTS[skillId] ?? null;
}

export function valuesFor(skillId: number, rarity: number): Record<string, number> {
    const def = ITEM_SKILLS[skillId];
    if (!def) return {};
    return skillValues(def, rarity as ItemRarity);
}

/** The skill's OWN trigger types. Read from the definition rather than from `item.triggerTypes`,
 *  which is a union across the item's skills and is only written when a skill is actually granted
 *  — so scoring a shop item by the item's list would credit its skill with zero activations. */
export function skillTriggerTypes(skillId: number): string[] {
    return (ITEM_SKILLS[skillId]?.triggerTypes ?? []) as unknown as string[];
}
