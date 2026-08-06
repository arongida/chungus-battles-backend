/**
 * Migration: Slightly increase item prices (~20%) across all tiers, keeping the existing
 * tier-band structure intact.
 *
 * Tier  old -> new
 *  1     3  ->  4   (basic gear)
 *  1     4  ->  5   (basic weapons)
 *  1    10  -> 12   (Health Flask)
 *  2     5  ->  6
 *  2     7  ->  8
 *  3     8  -> 10
 *  3    11  -> 13
 *  4    12  -> 14
 *  4    14  -> 17   (Band of Vigor)
 *  4    16  -> 19
 *  5    17  -> 20
 *  5    23  -> 28
 *
 * Keyed by itemId (not by old price) so the script is idempotent and safe to re-run — an
 * old-price->new-price map isn't idempotent here since several old values (4, 5, 8, 12, 14, 17)
 * also appear as *new* values in other bands, which would cascade on a second run.
 *
 * Also recomputes the two items that author `sellPrice` explicitly instead of deriving it in
 * code (see items/db/Item.ts's `sellPrice = Math.floor(price * 0.7)` fallback):
 *   - Health Flask (6): 12 * 0.7 -> 8
 *   - Ring of Immortality (47): 19 * 0.7 -> 13
 *
 * Scope: the `items` collection only. Does NOT touch players[].inventory / players[].equippedItems
 * — already-owned items keep the price they were bought at.
 *
 * Applies to the items collection only. Safe to re-run.
 *
 * Run: npx tsx scripts/increaseItemPrices.ts
 */

import mongoose from 'mongoose';
import * as dotenv from 'dotenv';

dotenv.config();

const DB_CONNECTION_STRING = process.env.DB_CONNECTION_STRING;
if (!DB_CONNECTION_STRING) {
    console.error('DB_CONNECTION_STRING environment variable is required');
    process.exit(1);
}

const NEW_PRICE_BY_ITEM_ID: Record<number, number> = {
    // Tier 1
    1: 5, 2: 5, 3: 4, 6: 12, 11: 4, 14: 5, 63: 4, 68: 5, 73: 4, 76: 4, 1000: 4, 1001: 4,
    // Tier 2
    4: 8, 5: 8, 12: 6, 23: 6, 64: 6, 69: 8, 74: 6, 77: 6, 1002: 6, 1003: 6,
    // Tier 3
    7: 13, 8: 13, 16: 13, 18: 13, 19: 13, 24: 10, 31: 10, 65: 10, 70: 13, 75: 10, 78: 10, 1004: 10, 1005: 10,
    // Tier 4
    20: 14, 22: 19, 27: 17, 28: 19, 34: 14, 47: 19, 62: 14, 66: 14, 71: 19, 79: 14, 1010: 14, 1011: 14,
    // Tier 5
    26: 28, 29: 28, 33: 20, 40: 20, 53: 20, 59: 28, 67: 20, 72: 28, 80: 20, 1200: 20, 1201: 20,
};

// Authored sellPrice overrides — everything else derives sellPrice from price in code.
const NEW_SELL_PRICE_BY_ITEM_ID: Record<number, number> = {
    6: 8,   // Health Flask
    47: 13, // Ring of Immortality
};

async function main() {
    await mongoose.connect(DB_CONNECTION_STRING!);
    const db = mongoose.connection.db;
    const items = db.collection('items');

    const before = await items
        .find({ itemId: { $in: Object.keys(NEW_PRICE_BY_ITEM_ID).map(Number) } })
        .project({ _id: 0, itemId: 1, name: 1, tier: 1, price: 1, sellPrice: 1 })
        .toArray();
    const beforeByItemId = new Map(before.map((doc) => [doc.itemId, doc]));

    let updated = 0;
    for (const [itemIdStr, newPrice] of Object.entries(NEW_PRICE_BY_ITEM_ID)) {
        const itemId = Number(itemIdStr);
        const update: Record<number, unknown> = { price: newPrice };
        if (itemId in NEW_SELL_PRICE_BY_ITEM_ID) {
            update.sellPrice = NEW_SELL_PRICE_BY_ITEM_ID[itemId];
        }
        const res = await items.updateOne({ itemId }, { $set: update });
        if (res.matchedCount === 0) {
            console.warn(`No item found for itemId ${itemId} — skipped`);
            continue;
        }
        const prev = beforeByItemId.get(itemId);
        console.log(
            `#${itemId} ${prev?.name ?? '?'} (tier ${prev?.tier ?? '?'}): price ${prev?.price ?? '?'} -> ${newPrice}` +
            (itemId in NEW_SELL_PRICE_BY_ITEM_ID ? `, sellPrice ${prev?.sellPrice ?? '(derived)'} -> ${NEW_SELL_PRICE_BY_ITEM_ID[itemId]}` : '')
        );
        updated++;
    }

    console.log(`\nUpdated ${updated}/${Object.keys(NEW_PRICE_BY_ITEM_ID).length} items.`);
    await mongoose.disconnect();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
