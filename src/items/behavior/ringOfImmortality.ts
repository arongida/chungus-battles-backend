import { Player } from '../../players/schema/PlayerSchema';
import { Item } from '../schema/ItemSchema';
import { ItemRarity } from '../types/ItemTypes';
import { getRandomItemsByTier } from '../db/Item';
import { applyExtraRaritySteps } from '../../commands/ShopUpgradeUtils';
import { clampTier } from '../stats/itemStatPool';

/**
 * Rolls a random item at the player's own tier and upgrades it up to Legendary by merging
 * freshly rolled copies onto it — same mechanic as the lucky-find shop upgrades
 * (see applyLuckyShopUpgrades in ShopUpgradeUtils.ts).
 */
export async function rollRandomLegendaryItemAtLevel(player: Player): Promise<Item | null> {
    const [newItem] = await getRandomItemsByTier(clampTier(player.level), 1);
    if (!newItem) return null;

    applyExtraRaritySteps(newItem, newItem, player, ItemRarity.LEGENDARY - newItem.rarity);

    newItem.sold = true;
    return newItem;
}
