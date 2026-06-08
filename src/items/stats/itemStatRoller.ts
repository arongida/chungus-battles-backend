import { AffectedStats } from '../../common/schema/AffectedStatsSchema';
import { rollTheDice } from '../../common/utils';
import { ItemType } from '../types/ItemTypes';
import { ItemBehaviors } from '../behavior/ItemBehaviors';
import { Item } from '../schema/ItemSchema';
import {
    AFFIX_COUNT_BY_TIER,
    clampTier,
    getEligiblePool,
    getWeaponArchetype,
    RollableStat,
    STAT_RANGES,
    WEAPON_BASE_RANGES,
} from './itemStatPool';
import { shieldDescription } from '../../commands/ShopUpgradeUtils';

// ── Float roller (2-decimal precision) ───────────────────────────────────────

function rollFloat(min: number, max: number): number {
    const raw = Math.random() * (max - min) + min;
    return Math.round(raw * 100) / 100;
}

// ── Single-stat roller dispatching int vs float ───────────────────────────────

function rollStat(stat: RollableStat, tier: number): number {
    const range = STAT_RANGES[stat][tier];
    return range.isFloat
        ? rollFloat(range.min, range.max)
        : rollTheDice(range.min, range.max);
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Rolls randomized stats onto a shop `Item` in-place.
 *
 * Rules:
 * - Items with active behaviors (`ItemBehaviors` map), `triggerTypes`, or
 *   the `'unique'` tag keep their hand-authored stats.
 * - Items of unknown / non-standard type (potions, quest-only) are skipped
 *   because `getEligiblePool` returns an empty array for them.
 * - Only `affectedStats` and (for weapons) base damage are rewritten;
 *   `affectedEnemyStats`, behaviors, name, and description are never touched.
 */
export function rollItemStats(item: Item): void {
    // Guard: hand-authored behavior / unique items keep their stats.
    // Shields are exempt from the triggerTypes guard — they have FIGHT_START wired
    // via the type-based behavior but still need rolled defensive stats.
    if (ItemBehaviors[item.itemId]) return;
    if (item.type !== ItemType.SHIELD && item.triggerTypes?.length > 0) return;
    if (item.tags && Array.from(item.tags).includes('unique')) return;

    const pool = getEligiblePool(item.type as ItemType, item.class);
    if (pool.length === 0) return; // potions, unknown types — skip

    const tier = clampTier(item.tier);
    const n = Math.min(AFFIX_COUNT_BY_TIER[tier] ?? 1, pool.length);

    // Shuffle pool and take n distinct stats.
    const shuffled = [...pool].sort(() => Math.random() - 0.5).slice(0, n);

    const newStats = new AffectedStats();
    for (const stat of shuffled) {
        (newStats as any)[stat] = rollStat(stat, tier);
    }
    item.affectedStats = newStats;

    if (item.type === ItemType.SHIELD) {
        item.description = shieldDescription(item.tier);
    }

    // Weapon base damage — archetype-specific per-tier ranges.
    if (item.type === ItemType.WEAPON) {
        const arc = getWeaponArchetype(item.class);
        const r   = WEAPON_BASE_RANGES[arc][tier];
        const minDmgRange = r.minDamage;
        const spreadRange = r.maxDamageSpread;
        const spdRange    = r.attackSpeed;

        const baseMin = rollTheDice(minDmgRange.min, minDmgRange.max);
        const spread  = rollTheDice(spreadRange.min, spreadRange.max);

        item.baseMinDamage   = baseMin;
        item.baseMaxDamage   = baseMin + spread;
        item.baseAttackSpeed = rollFloat(spdRange.min, spdRange.max);
    }
}
