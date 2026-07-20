import { Item } from '../items/schema/ItemSchema';
import { Player } from '../players/schema/PlayerSchema';
import { ItemRarity, ItemType } from '../items/types/ItemTypes';
import { cloneItem } from '../items/db/Item';
import { rollItemStats } from '../items/stats/itemStatRoller';
import {
  BURN_DAMAGE_PER_STACK,
  BURN_DURATION_MS,
  chungiHpDamageFraction,
  FLOWERING_STAFF_INVULN_COOLDOWN_MS,
  floweringStaffInvulnMs,
  NON_UPGRADEABLE_ITEM_IDS,
  secondWindHealFraction,
  secondWindInvulnMs,
  SECOND_WIND_THRESHOLD,
  TWO_HANDED_WEAPON_IDS,
  wandOfFireBurnStacks,
} from '../items/behavior/uniqueItemBalance';

// Note: Health Flask (6) has no entry here — its rarity is pinned to Common (it's in
// NON_UPGRADEABLE_ITEM_IDS and excluded from shop lucky-find), so updateRarityDescription's
// `rarity <= 1` guard means it would never fire; the DB-authored description is always accurate.
const itemDescriptionUpdaters: Partial<Record<number, (item: Item, player: Player) => string>> = {
  7: (item) => `Max damage equals ${Math.round(chungiHpDamageFraction(item.rarity) * 100)}% of your max HP.`,
  8: (item) => `2-handed. Attacks shield you for ${(floweringStaffInvulnMs(item.rarity) / 1000).toFixed(1)}s (once every ${FLOWERING_STAFF_INVULN_COOLDOWN_MS / 1000}s).`,
  14: (item) => {
    const stacks = wandOfFireBurnStacks(item.rarity);
    return `Each hit applies ${stacks} burn stack${stacks > 1 ? 's' : ''} (${BURN_DAMAGE_PER_STACK} damage per stack per second, for ${BURN_DURATION_MS / 1000}s).`;
  },
  18: (item) => {
    const stacks = item.rarity;
    return `Applies ${stacks} poison stack${stacks > 1 ? 's' : ''} on hit. Each stack deals 1% max HP over 5s and cuts healing by 1%.`;
  },
  59: (item) => `Heals for ${item.rarity * 5 + 6}% of damage dealt on hit.`,
  703: (item) => {
    const multiplier = item.rarity / 2;
    return multiplier === 1
      ? 'Max damage equals your current income.'
      : `Max damage equals ${multiplier}x your current income.`;
  },
  27: (item) => {
    const healPct = Math.round(secondWindHealFraction(item.rarity) * 100);
    const invulnSec = (secondWindInvulnMs(item.rarity) / 1000).toFixed(1);
    return `The first time you fall below ${Math.round(SECOND_WIND_THRESHOLD * 100)}% HP in a fight, heal ${healPct}% of your max HP and become invulnerable for ${invulnSec}s. Once per fight.`;
  },
};

function updateRarityDescription(target: Item, player: Player): void {
  if (target.rarity <= 1) return;
  const updater = itemDescriptionUpdaters[target.itemId];
  if (updater) target.description = updater(target, player);
}

export function shieldDescription(tier: number): string {
  return `${((500 + 500 * tier) / 1000).toFixed(1)}s invulnerability at fight start.`;
}

export function applyRarityUpgrade(target: Item, source: Item, player: Player, increaseSellPrice = true): void {
  target.rarity++;
  if (increaseSellPrice) target.sellPrice += source.sellPrice;
  updateRarityDescription(target, player);
  // Affixes always merge at 100% regardless of class.
  target.affectedStats.mergeInto(source.affectedStats);

  // Weapon base stats stack at 50% of the merged source's rolled values.
  // Two-handers merge max damage at 100% — their authored damage is the
  // payoff for the blocked off-hand.
  if (target.type === ItemType.WEAPON) {
    const maxDamageScale = TWO_HANDED_WEAPON_IDS.has(target.itemId) ? 1 : 0.5;
    target.baseMinDamage   += source.baseMinDamage   * 0.5;
    target.baseMaxDamage   += source.baseMaxDamage   * maxDamageScale;
    target.baseAttackSpeed += source.baseAttackSpeed * 0.5;
  }
}

/** Base (un-modified) lucky-find rarity-up chance for a shop slot at this level.
 *  Seeded onto Player.luckyFindChance each draft aura tick (DraftAuraTriggerCommand)
 *  and once at draft-phase setup (DraftRoom.setUpState) — talents (e.g. Black Market
 *  Contact, TalentBehaviors) may then scale that hidden stat before it's read below. */
export function baseLuckyFindChance(level: number): number {
  return 0.10 + 0.02 * (level - 1);
}

/** Base (un-modified) shop reroll cost, seeded onto Player.refreshShopCost each draft
 *  aura tick and at draft setup; talents (Comrade +income, Bargain Hunter -1) then adjust it. */
export const BASE_REFRESH_SHOP_COST = 2;

/**
 * Lucky shop rolls: each shop slot has a chance — Player.luckyFindChance, seeded from
 * baseLuckyFindChance and potentially scaled by talents — to arrive at a higher rarity.
 * Every successful step re-rolls the chance, so an item can chain up to MYTHIC. Each step
 * merges a freshly rolled copy of the item template — same mechanic as the tier-5
 * instant-mythic talents.
 *
 * `source` must be the template-shaped roll for this slot (not the upgraded
 * target) so authored-stat items don't compound their already-merged stats.
 * Price grows by 50% of the slot's pre-upgrade price per step.
 *
 * Returns the number of rarity steps applied.
 */
export function applyLuckyShopUpgrades(target: Item, source: Item, player: Player): number {
  const pristine = cloneItem(source);
  const chance = player.luckyFindChance;
  const basePrice = target.price;

  let steps = 0;
  while (target.rarity < ItemRarity.MYTHIC && Math.random() < chance) {
    const rolled = cloneItem(pristine);
    rollItemStats(rolled);
    applyRarityUpgrade(target, rolled, player, false);
    steps++;
  }
  if (steps > 0) {
    target.price = Math.round(basePrice * (1 + 0.5 * steps));
    target.sellPrice = Math.floor(target.price * 0.7);
  }
  return steps;
}

/** Equipped items eligible for a rarity upgrade. Skips non-upgradeable ids,
 *  quest items (own rarity progression), synthetic itemId-0 fists (Martial
 *  Artist's martial_fist and the plain unarmed fist — never in the DB, so
 *  getItemById would return null for them) and MYTHIC items. Entries carry
 *  their slot key for the MapSchema re-set gotcha. */
export function getEquippedUpgradeableItems(player: Player): Array<{ item: Item; slot: string }> {
  const candidates: Array<{ item: Item; slot: string }> = [];

  player.equippedItems.forEach((item, slot) => {
    if (
      item.itemId > 0 &&
      !NON_UPGRADEABLE_ITEM_IDS.has(item.itemId) &&
      !item.tags?.includes('quest') &&
      !item.tags?.includes('dual_wield_copy') &&
      item.rarity < ItemRarity.MYTHIC
    ) {
      candidates.push({ item, slot });
    }
  });

  return candidates;
}

/** Sum of remaining rarity steps (to MYTHIC) across all upgrade-eligible equipped
 *  items — the ceiling on how many rarity-upgrade rolls can actually land, since
 *  each roll bumps one item by exactly one step. */
export function totalRemainingRaritySteps(player: Player): number {
  return getEquippedUpgradeableItems(player)
    .reduce((sum, { item }) => sum + (ItemRarity.MYTHIC - item.rarity), 0);
}

export function findOwnedUpgradeTarget(player: Player, itemId: number): Item | null {
  if (NON_UPGRADEABLE_ITEM_IDS.has(itemId)) {
    return null;
  }

  const candidates: Item[] = [];

  player.equippedItems.forEach((item) => {
    if (item.itemId === itemId && item.rarity < ItemRarity.MYTHIC && !item.tags?.includes('dual_wield_copy')) {
      candidates.push(item);
    }
  });

  player.inventory.forEach((item) => {
    if (item.itemId === itemId && item.rarity < ItemRarity.MYTHIC) {
      candidates.push(item);
    }
  });

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((a, b) => b.rarity - a.rarity);
  return candidates[0];
}
