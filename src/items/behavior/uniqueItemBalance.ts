// Tuning knobs for unique item effects, shared between the behavior
// implementations (ItemBehaviors.ts) and the rarity description updaters
// (ShopUpgradeUtils.ts). Keep formulas here so balance changes touch one file.

import { RollableStat, STAT_RANGES } from '../stats/itemStatPool';
import { EquipSlot } from '../types/ItemTypes';
import { fmt } from '../../common/MessageTypes';
import type { Item } from '../schema/ItemSchema';

/** Chungi (7): fraction of the wielder's max HP used as max damage.
 *  Lowered ~20% in Season 25 (base HP doubled) to hold late-game output roughly steady. */
export function chungiHpDamageFraction(rarity: number): number {
    return 0.06 + 0.02 * rarity;
}

/**
 * Ring of Immortality (47): not a weapon, does not attack, grants no stats. SHOP_START: if
 * still equipped when the next draft begins (i.e. worn through a fight), it transforms into a
 * random item of the player's own tier rolled up to Legendary (see ringOfImmortality.ts).
 */
export const RING_OF_IMMORTALITY_ITEM_ID = 47;

/**
 * Magic Ring (702): not a weapon, does not attack. Starts Common with one
 * randomly rolled stat that grows permanently once per second (AURA) while
 * in a fight. Each level-up bumps its rarity and rolls another stat into
 * the mix, until all 6 are active at Mythic (level 5).
 *
 * No separate "which stats are active" tracking is kept — a stat counts as
 * rolled once its bonus (see `ringStatBonus`) is non-zero, since that's what
 * persists across the draft/fight DB round-trip and is already shown to the
 * player via the normal item stat display.
 *
 * attackSpeed is included, but on a different scale than the rest: it's a
 * multiplier based at 1 (1 = no change), not an additive-from-0 value, so
 * `ringStatBonus`/`addRingStatBonus` below special-case it rather than
 * touching `affectedStats.attackSpeed` directly.
 */
const MAGIC_RING_STAT_POOL: RollableStat[] = [
    'strength', 'accuracy', 'defense', 'maxHp', 'dodgeRate', 'hpRegen', 'income', 'attackSpeed',
];

/** Fraction of a stat's tier-max roll added per attack for each active rolled stat. */
const MAGIC_RING_STACK_FRACTION = 0.05;

export const MAGIC_RING_DESCRIPTION = 'Every 1s during battle: Gains bonus stats. Evolves on level up.';

/**
 * A ring stat's bonus above its neutral baseline. Every stat but attackSpeed
 * is additive-from-0, so its raw value is its bonus. attackSpeed is a
 * multiplier based at 1 ("no change"), so its bonus is the amount above 1.
 */
function ringStatBonus(affectedStats: Item['affectedStats'], stat: RollableStat): number {
    const v = (affectedStats as any)[stat] || 0;
    if (stat === 'attackSpeed') return v <= 1 ? 0 : v - 1;
    return v;
}

/** Adds `delta` to a ring stat's bonus, keeping attackSpeed on its base-1 multiplier scale. */
function addRingStatBonus(affectedStats: Item['affectedStats'], stat: RollableStat, delta: number): void {
    if (stat === 'attackSpeed') {
        (affectedStats as any).attackSpeed = 1 + ringStatBonus(affectedStats, stat) + delta;
    } else {
        (affectedStats as any)[stat] += delta;
    }
}

/** Picks a pool stat not yet rolled on this item (bonus still zero), or null once the pool is exhausted. */
function rollNextMagicRingStat(affectedStats: Item['affectedStats']): RollableStat | null {
    const available = MAGIC_RING_STAT_POOL.filter((stat) => ringStatBonus(affectedStats, stat) === 0);
    if (available.length === 0) return null;
    return available[Math.floor(Math.random() * available.length)];
}

/**
 * Per-second growth for one active stat at the ring's current rarity.
 * attackSpeed scales off its bonus range (max - 1, since STAT_RANGES.attackSpeed
 * is expressed as a base-1 multiplier), not the raw multiplier value.
 */
function magicRingStackAmount(stat: RollableStat, rarity: number): number {
    const tier = Math.min(5, Math.max(1, rarity));
    const max = STAT_RANGES[stat][tier].max;
    const scale = stat === 'attackSpeed' ? max - 1 : max;
    return Math.round(scale * MAGIC_RING_STACK_FRACTION * 100) / 100;
}

/** Magic Ring (702): rolls a new stat straight into `affectedStats` (non-zero bonus from the start) at the ring's current rarity. */
export function rollMagicRingBonus(item: Item): void {
    const stat = rollNextMagicRingStat(item.affectedStats);
    if (!stat) return;
    addRingStatBonus(item.affectedStats, stat, 12 * magicRingStackAmount(stat, item.rarity));
}

/** Magic Ring (702): adds one second's worth of growth to a random stat already rolled (non-zero bonus) on this item. */
export function stackMagicRingBonuses(item: Item): void {
    const rolled = MAGIC_RING_STAT_POOL.filter((stat) => ringStatBonus(item.affectedStats, stat) > 0);
    if (rolled.length === 0) return;
    const stat = rolled[Math.floor(Math.random() * rolled.length)];
    addRingStatBonus(item.affectedStats, stat, magicRingStackAmount(stat, item.rarity));
}

/**
 * Magic Ring (702): rerolls a fresh random set of stats at the ring's current
 * rarity, discarding all accumulated stacking bonuses. Keeps the same number
 * of active stats it already had (one per rarity level), just re-drawn from
 * the pool and reset to the fresh-roll baseline. Fired from SHOP_START while
 * the ring sits unequipped in inventory (see ItemBehaviors.ts).
 */
export function rerollMagicRingStats(item: Item): void {
    const activeCount = MAGIC_RING_STAT_POOL.filter((stat) => ringStatBonus(item.affectedStats, stat) > 0).length;
    if (activeCount === 0) return;

    for (const stat of MAGIC_RING_STAT_POOL) {
        (item.affectedStats as any)[stat] = stat === 'attackSpeed' ? 1 : 0;
    }

    const pool = [...MAGIC_RING_STAT_POOL];
    for (let i = 0; i < activeCount; i++) {
        const [stat] = pool.splice(Math.floor(Math.random() * pool.length), 1);
        addRingStatBonus(item.affectedStats, stat, 10 * magicRingStackAmount(stat, item.rarity));
    }
}

/**
 * Two-handed weapons that keep their hand-authored base damage profile but
 * roll twice the usual affix count, and whose rarity upgrades merge base max
 * damage at 100% instead of the usual 50%.
 *
 * This is purely about affix rolling — NOT the same thing as "blocks its paired slot"
 * (see TWO_HANDED_PAIRED_SLOT below). Flowering Staff (8) and Soulstealer's Scythe (59) both
 * block their paired slot but are deliberately left out of this set, staying fully
 * authored/affix-free (see itemStatRoller.ts's keepsAuthoredStats).
 */
export const TWO_HANDED_WEAPON_IDS = new Set([4]); // Zwei-hander

/**
 * The slot a "takes both hands"-style item (Zwei-Hander id 4, Flowering Staff id 8,
 * Soulstealer's Scythe id 59 — see ItemBehaviors.ts) blocks while equipped. mainHand/offHand is
 * the original pairing; a Martial Artist can now also place these in armor/helmet
 * (TalentBehaviors.ts), so armor/helmet form a second pair on the same principle — occupying one
 * slot of a pair blocks its partner.
 */
export const TWO_HANDED_PAIRED_SLOT: Record<EquipSlot, EquipSlot> = {
    [EquipSlot.MAIN_HAND]: EquipSlot.OFF_HAND,
    [EquipSlot.OFF_HAND]: EquipSlot.MAIN_HAND,
    [EquipSlot.ARMOR]: EquipSlot.HELMET,
    [EquipSlot.HELMET]: EquipSlot.ARMOR,
};

/** Soulstealer's Scythe (59). */
export const SOULSTEALER_SCYTHE_ITEM_ID = 59;

/**
 * Weapons whose swings bypass dodge, Brace's one-shot block, and invulnerability entirely (see
 * FightRoom.tryWeaponAttack) — defense still mitigates. Distinct from TWO_HANDED_WEAPON_IDS
 * above, which is only about affix rolling.
 */
export const UNAVOIDABLE_WEAPON_IDS = new Set([SOULSTEALER_SCYTHE_ITEM_ID]);

/** Soulstealer's Scythe: max damage permanently added per soul reaped (one per hit landed). */
export function scytheSoulValue(rarity: number): number {
    return 2 + 1.5 * rarity; // Common 3.5 .. Mythic 9.5
}

/** Soulstealer's Scythe: souls reaped so far this fight, keyed by item instance. Uncapped —
 *  FightRoom builds fresh Item instances every fight, so this needs no explicit FIGHT_START
 *  reset. */
export const scytheSouls = new WeakMap<Item, number>();

/** Live status line shown under an equipped item's description (mirrors ITEM_SKILLS' status()
 *  functions in itemSkillBalance.ts, but for uniques that carry no skillId — see
 *  itemSkillStatus.ts's fallback). Empty until the item has actually procced. */
export const UNIQUE_ITEM_STATUS: Partial<Record<number, (item: Item) => string>> = {
    [SOULSTEALER_SCYTHE_ITEM_ID]: (item) => {
        const souls = scytheSouls.get(item) ?? 0;
        if (souls <= 0) return '';
        return `${souls} soul${souls === 1 ? '' : 's'} reaped (+${fmt(item.bonusMaxDamage)} max damage)`;
    },
};

/**
 * Items excluded from the shop's owned-item rarity-upgrade path
 * (findOwnedUpgradeTarget). Health Flask (6) is a consumable whose rarity
 * is meant to come from its shop roll, not from stacking upgrades; Ring of
 * Immortality (47) grants no stats and its rarity is irrelevant to its
 * SHOP_START transform, so upgrading it would only be confusing.
 */
export const NON_UPGRADEABLE_ITEM_IDS = new Set([6, 47]); // Health Flask, Ring of Immortality

/**
 * Wand of Fire (14) / Flowering Staff (8) / Magic Ring (702): cooldownReduction granted per
 * rarity step (Common=1 .. Mythic=5). Flat authored values, not part of any rollable pool — see
 * common/cooldown.ts for how the rating converts into an actual activation-interval speedup.
 */
export const magicWandCooldownReduction = (rarity: number) => 30 + 15 * (rarity - 1);       // 30..90
export const floweringStaffCooldownReduction = (rarity: number) => 40 + 20 * (rarity - 1);  // 40..120
export const magicRingCooldownReduction = (rarity: number) => 10 + 10 * (rarity - 1);       // 20..60

/**
 * Flowering Staff (8): hpRegen stolen from the enemy per ACTIVE proc (once every
 * 1/activationRate seconds, shortened by cooldownReduction like any other active skill) —
 * granted to the wielder, subtracted from the enemy (can push the enemy's regen negative).
 */
export function floweringStaffRegenSteal(rarity: number): number {
    return 0.5 + 0.3 * rarity;
}

/** Flowering Staff (8): per-fight cap on the total hpRegen swing stolen (both sides). */
export const FLOWERING_STAFF_MAX_STEAL = 25;

/** Wand of Fire (14): burn stacks applied per ACTIVE proc. */
export function wandOfFireBurnStacks(rarity: number): number {
    return 3 + rarity;
}

/** Burn DoT: flat damage dealt per stack each second. */
export const BURN_DAMAGE_PER_STACK = 2;

/** Burn DoT: how long an application's stacks last. */
export const BURN_DURATION_MS = 3000;

/** Burn is double-edged: applying it to the enemy singes the applier for a third as many
 *  stacks (rounded up). Applied via Player.igniteEnemy — Hidden Vials (24) is the one
 *  exception and bypasses it. */
export const selfBurnStacks = (applied: number) => Math.ceil(applied / 3);

/** Fire with Fire (31): max burn stacks consumed from each player per proc. */
export const FIRE_WITH_FIRE_MAX_STACKS = 10;

/**
 * Health Flask (6): flat price, flat effect — drinking it banks an hpRegen bonus
 * (PlayerSchema.pendingRegenBuff) that applies for the wearer's next fight only, then is spent
 * (see FightRoom.handleFightEnd). Priced like any other item (HEALTH_FLASK_PRICE) rather than
 * scaled by level/gold. Roughly 3x the hpRegen a normal tier-3 item gives at a comparable price
 * (tier 3 gear costs 10 and rolls up to 4 hpRegen — see STAT_RANGES.hpRegen in itemStatPool.ts),
 * since this bonus only lasts one fight instead of being permanent.
 *
 * Documentation only — the authoritative value is Item(6).price in Mongo (see
 * scripts/increaseItemPrices.ts); this constant is never imported.
 */
export const HEALTH_FLASK_PRICE = 12;
export const HEALTH_FLASK_REGEN_PER_SECOND = 10;

/** Band of Vigor (27): HP fraction below which "Second Wind" can proc, once per fight. */
export const SECOND_WIND_THRESHOLD = 0.3;

/** Band of Vigor (27): burst heal on proc, as a fraction of the wearer's max HP. */
export function secondWindHealFraction(rarity: number): number {
    return 0.1 + 0.1 * rarity;
}

/** Band of Vigor (27): invulnerability window granted on proc. */
export function secondWindInvulnMs(rarity: number): number {
    return 300 + 350 * rarity;
}

export const GAMBLERS_DICE_ITEM_ID = 703;

/** Gambler's Dice (703), main hand: permanent income gained after every fight WON while worn
 *  there — feeds back into the dice's own baseMaxDamage (= income * rarity/2), so a winning
 *  streak compounds into both economy and damage. */
export function diceWinIncome(rarity: number): number {
    return Math.ceil(rarity / 2); // 1,1,2,2,3
}

/** Gambler's Dice (703), off hand: one-off gold refund after every fight LOST while worn there —
 *  insurance rather than a snowball. */
export function diceLossGold(rarity: number): number {
    return rarity * 4; // 4,8,12,16,20
}

/** Gambler's Dice (703) description — single source of truth, used by both the item's own
 *  LEVEL_UP rarity-up text (ItemBehaviors.ts) and the GAMBLER talent's initial grant
 *  (TalentBehaviors.ts) so the two can't drift apart. */
export function diceDescription(rarity: number): string {
    return `Max damage equals ${Math.round((rarity / 2) * 100)}% of income. Main hand: gain permanent income after every win. Off hand: refund gold after every loss.`;
}
