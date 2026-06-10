import { Item } from '../items/schema/ItemSchema';
import { Player } from '../players/schema/PlayerSchema';
import { ItemRarity, ItemType } from '../items/types/ItemTypes';
import {
  BURN_DAMAGE_PER_STACK,
  BURN_DURATION_MS,
  chungiHpDamageFraction,
  FLOWERING_STAFF_INVULN_COOLDOWN_MS,
  floweringStaffInvulnMs,
  TWO_HANDED_WEAPON_IDS,
  wandOfFireBurnStacks,
} from '../items/behavior/uniqueItemBalance';

const itemDescriptionUpdaters: Partial<Record<number, (item: Item, player: Player) => string>> = {
  6: (item) => `Drink it to regain ${item.rarity} lives!`,
  7: (item) => `Max damage equals ${Math.round(chungiHpDamageFraction(item.rarity) * 100)}% of your max HP.`,
  8: (item) => `2-handed. Attacks shield you for ${(floweringStaffInvulnMs(item.rarity) / 1000).toFixed(1)}s (once every ${FLOWERING_STAFF_INVULN_COOLDOWN_MS / 1000}s).`,
  14: (item) => {
    const stacks = wandOfFireBurnStacks(item.rarity);
    return `Each hit applies ${stacks} burn stack${stacks > 1 ? 's' : ''} (${BURN_DAMAGE_PER_STACK} damage per stack per second, for ${BURN_DURATION_MS / 1000}s).`;
  },
  18: (item) => {
    const stacks = item.rarity;
    return `Applies ${stacks} poison stack${stacks > 1 ? 's' : ''} on hit.`;
  },
  59: (item) => `Heals for ${item.rarity * 5 + 6}% of damage dealt on hit.`,
  702: (item, player) => `Gains +${(player.level * item.rarity * 0.01 + 0.01).toFixed(2)} * level strength per attack.`,
  703: (item) => {
    const multiplier = item.rarity / 2;
    return multiplier === 1
      ? 'Max damage equals your current income.'
      : `Max damage equals ${multiplier}x your current income.`;
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

export function findOwnedUpgradeTarget(player: Player, itemId: number): Item | null {
  const candidates: Item[] = [];

  player.equippedItems.forEach((item) => {
    if (item.itemId === itemId && item.rarity < ItemRarity.MYTHIC) {
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
