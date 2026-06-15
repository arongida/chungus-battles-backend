// Tuning knobs for unique item effects, shared between the behavior
// implementations (ItemBehaviors.ts) and the rarity description updaters
// (ShopUpgradeUtils.ts). Keep formulas here so balance changes touch one file.

/** Chungi (7): fraction of the wielder's max HP used as max damage. */
export function chungiHpDamageFraction(rarity: number): number {
    return 0.05 + 0.05 * rarity;
}

/**
 * Two-handed weapons that keep their hand-authored base damage profile but
 * roll twice the usual affix count, and whose rarity upgrades merge base max
 * damage at 100% instead of the usual 50%.
 */
export const TWO_HANDED_WEAPON_IDS = new Set([4]); // Zwei-hander

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
