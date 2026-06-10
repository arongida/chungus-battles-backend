import { ItemType } from '../types/ItemTypes';
import { Item } from '../schema/ItemSchema';
import { keepsAuthoredStats } from './itemStatRoller';
import {
    AFFIX_COUNT_BY_TIER,
    clampTier,
    getEligiblePool,
    getWeaponArchetype,
    RollableStat,
    STAT_RANGES,
    WEAPON_BASE_RANGES,
} from './itemStatPool';
import { TWO_HANDED_WEAPON_IDS } from '../behavior/uniqueItemBalance';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface NumberRange {
    min: number;
    max: number;
}

export interface PossibleStatRange extends NumberRange {
    stat: RollableStat;
}

export interface WeaponBasePreview {
    minDamage: NumberRange;
    maxDamage: NumberRange;
    attackSpeed: NumberRange;
}

export interface ItemRollPreview {
    affixCount: number;
    possibleStats: PossibleStatRange[];
    weaponBase?: WeaponBasePreview;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Computes the possible stat rolls for an item template, mirroring the rules
 * in `rollItemStats` without rolling. Used by the `/items` catalog endpoint so
 * the encyclopedia can show rollable stats with ranges instead of the stale
 * hand-authored template stats.
 *
 * Returns `null` for items that keep their authored stats (unique/behavior
 * items, potions, quest items) — those display as-is.
 */
export function getItemRollPreview(item: Item): ItemRollPreview | null {
    if (keepsAuthoredStats(item)) return null;
    if (item.tags && Array.from(item.tags).includes('quest')) return null;

    const pool = getEligiblePool(item.type as ItemType, item.class);
    if (pool.length === 0) return null; // potions, unknown types

    const tier = clampTier(item.tier);
    const twoHanded = TWO_HANDED_WEAPON_IDS.has(item.itemId);
    const affixCount = Math.min((AFFIX_COUNT_BY_TIER[tier] ?? 1) * (twoHanded ? 2 : 1), pool.length);

    const possibleStats: PossibleStatRange[] = pool.map(stat => ({
        stat,
        min: STAT_RANGES[stat][tier].min,
        max: STAT_RANGES[stat][tier].max,
    }));

    const preview: ItemRollPreview = { affixCount, possibleStats };

    // Two-handers keep their authored damage profile, so no base-damage ranges.
    if (item.type === ItemType.WEAPON && !twoHanded) {
        const r = WEAPON_BASE_RANGES[getWeaponArchetype(item.class)][tier];
        preview.weaponBase = {
            minDamage: { min: r.minDamage.min, max: r.minDamage.max },
            maxDamage: {
                min: r.minDamage.min + r.maxDamageSpread.min,
                max: r.minDamage.max + r.maxDamageSpread.max,
            },
            attackSpeed: { min: r.attackSpeed.min, max: r.attackSpeed.max },
        };
    }

    return preview;
}
