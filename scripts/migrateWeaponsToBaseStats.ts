/**
 * Migration: Weapon affectedStats → baseMinDamage/baseMaxDamage/baseAttackSpeed
 *
 * For all items with type === 'weapon':
 *   - baseMinDamage = affectedStats.accuracy
 *   - baseMaxDamage = affectedStats.strength
 *   - baseAttackSpeed = 0.8 (default; adjust per weapon after migration)
 *   - affectedStats.strength = 0
 *   - affectedStats.accuracy = 0
 *
 * For all player documents:
 *   - baseStats.attackSpeed = 1 (neutral multiplier)
 *   - For each weapon in inventory/equippedItems: same migration as above
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

function migrateWeaponDoc(item: any) {
    if (item?.type === 'weapon') {
        item.baseMinDamage = item.affectedStats?.accuracy ?? 0;
        item.baseMaxDamage = item.affectedStats?.strength ?? 0;
        item.baseAttackSpeed = 0.8;
        if (item.affectedStats) {
            item.affectedStats.strength = 0;
            item.affectedStats.accuracy = 0;
        }
    }
    return item;
}

async function main() {
    await mongoose.connect(DB_CONNECTION_STRING);
    console.log('Connected to MongoDB');

    const db = mongoose.connection.db;

    // Migrate Item collection
    const itemsCollection = db.collection('items');
    const weapons = await itemsCollection.find({ type: 'weapon' }).toArray();
    console.log(`Found ${weapons.length} weapon items to migrate`);

    for (const weapon of weapons) {
        const baseMinDamage = weapon.affectedStats?.accuracy ?? 0;
        const baseMaxDamage = weapon.affectedStats?.strength ?? 0;
        await itemsCollection.updateOne(
            { _id: weapon._id },
            {
                $set: {
                    baseMinDamage,
                    baseMaxDamage,
                    baseAttackSpeed: 0.8,
                    'affectedStats.strength': 0,
                    'affectedStats.accuracy': 0,
                },
            }
        );
    }
    console.log(`Migrated ${weapons.length} weapon items`);

    // Migrate Player collection
    const playersCollection = db.collection('players');
    const players = await playersCollection.find({}).toArray();
    console.log(`Found ${players.length} player documents to migrate`);

    let playersMigrated = 0;
    for (const player of players) {
        const updateOps: any = {
            $set: { 'baseStats.attackSpeed': 1 }
        };

        // Migrate inventory weapons
        if (Array.isArray(player.inventory)) {
            player.inventory.forEach((item: any, idx: number) => {
                if (item?.type === 'weapon') {
                    updateOps.$set[`inventory.${idx}.baseMinDamage`] = item.affectedStats?.accuracy ?? 0;
                    updateOps.$set[`inventory.${idx}.baseMaxDamage`] = item.affectedStats?.strength ?? 0;
                    updateOps.$set[`inventory.${idx}.baseAttackSpeed`] = 0.8;
                    updateOps.$set[`inventory.${idx}.affectedStats.strength`] = 0;
                    updateOps.$set[`inventory.${idx}.affectedStats.accuracy`] = 0;
                }
            });
        }

        // Migrate equippedItems weapons (stored as map)
        if (player.equippedItems) {
            const entries = player.equippedItems instanceof Map
                ? Array.from(player.equippedItems.entries())
                : Object.entries(player.equippedItems);
            for (const [slot, item] of entries as [string, any][]) {
                if (item?.type === 'weapon') {
                    updateOps.$set[`equippedItems.${slot}.baseMinDamage`] = item.affectedStats?.accuracy ?? 0;
                    updateOps.$set[`equippedItems.${slot}.baseMaxDamage`] = item.affectedStats?.strength ?? 0;
                    updateOps.$set[`equippedItems.${slot}.baseAttackSpeed`] = 0.8;
                    updateOps.$set[`equippedItems.${slot}.affectedStats.strength`] = 0;
                    updateOps.$set[`equippedItems.${slot}.affectedStats.accuracy`] = 0;
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
