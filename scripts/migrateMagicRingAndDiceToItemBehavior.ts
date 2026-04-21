/**
 * Migration: Move Magic Ring (702) and Gambler's Dice (703) to item-behavior system.
 *
 * Magic Ring (702):
 *   - triggerTypes: ["on-attack"]  (item behavior handles +0.01 strength self-buff)
 *   - baseMinDamage: 0, baseMaxDamage: 0  (damage scales purely from player accuracy/strength)
 *   - baseAttackSpeed: 1.0           (swings once per second, same cadence as old AURA tick)
 *   - affectedStats.strength: 0, affectedStats.accuracy: 0, affectedStats.attackSpeed: 1
 *
 * Gambler's Dice (703):
 *   - triggerTypes: ["aura"]         (item behavior fires income-based damage on aura tick)
 *   - baseAttackSpeed: 0             (no auto-swing — damage handled by item behavior only)
 *
 * Applies to the items collection and all copies in players[].inventory / players[].equippedItems.
 * Safe to re-run.
 *
 * Run: npx tsx scripts/migrateMagicRingAndDiceToItemBehavior.ts
 */

import mongoose from 'mongoose';
import * as dotenv from 'dotenv';

dotenv.config();

const DB_CONNECTION_STRING = process.env.DB_CONNECTION_STRING;
if (!DB_CONNECTION_STRING) {
    console.error('DB_CONNECTION_STRING environment variable is required');
    process.exit(1);
}

const RING_ID = 702;
const DICE_ID = 703;

const ringFields = {
    triggerTypes: ['on-attack'],
    baseMinDamage: 0,
    baseMaxDamage: 0,
    baseAttackSpeed: 1.0,
    'affectedStats.strength': 0,
    'affectedStats.accuracy': 0,
    'affectedStats.attackSpeed': 1,
};

const diceFields = {
    triggerTypes: ['aura'],
    baseAttackSpeed: 0,
};

function itemPatch(itemId: number, prefix: string): Record<string, any> {
    const fields = itemId === RING_ID ? ringFields : diceFields;
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(fields)) {
        out[`${prefix}${k}`] = v;
    }
    return out;
}

async function main() {
    const conn = await mongoose.connect(DB_CONNECTION_STRING as string);
    console.log('Connected to MongoDB');
    const db = conn.connection.db!;

    // ── Items collection ──────────────────────────────────────────────────────
    const itemsCollection = db.collection('items');
    for (const id of [RING_ID, DICE_ID]) {
        const result = await itemsCollection.updateOne({ itemId: id }, { $set: itemPatch(id, '') });
        console.log(`items ${id}: matched=${result.matchedCount} modified=${result.modifiedCount}`);
    }

    // ── Players collection ────────────────────────────────────────────────────
    const playersCollection = db.collection('players');
    const players = await playersCollection.find({}).toArray();
    console.log(`\nFound ${players.length} player documents`);

    let updated = 0;
    for (const player of players) {
        const $set: Record<string, any> = {};

        if (Array.isArray(player.inventory)) {
            player.inventory.forEach((item: any, idx: number) => {
                if (item?.itemId === RING_ID || item?.itemId === DICE_ID) {
                    Object.assign($set, itemPatch(item.itemId, `inventory.${idx}.`));
                }
            });
        }

        if (player.equippedItems) {
            const entries = player.equippedItems instanceof Map
                ? Array.from(player.equippedItems.entries())
                : Object.entries(player.equippedItems);
            for (const [slot, item] of entries as [string, any][]) {
                if (item?.itemId === RING_ID || item?.itemId === DICE_ID) {
                    Object.assign($set, itemPatch(item.itemId, `equippedItems.${slot}.`));
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
