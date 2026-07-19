import { ItemClass, ItemType } from '../types/ItemTypes';

// ── Types ─────────────────────────────────────────────────────────────────────

export type RollableStat =
    | 'strength'
    | 'accuracy'
    | 'attackSpeed'
    | 'defense'
    | 'maxHp'
    | 'income'
    | 'dodgeRate'
    | 'hpRegen';

export interface StatRange {
    min: number;
    max: number;
    isFloat?: boolean;
}

// Weapon base-damage archetype keys. Classless weapons use 'default' (same
// combat numbers as merchant).
export type WeaponArchetype = ItemClass | 'default';

// ── Pool definitions ──────────────────────────────────────────────────────────

/** Base eligible-stat pool for each item type (offensive vs. defensive). */
export const TYPE_STAT_POOL: Record<ItemType, RollableStat[]> = {
    [ItemType.WEAPON]: ['strength', 'accuracy', 'attackSpeed'],
    [ItemType.ARMOR]:  ['defense', 'maxHp'],
    [ItemType.HELMET]: ['defense', 'maxHp'],
    [ItemType.SHIELD]: ['defense', 'maxHp'],
};

/**
 * Class-signature stats eligible on class items.
 * Added to the type pool as possible draws — not guaranteed.
 */
export const CLASS_STATS: Record<ItemClass, RollableStat[]> = {
    [ItemClass.MERCHANT]: ['income'],
    [ItemClass.ROGUE]:    ['dodgeRate', 'attackSpeed'],
    [ItemClass.WARRIOR]:  ['hpRegen', 'strength'],
};

/** Number of affix rolls for a given tier (capped to pool size before drawing). */
export const AFFIX_COUNT_BY_TIER: Record<number, number> = {
    1: 1,
    2: 1,
    3: 1,
    4: 1,
    5: 1,
};

// ── Affix stat ranges by tier ─────────────────────────────────────────────────

/**
 * Per-stat, per-tier value ranges.
 * Float stats (attackSpeed, hpRegen) are marked isFloat=true
 * so the roller can use two-decimal precision instead of integer rounding.
 */
export const STAT_RANGES: Record<RollableStat, Record<number, StatRange>> = {
    strength: {
        1: { min: 1,  max: 3  },
        2: { min: 2,  max: 5  },
        3: { min: 4,  max: 8  },
        4: { min: 8,  max: 16  },
        5: { min: 16,  max: 30 },
    },
    accuracy: {
        1: { min: 1,  max: 3  },
        2: { min: 2,  max: 5  },
        3: { min: 4,  max: 8  },
        4: { min: 8,  max: 16  },
        5: { min: 16,  max: 30 },
    },
    // Multiplier: 1.0 = no change. Stored as a float so the roller must use
    // isFloat precision.
    attackSpeed: {
        1: { min: 1.05, max: 1.1, isFloat: true },
        2: { min: 1.08, max: 1.16, isFloat: true },
        3: { min: 1.14, max: 1.28, isFloat: true },
        4: { min: 1.24, max: 1.52, isFloat: true },
        5: { min: 1.48, max: 1.88, isFloat: true },
    },
    defense: {
        1: { min: 8,  max: 16   },
        2: { min: 14,  max: 26  },
        3: { min: 24, max: 52  },
        4: { min: 48, max: 96  },
        5: { min: 88, max: 140  },
    },
    maxHp: {
        1: { min: 10, max: 25  },
        2: { min: 20, max: 45  },
        3: { min: 40, max: 80  },
        4: { min: 80, max: 160  },
        5: { min: 160, max: 280 },
    },
    income: {
        1: { min: 1, max: 1  },
        2: { min: 2, max: 2  },
        3: { min: 3, max: 4  },
        4: { min: 4, max: 8  },
        5: { min: 8, max: 14 },
    },
    dodgeRate: {
        1: { min: 5,  max: 10   },
        2: { min: 8,  max: 16  },
        3: { min: 14, max: 26  },
        4: { min: 24, max: 52  },
        5: { min: 48, max: 86  },
    },
    hpRegen: {
        1: { min: 0, max: 2, isFloat: true },
        2: { min: 1, max: 3, isFloat: true },
        3: { min: 2, max: 5, isFloat: true },
        4: { min: 4, max: 8, isFloat: true },
        5: { min: 8, max: 14, isFloat: true },
    },
};

// ── Weapon base-damage ranges by archetype × tier ────────────────────────────

/**
 * WARRIOR — slow, hard-hitting.
 * baseMaxDamage is expressed as a *spread added to baseMinDamage*, so the
 * roller must roll minDamage first, then add the spread.
 */
const WARRIOR_WEAPON_RANGES: Record<number, { minDamage: StatRange; maxDamageSpread: StatRange; attackSpeed: StatRange }> = {
    1: { minDamage: { min: 1, max: 2 }, maxDamageSpread: { min: 2, max: 3 },  attackSpeed: { min: 0.45, max: 0.55, isFloat: true } },
    2: { minDamage: { min: 2, max: 4 }, maxDamageSpread: { min: 3, max: 5 },  attackSpeed: { min: 0.50, max: 0.60, isFloat: true } },
    3: { minDamage: { min: 4, max: 6 }, maxDamageSpread: { min: 4, max: 7 },  attackSpeed: { min: 0.50, max: 0.65, isFloat: true } },
    4: { minDamage: { min: 6, max: 9 }, maxDamageSpread: { min: 6, max: 9 },  attackSpeed: { min: 0.55, max: 0.70, isFloat: true } },
    5: { minDamage: { min: 8, max: 12 }, maxDamageSpread: { min: 8, max: 12 }, attackSpeed: { min: 0.60, max: 0.75, isFloat: true } },
};

/**
 * ROGUE — fast, light hits.
 */
const ROGUE_WEAPON_RANGES: Record<number, { minDamage: StatRange; maxDamageSpread: StatRange; attackSpeed: StatRange }> = {
    1: { minDamage: { min: 0, max: 1 }, maxDamageSpread: { min: 1, max: 1 },  attackSpeed: { min: 0.80, max: 0.95, isFloat: true } },
    2: { minDamage: { min: 1, max: 2 }, maxDamageSpread: { min: 1, max: 2 },  attackSpeed: { min: 0.85, max: 1.00, isFloat: true } },
    3: { minDamage: { min: 1, max: 3 }, maxDamageSpread: { min: 2, max: 3 },  attackSpeed: { min: 0.90, max: 1.10, isFloat: true } },
    4: { minDamage: { min: 2, max: 4 }, maxDamageSpread: { min: 2, max: 4 },  attackSpeed: { min: 0.95, max: 1.20, isFloat: true } },
    5: { minDamage: { min: 3, max: 5 }, maxDamageSpread: { min: 3, max: 5 },  attackSpeed: { min: 1.00, max: 1.30, isFloat: true } },
};

/**
 * MERCHANT / generic setless — average combat stats.
 * Merchant weapons can also draw `income` from their affix pool (handled in
 * the pool resolver), compensating for weaker base damage.
 */
const DEFAULT_WEAPON_RANGES: Record<number, { minDamage: StatRange; maxDamageSpread: StatRange; attackSpeed: StatRange }> = {
    1: { minDamage: { min: 0, max: 1 }, maxDamageSpread: { min: 1, max: 2 },  attackSpeed: { min: 0.55, max: 0.70, isFloat: true } },
    2: { minDamage: { min: 1, max: 2 }, maxDamageSpread: { min: 2, max: 3 },  attackSpeed: { min: 0.60, max: 0.75, isFloat: true } },
    3: { minDamage: { min: 2, max: 4 }, maxDamageSpread: { min: 3, max: 5 },  attackSpeed: { min: 0.60, max: 0.80, isFloat: true } },
    4: { minDamage: { min: 3, max: 6 }, maxDamageSpread: { min: 4, max: 7 },  attackSpeed: { min: 0.65, max: 0.90, isFloat: true } },
    5: { minDamage: { min: 5, max: 8 }, maxDamageSpread: { min: 6, max: 10 }, attackSpeed: { min: 0.70, max: 1.00, isFloat: true } },
};

export const WEAPON_BASE_RANGES: Record<WeaponArchetype, Record<number, {
    minDamage: StatRange;
    maxDamageSpread: StatRange;
    attackSpeed: StatRange;
}>> = {
    [ItemClass.WARRIOR]:  WARRIOR_WEAPON_RANGES,
    [ItemClass.ROGUE]:    ROGUE_WEAPON_RANGES,
    [ItemClass.MERCHANT]: DEFAULT_WEAPON_RANGES,
    default:              DEFAULT_WEAPON_RANGES,
};

// ── Helper functions ──────────────────────────────────────────────────────────

/**
 * Returns the weapon archetype for a weapon's `class` field.
 * Classless weapons (no class, or unknown class) fall back to 'default'.
 */
export function getWeaponArchetype(itemClass?: string): WeaponArchetype {
    if (itemClass === ItemClass.WARRIOR)  return ItemClass.WARRIOR;
    if (itemClass === ItemClass.ROGUE)    return ItemClass.ROGUE;
    if (itemClass === ItemClass.MERCHANT) return ItemClass.MERCHANT;
    return 'default';
}

/**
 * Clamps a tier value into the range [1, 5] that the pool covers.
 * Quest items (tier 91+) would be clamped to 5, but they're excluded from
 * the shop sample before this is ever called.
 */
export function clampTier(tier: number): number {
    return Math.min(5, Math.max(1, tier));
}

/**
 * Returns the full eligible stat pool for an item (type base pool + optional
 * class-signature stats for class items). Deduplicated so stats already in
 * the type pool (e.g. strength on warrior weapons) aren't double-weighted.
 */
export function getEligiblePool(type: ItemType, itemClass?: string): RollableStat[] {
    const base = [...(TYPE_STAT_POOL[type] ?? [])];
    const classStats = itemClass ? CLASS_STATS[itemClass as ItemClass] ?? [] : [];
    for (const stat of classStats) {
        if (!base.includes(stat)) base.push(stat);
    }
    return base;
}
