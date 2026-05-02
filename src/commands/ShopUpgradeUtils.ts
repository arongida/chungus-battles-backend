import { Item } from '../items/schema/ItemSchema';
import { Player } from '../players/schema/PlayerSchema';
import { ItemRarity, ItemSet, ItemType } from '../items/types/ItemTypes';

const itemDescriptionUpdaters: Partial<Record<number, (item: Item) => string>> = {
  18: (item) => {
    const stacks = item.rarity - 1;
    return `Applies ${stacks} poison stack${stacks > 1 ? 's' : ''} on hit.`;
  },
  29: (item) => `Each hit slows enemy attack speed by ${item.rarity}%, down to 50%.`,
  59: (item) => `Heals for ${item.rarity * 5 + 6}% of damage dealt on hit.`,
  702: (item) => `Gains +${(item.rarity * 0.01 + 0.01).toFixed(2)} strength per attack.`,
  703: (item) => {
    const multiplier = item.rarity / 2;
    return multiplier === 1
      ? 'Max damage equals your current income.'
      : `Max damage equals ${multiplier}x your current income.`;
  },
};

function updateRarityDescription(target: Item): void {
  if (target.rarity <= 1) return;
  if (target.type === ItemType.SHIELD) {
    target.description = `Reflect ${0.5 * target.rarity * target.tier} damage on attacked.`;
    return;
  }
  const updater = itemDescriptionUpdaters[target.itemId];
  if (updater) target.description = updater(target);
}

export function applyRarityUpgrade(target: Item, source: Item, increaseSellPrice = true): void {
  target.rarity++;
  if (increaseSellPrice) target.sellPrice += source.sellPrice;
  updateRarityDescription(target);
  target.setBonusStats.mergeInto(source.setBonusStats);

  switch (target.set) {
    case ItemSet.ROGUE:
      target.affectedStats.mergeInto(source.affectedStats);
      target.baseAttackSpeed += source.baseAttackSpeed;
      break;
    case ItemSet.WARRIOR:
      target.affectedStats.mergeInto(source.affectedStats);
      target.baseMinDamage += source.baseMinDamage;
      target.baseMaxDamage += source.baseMaxDamage;
      break;
    case ItemSet.MERCHANT:
      target.affectedStats.mergeInto(source.affectedStats);
      if (target.type === ItemType.WEAPON) target.affectedStats.mergeInto(source.affectedStats);
      break;
    default:
      target.affectedStats.mergeInto(source.affectedStats);
      target.baseMinDamage += source.baseMinDamage;
      target.baseMaxDamage += source.baseMaxDamage;
      target.baseAttackSpeed += source.baseAttackSpeed;
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
