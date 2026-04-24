import { Item } from '../items/schema/ItemSchema';
import { Player } from '../players/schema/PlayerSchema';
import { EquipSlot, ItemRarity, ItemSet } from '../items/types/ItemTypes';

export function applyRarityUpgrade(target: Item, source: Item): void {
  target.rarity++;
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
      if (target.type === 'weapon') target.affectedStats.mergeInto(source.affectedStats);
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
