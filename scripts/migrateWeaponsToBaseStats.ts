/**
 * Migration: Weapon affectedStats → baseMinDamage/baseMaxDamage/baseAttackSpeed
 *
 * For all items with type === 'weapon':
 *   - baseMinDamage  = affectedStats.accuracy
 *   - baseMaxDamage  = affectedStats.strength
 *   - baseAttackSpeed = 0.8 * affectedStats.attackSpeed
 *       (0 or 1 treated as neutral → 0.8; 1.5 → 1.2; 0.5 → 0.4)
 *   - affectedStats.strength  = 0  (moved to baseMaxDamage)
 *   - affectedStats.accuracy  = 0  (moved to baseMinDamage)
 *   - affectedStats.attackSpeed = 1 (neutral; baked into baseAttackSpeed)
 *
 * For all player documents:
 *   - baseStats.attackSpeed = 1 (neutral multiplier)
 *   - For each weapon in inventory/equippedItems: same migration as above
 *
 * Safe to re-run: if affectedStats.attackSpeed is already 1 (neutral) from a
 * previous partial run, baseAttackSpeed = 0.8 * 1 = 0.8 which is correct.
 *
 * Run: npx tsx scripts/migrateWeaponsToBaseStats.ts
 */

import mongoose from 'mongoose';
import * as dotenv from 'dotenv';

dotenv.config();

const DB_CONNECTION_STRING = process.env.DB_CONNECTION_STRING;
if (!DB_CONNECTION_STRING) {
    console.error('DB_CONNECTION_STRING environment variable is required');
    process.exit(1);
}

/** Convert old affectedStats.attackSpeed to a weapon baseAttackSpeed. */
function computeBaseAttackSpeed(affectedStats: any): number {
    const raw = affectedStats?.attackSpeed;
    // 0 meant "not set" in the old system (same effect as neutral 1.0)
    const multiplier = (!raw || raw === 1) ? 1 : raw;
    return parseFloat((0.8 * multiplier).toFixed(3));
}

function weaponFieldUpdates(item: any, prefix: string): Record<string, any> {
    const set: Record<string, any> = {};
    set[`${prefix}baseMinDamage`]              = item.affectedStats?.accuracy ?? 0;
    set[`${prefix}baseMaxDamage`]              = item.affectedStats?.strength ?? 0;
    set[`${prefix}baseAttackSpeed`]            = computeBaseAttackSpeed(item.affectedStats);
    set[`${prefix}affectedStats.strength`]     = 0;
    set[`${prefix}affectedStats.accuracy`]     = 0;
    set[`${prefix}affectedStats.attackSpeed`]  = 1; // neutral — no longer applied as player multiplier
    return set;
}

async function main() {
    const conn = await mongoose.connect(DB_CONNECTION_STRING as string);
    console.log('Connected to MongoDB');

    const db = conn.connection.db!;

    // ── Item collection ──────────────────────────────────────────────────────
    const itemsCollection = db.collection('items');
    const weapons = await itemsCollection.find({ type: 'weapon' }).toArray();
    console.log(`Found ${weapons.length} weapon items to migrate`);

    for (const weapon of weapons) {
        const baseAttackSpeed = computeBaseAttackSpeed(weapon.affectedStats);
        console.log(
            `  ${weapon.name}: attackSpeed ${weapon.affectedStats?.attackSpeed ?? 'none'} → baseAttackSpeed ${baseAttackSpeed}`
        );
        await itemsCollection.updateOne(
            { _id: weapon._id },
            { $set: weaponFieldUpdates(weapon, '') }
        );
    }
    console.log(`Migrated ${weapons.length} weapon items\n`);

    // ── Player collection ────────────────────────────────────────────────────
    const playersCollection = db.collection('players');
    const players = await playersCollection.find({}).toArray();
    console.log(`Found ${players.length} player documents to migrate`);

    let playersMigrated = 0;
    for (const player of players) {
        const updateOps: any = {
            $set: { 'baseStats.attackSpeed': 1 }
        };

        // Inventory weapons
        if (Array.isArray(player.inventory)) {
            player.inventory.forEach((item: any, idx: number) => {
                if (item?.type === 'weapon') {
                    Object.assign(
                        updateOps.$set,
                        weaponFieldUpdates(item, `inventory.${idx}.`)
                    );
                }
            });
        }

        // EquippedItems weapons (stored as a map)
        if (player.equippedItems) {
            const entries = player.equippedItems instanceof Map
                ? Array.from(player.equippedItems.entries())
                : Object.entries(player.equippedItems);
            for (const [slot, item] of entries as [string, any][]) {
                if (item?.type === 'weapon') {
                    Object.assign(
                        updateOps.$set,
                        weaponFieldUpdates(item, `equippedItems.${slot}.`)
                    );
                }
            }
        }

        await playersCollection.updateOne({ _id: player._id }, updateOps);
        playersMigrated++;
    }
    console.log(`Migrated ${playersMigrated} player documents`);

    await mongoose.disconnect();
    console.log('Migration complete');
}

main().catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
});
