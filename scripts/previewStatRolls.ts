/**
 * Throwaway preview script — prints sample stat rolls across every
 * (type × class × tier) combination so you can eyeball balance.
 *
 * Run with:  npx tsx scripts/previewStatRolls.ts
 */

import {
    AFFIX_COUNT_BY_TIER,
    clampTier,
    getEligiblePool,
    getWeaponArchetype,
    RollableStat,
    STAT_RANGES,
    WEAPON_BASE_RANGES,
} from '../src/items/stats/itemStatPool';
import { ItemClass, ItemType } from '../src/items/types/ItemTypes';

// ── Tiny roller (no game deps) ────────────────────────────────────────────────

function rollRange(min: number, max: number, isFloat?: boolean): number {
    const raw = Math.random() * (max - min) + min;
    return isFloat ? Math.round(raw * 100) / 100 : Math.floor(raw);
}

function rollAffixes(type: ItemType, itemClass: string | undefined, tier: number): Partial<Record<RollableStat, number>> {
    const t = clampTier(tier);
    const pool = getEligiblePool(type, itemClass);
    const n    = Math.min(AFFIX_COUNT_BY_TIER[t] ?? 1, pool.length);

    // Shuffle and take n
    const shuffled = [...pool].sort(() => Math.random() - 0.5).slice(0, n);
    const result: Partial<Record<RollableStat, number>> = {};
    for (const stat of shuffled) {
        const range = STAT_RANGES[stat][t];
        result[stat] = rollRange(range.min, range.max, range.isFloat);
    }
    return result;
}

function rollWeaponBase(itemClass: string | undefined, tier: number) {
    const t   = clampTier(tier);
    const arc = getWeaponArchetype(itemClass);
    const r   = WEAPON_BASE_RANGES[arc][t];
    const minDmg = rollRange(r.minDamage.min, r.minDamage.max);
    const spread = rollRange(r.maxDamageSpread.min, r.maxDamageSpread.max);
    const spd    = rollRange(r.attackSpeed.min, r.attackSpeed.max, r.attackSpeed.isFloat);
    return { baseMinDamage: minDmg, baseMaxDamage: minDmg + spread, baseAttackSpeed: spd };
}

// ── Print ─────────────────────────────────────────────────────────────────────

const TYPES   = [ItemType.WEAPON, ItemType.ARMOR, ItemType.HELMET, ItemType.SHIELD];
const CLASSES = [ItemClass.WARRIOR, ItemClass.ROGUE, ItemClass.MERCHANT, undefined];
const TIERS   = [1, 2, 3, 4, 5];
const SAMPLES = 3; // rolls per combo

for (const type of TYPES) {
    for (const itemClass of CLASSES) {
        if (itemClass === undefined && type !== ItemType.WEAPON) continue; // classless armor is not in DB, skip
        console.log(`\n══ ${type.toUpperCase()} / class:${itemClass ?? 'none'} ══`);
        for (const tier of TIERS) {
            console.log(`  Tier ${tier}:`);
            for (let i = 0; i < SAMPLES; i++) {
                const affixes = rollAffixes(type, itemClass, tier);
                const line = Object.entries(affixes).map(([k, v]) => `${k}=${v}`).join(', ');
                if (type === ItemType.WEAPON) {
                    const base = rollWeaponBase(itemClass, tier);
                    console.log(`    [${i + 1}] ${line} | base: minDmg=${base.baseMinDamage} maxDmg=${base.baseMaxDamage} atkSpd=${base.baseAttackSpeed}`);
                } else {
                    console.log(`    [${i + 1}] ${line}`);
                }
            }
        }
    }
}
