/**
 * Migration: Set item descriptions.
 *
 * - Items with no trigger types → description cleared to ''.
 * - Items with trigger types    → concise effect description set.
 *
 * Safe to re-run.
 *
 * Run: npx tsx scripts/migrateItemDescriptions.ts
 */

import mongoose from 'mongoose';
import * as dotenv from 'dotenv';

dotenv.config();

const DB_CONNECTION_STRING = process.env.DB_CONNECTION_STRING;
if (!DB_CONNECTION_STRING) {
    console.error('DB_CONNECTION_STRING environment variable is required');
    process.exit(1);
}

const DESCRIPTIONS: Record<number, string> = {
    18:  'Applies 1 poison stack on hit.',
    28:  '+3% attack speed per rogue item at fight start.',
    29:  'Each hit slows enemy attack speed by 2%, down to 50%.',
    59:  'Heals for 15% of damage dealt + 1 on hit.',
    701: '+0.5 strength per hit, resets after fight.',
    702: '+0.01 strength on each attack.',
    703: 'Max damage equals your current income.',
};

const TRIGGER_ITEM_IDS = Object.keys(DESCRIPTIONS).map(Number);

async function main() {
    const conn = await mongoose.connect(DB_CONNECTION_STRING as string);
    console.log('Connected to MongoDB');
    const db = conn.connection.db!;

    const itemsCollection = db.collection('items');

    // Clear descriptions for items without trigger types
    const clearResult = await itemsCollection.updateMany(
        { itemId: { $nin: TRIGGER_ITEM_IDS } },
        { $set: { description: '' } }
    );
    console.log(`Cleared descriptions: matched=${clearResult.matchedCount} modified=${clearResult.modifiedCount}`);

    // Set concise descriptions for trigger-type items
    for (const [idStr, desc] of Object.entries(DESCRIPTIONS)) {
        const id = Number(idStr);
        const result = await itemsCollection.updateOne(
            { itemId: id },
            { $set: { description: desc } }
        );
        console.log(`item ${id}: matched=${result.matchedCount} modified=${result.modifiedCount} → "${desc}"`);
    }

    // Update player documents (inventory + equippedItems)
    const playersCollection = db.collection('players');
    const players = await playersCollection.find({}).toArray();
    console.log(`\nFound ${players.length} player documents`);

    let updated = 0;
    for (const player of players) {
        const $set: Record<string, any> = {};

        if (Array.isArray(player.inventory)) {
            player.inventory.forEach((item: any, idx: number) => {
                if (!item) return;
                const desc = DESCRIPTIONS[item.itemId] ?? '';
                if (item.description !== desc) {
                    $set[`inventory.${idx}.description`] = desc;
                }
            });
        }

        if (player.equippedItems) {
            const entries = player.equippedItems instanceof Map
                ? Array.from(player.equippedItems.entries())
                : Object.entries(player.equippedItems);
            for (const [slot, item] of entries as [string, any][]) {
                if (!item) continue;
                const desc = DESCRIPTIONS[item.itemId] ?? '';
                if (item.description !== desc) {
                    $set[`equippedItems.${slot}.description`] = desc;
                }
            }
        }

        if (Object.keys($set).length > 0) {
            await playersCollection.updateOne({ _id: player._id }, { $set });
            updated++;
        }
    }
    console.log(`Updated ${updated} player documents`);

    await mongoose.disconnect();
    console.log('Migration complete');
}

main().catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
});
