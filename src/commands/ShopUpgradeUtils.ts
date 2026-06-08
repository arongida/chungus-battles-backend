import { Item } from '../items/schema/ItemSchema';
import { Player } from '../players/schema/PlayerSchema';
import { ItemRarity, ItemType } from '../items/types/ItemTypes';

const itemDescriptionUpdaters: Partial<Record<number, (item: Item, player: Player) => string>> = {
  6: (item) => `Drink it to regain ${item.rarity} lives!`,
  18: (item) => {
    const stacks = item.rarity;
    return `Applies ${stacks} poison stack${stacks > 1 ? 's' : ''} on hit.`;
  },
  29: (item) => `Each hit slows enemy attack speed by ${item.rarity}%, down to 50%.`,
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
  if (target.type === ItemType.WEAPON) {
    target.baseMinDamage   += source.baseMinDamage   * 0.5;
    target.baseMaxDamage   += source.baseMaxDamage   * 0.5;
    target.baseAttackSpeed += source.baseAttackSpeed * 0.5;
  }
}

export function findOwnedUpgradeTarget(player: Player, itemId: number): Item | null {
  const candidates: Item[] = [];

  player.equippedItems.forEach((item) => {
    if (item.itemId === itemId && item.rarity < ItemRarity.LEGENDARY) {
      candidates.push(item);
    }
  });

  player.inventory.forEach((item) => {
    if (item.itemId === itemId && item.rarity < ItemRarity.LEGENDARY) {
      candidates.push(item);
    }
  });

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((a, b) => b.rarity - a.rarity);
  return candidates[0];
}
