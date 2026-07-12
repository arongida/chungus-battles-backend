// Tuning knobs for unique item effects, shared between the behavior
// implementations (ItemBehaviors.ts) and the rarity description updaters
// (ShopUpgradeUtils.ts). Keep formulas here so balance changes touch one file.

import { RollableStat, STAT_RANGES } from '../stats/itemStatPool';
import type { Item } from '../schema/ItemSchema';

/** Chungi (7): fraction of the wielder's max HP used as max damage. */
export function chungiHpDamageFraction(rarity: number): number {
    return 0.05 + 0.05 * rarity;
}

/**
 * Magic Ring (702): not a weapon, does not attack. Starts Common with one
 * randomly rolled stat that grows permanently once per second (AURA) while
 * in a fight. Each level-up bumps its rarity and rolls another stat into
 * the mix, until all 5 are active at Mythic (level 5).
 *
 * No separate "which stats are active" tracking is kept — a stat counts as
 * rolled once its `affectedStats` value is non-zero, since that's what
 * persists across the draft/fight DB round-trip and is already shown to the
 * player via the normal item stat display.
 *
 * attackSpeed is excluded from the pool — stacking it would create a
 * feedback loop that no longer even applies now that the ring doesn't
 * attack, but is kept excluded for consistency with other stacking effects.
 */
const MAGIC_RING_STAT_POOL: RollableStat[] = [
    'strength', 'accuracy', 'defense', 'maxHp', 'dodgeRate', 'hpRegen', 'income',
];

/** Fraction of a stat's tier-max roll added per attack for each active rolled stat. */
const MAGIC_RING_STACK_FRACTION = 0.04;

export const MAGIC_RING_DESCRIPTION = 'Gains bonus stats every second in combat and evolves on level up.';

/** Picks a pool stat not yet rolled on this item (still zero), or null once the pool is exhausted. */
function rollNextMagicRingStat(affectedStats: Item['affectedStats']): RollableStat | null {
    const available = MAGIC_RING_STAT_POOL.filter((stat) => !(affectedStats as any)[stat]);
    if (available.length === 0) return null;
    return available[Math.floor(Math.random() * available.length)];
}

/** Per-second growth for one active stat at the ring's current rarity. */
function magicRingStackAmount(stat: RollableStat, rarity: number): number {
    const tier = Math.min(5, Math.max(1, rarity));
    return Math.round(STAT_RANGES[stat][tier].max * MAGIC_RING_STACK_FRACTION * 100) / 100;
}

/** Magic Ring (702): rolls a new stat straight into `affectedStats` (non-zero from the start) at the ring's current rarity. */
export function rollMagicRingBonus(item: Item): void {
    const stat = rollNextMagicRingStat(item.affectedStats);
    if (!stat) return;
    (item.affectedStats as any)[stat] += 20 * magicRingStackAmount(stat, item.rarity);
}

/** Magic Ring (702): adds one second's worth of growth to a random stat already rolled (non-zero) on this item. */
export function stackMagicRingBonuses(item: Item): void {
    const rolled = MAGIC_RING_STAT_POOL.filter((stat) => (item.affectedStats as any)[stat]);
    if (rolled.length === 0) return;
    const stat = rolled[Math.floor(Math.random() * rolled.length)];
    (item.affectedStats as any)[stat] += magicRingStackAmount(stat, item.rarity);
}

/**
 * Two-handed weapons that keep their hand-authored base damage profile but
 * roll twice the usual affix count, and whose rarity upgrades merge base max
 * damage at 100% instead of the usual 50%.
 */
export const TWO_HANDED_WEAPON_IDS = new Set([4]); // Zwei-hander

/**
 * Items excluded from the shop's owned-item rarity-upgrade path
 * (findOwnedUpgradeTarget). Health Flask (6) is a consumable whose rarity
 * is meant to come from its shop roll, not from stacking upgrades; Ring of
 * Immortality (47) grants no stats and its rarity is irrelevant to its
 * SHOP_START transform, so upgrading it would only be confusing.
 */
export const NON_UPGRADEABLE_ITEM_IDS = new Set([6, 47]); // Health Flask, Ring of Immortality

/** Flowering Staff (8): invulnerability window granted after each attack. */
export function floweringStaffInvulnMs(rarity: number): number {
    return 200 + 100 * rarity;
}

/**
 * Flowering Staff (8): minimum time between invulnerability procs. Must stay
 * above the longest possible window so shields can never chain into
 * permanent invulnerability, no matter how much attack speed is stacked.
 */
export const FLOWERING_STAFF_INVULN_COOLDOWN_MS = 1000;

/** Wand of Fire (14): burn stacks applied per hit. */
export function wandOfFireBurnStacks(rarity: number): number {
    return rarity;
}

/** Burn DoT: flat damage dealt per stack each second. */
export const BURN_DAMAGE_PER_STACK = 2;

/** Burn DoT: how long an application's stacks last. */
export const BURN_DURATION_MS = 3000;

/**
 * Health Flask (6): flat price, flat effect — drinking it banks an hpRegen bonus
 * (PlayerSchema.pendingRegenBuff) that applies for the wearer's next fight only, then is spent
 * (see FightRoom.handleFightEnd). Priced like any other item (HEALTH_FLASK_PRICE) rather than
 * scaled by level/gold. Roughly 3x the hpRegen a normal tier-3 item gives at a comparable price
 * (tier 3 gear costs 8 and rolls up to 4 hpRegen — see STAT_RANGES.hpRegen in itemStatPool.ts),
 * since this bonus only lasts one fight instead of being permanent.
 */
export const HEALTH_FLASK_PRICE = 10;
export const HEALTH_FLASK_REGEN_PER_SECOND = 10;

/** Band of Vigor (27): HP fraction below which "Second Wind" can proc, once per fight. */
export const SECOND_WIND_THRESHOLD = 0.3;

/** Band of Vigor (27): burst heal on proc, as a fraction of the wearer's max HP. */
export function secondWindHealFraction(rarity: number): number {
    return 0.1 + 0.05 * rarity;
}

/** Band of Vigor (27): invulnerability window granted on proc. */
export function secondWindInvulnMs(rarity: number): number {
    return 500 + 300 * rarity;
}
