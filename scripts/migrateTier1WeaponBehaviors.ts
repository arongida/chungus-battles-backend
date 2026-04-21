/**
 * Migration: Add item behaviors to Tier 1 weapons.
 *
 * Dagger of Poison (18):   triggerTypes: ['on-attack']
 * Frozen Blade (29):       triggerTypes: ['on-attack', 'fight-end'], affectedEnemyStats.attackSpeed = 1
 * Soulstealer's Scythe (59): triggerTypes: ['on-attack']
 * Swiftsteel Dagger (28):  triggerTypes: ['fight-start', 'fight-end']
 * Hunter's Bow (701):      triggerTypes: ['on-attack', 'fight-end']
 *
 * Applies to the items collection and all copies in players[].inventory / players[].equippedItems.
 * Safe to re-run.
 *
 * Run: npx tsx scripts/migrateTier1WeaponBehaviors.ts
 */

import mongoose from 'mongoose';
import * as dotenv from 'dotenv';

dotenv.config();

const DB_CONNECTION_STRING = process.env.DB_CONNECTION_STRING;
if (!DB_CONNECTION_STRING) {
    console.error('DB_CONNECTION_STRING environment variable is required');
    process.exit(1);
}

const WEAPON_PATCHES: Record<number, Record<string, any>> = {
    18: {
        triggerTypes: ['on-attack'],
    },
    28: {
        triggerTypes: ['fight-start', 'fight-end'],
    },
    29: {
        triggerTypes: ['on-attack', 'fight-end'],
        'affectedEnemyStats.attackSpeed': 1,
    },
    59: {
        triggerTypes: ['on-attack'],
    },
    701: {
        triggerTypes: ['on-attack', 'fight-end'],
    },
};

const WEAPON_IDS = Object.keys(WEAPON_PATCHES).map(Number);

function buildPatch(itemId: number, prefix: string): Record<string, any> {
    const fields = WEAPON_PATCHES[itemId];
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
    for (const id of WEAPON_IDS) {
        const result = await itemsCollection.updateOne({ itemId: id }, { $set: buildPatch(id, '') });
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
                if (WEAPON_IDS.includes(item?.itemId)) {
                    Object.assign($set, buildPatch(item.itemId, `inventory.${idx}.`));
                }
            });
        }

        if (player.equippedItems) {
            const entries = player.equippedItems instanceof Map
                ? Array.from(player.equippedItems.entries())
                : Object.entries(player.equippedItems);
            for (const [slot, item] of entries as [string, any][]) {
                if (item && WEAPON_IDS.includes(item.itemId)) {
                    Object.assign($set, buildPatch(item.itemId, `equippedItems.${slot}.`));
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
