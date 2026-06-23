import { Player } from '../../players/schema/PlayerSchema';
import { Item } from '../schema/ItemSchema';
import { ItemRarity } from '../types/ItemTypes';
import { cloneItem, getRandomItemsByTier } from '../db/Item';
import { rollItemStats } from '../stats/itemStatRoller';
import { applyRarityUpgrade } from '../../commands/ShopUpgradeUtils';

/**
 * Rolls a random tier-5 item and upgrades it Common -> Mythic by merging 4 freshly
 * rolled copies onto it — the same mechanic used by the lucky-find shop upgrades
 * (see applyLuckyShopUpgrades in ShopUpgradeUtils.ts).
 */
export async function rollRandomMythicTierFiveItem(player: Player): Promise<Item | null> {
    const [newItem] = await getRandomItemsByTier(5, 1);
    if (!newItem) return null;

    const pristine = cloneItem(newItem);
    while (newItem.rarity < ItemRarity.MYTHIC) {
        const rolled = cloneItem(pristine);
        rollItemStats(rolled);
        applyRarityUpgrade(newItem, rolled, player, false);
    }

    newItem.sold = true;
    newItem.sellPrice = Math.floor(newItem.price * 0.7);
    return newItem;
}
