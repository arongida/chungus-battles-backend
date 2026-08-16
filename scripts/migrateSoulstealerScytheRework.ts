/**
 * Migration: Soulstealer's Scythe (59) rework — heal-on-hit replaced by a two-handed,
 * unavoidable, soul-ramping reaper. See src/items/behavior/ItemBehaviors.ts (59) and
 * src/rooms/FightRoom.ts (UNAVOIDABLE_WEAPON_IDS) for the new behavior.
 *
 * New fields (matches the items collection update already applied directly):
 *   description:    "2-handed — Cannot be dodged, blocked or absorbed. Each hit reaps a soul:
 *                     +3.5 max damage for the rest of the fight."
 *   baseAttackSpeed: 0.3   (was 0.54)
 *   baseMinDamage:   30    (was 15)
 *   baseMaxDamage:   100   (was 45)
 *   strengthScaling: 3     (was unset / default 1)
 *   triggerTypes:    ['aura', 'on-attack']   (was ['on-attack'])
 *
 * Applies to all copies in players[].inventory, players[].lockedShop, and
 * players[].equippedItems. Safe to re-run.
 *
 * Run: npx tsx scripts/migrateSoulstealerScytheRework.ts
 */

import mongoose from 'mongoose';
import * as dotenv from 'dotenv';

dotenv.config();

const DB_CONNECTION_STRING = process.env.DB_CONNECTION_STRING;
if (!DB_CONNECTION_STRING) {
    console.error('DB_CONNECTION_STRING environment variable is required');
    process.exit(1);
}

const SCYTHE_ITEM_ID = 59;

const PATCH: Record<string, any> = {
    description: "2-handed — Cannot be dodged, blocked or absorbed. Each hit reaps a soul: +3.5 max damage for the rest of the fight.",
    baseAttackSpeed: 0.3,
    baseMinDamage: 30,
    baseMaxDamage: 100,
    strengthScaling: 3,
    triggerTypes: ['aura', 'on-attack'],
};

function buildPatch(prefix: string): Record<string, any> {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(PATCH)) {
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
    const itemsResult = await itemsCollection.updateOne({ itemId: SCYTHE_ITEM_ID }, { $set: PATCH });
    console.log(`items ${SCYTHE_ITEM_ID}: matched=${itemsResult.matchedCount} modified=${itemsResult.modifiedCount}`);

    // ── Players collection ────────────────────────────────────────────────────
    const playersCollection = db.collection('players');
    const players = await playersCollection.find({}).toArray();
    console.log(`\nFound ${players.length} player documents`);

    let updated = 0;
    for (const player of players) {
        const $set: Record<string, any> = {};

        if (Array.isArray(player.inventory)) {
            player.inventory.forEach((item: any, idx: number) => {
                if (item?.itemId === SCYTHE_ITEM_ID) {
                    Object.assign($set, buildPatch(`inventory.${idx}.`));
                }
            });
        }

        if (Array.isArray(player.lockedShop)) {
            player.lockedShop.forEach((item: any, idx: number) => {
                if (item?.itemId === SCYTHE_ITEM_ID) {
                    Object.assign($set, buildPatch(`lockedShop.${idx}.`));
                }
            });
        }

        if (player.equippedItems) {
            const entries = player.equippedItems instanceof Map
                ? Array.from(player.equippedItems.entries())
                : Object.entries(player.equippedItems);
            for (const [slot, item] of entries as [string, any][]) {
                if (item && item.itemId === SCYTHE_ITEM_ID) {
                    Object.assign($set, buildPatch(`equippedItems.${slot}.`));
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
