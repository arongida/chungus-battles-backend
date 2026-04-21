/**
 * Sync weapon baseMinDamage / baseMaxDamage / baseAttackSpeed from prod → dev.
 *
 * Prod still uses the old format: affectedStats.accuracy = min damage, affectedStats.strength = max damage.
 * Dev items were corrupted (baseMinDamage/baseMaxDamage all zeros).
 * This script reads accuracy/strength from prod and sets them as baseMinDamage/baseMaxDamage in dev by itemId.
 *
 * Also fixes weapon entries embedded in player inventory and equippedItems.
 *
 * Run:
 *   npx tsx scripts/syncWeaponDamageFromProd.ts
 */

import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import * as path from 'path';

const root = path.resolve(__dirname, '..');
const prodEnv = dotenv.config({ path: path.join(root, '.env.production') }).parsed;
const devEnv  = dotenv.config({ path: path.join(root, '.env.development'), override: true }).parsed;

const PROD = prodEnv?.DB_CONNECTION_STRING;
const DEV  = devEnv?.DB_CONNECTION_STRING;

if (!PROD) { console.error('DB_CONNECTION_STRING not found in .env.production'); process.exit(1); }
if (!DEV)  { console.error('DB_CONNECTION_STRING not found in .env.development'); process.exit(1); }

async function main() {
    const prodConn = await mongoose.createConnection(PROD as string).asPromise();
    console.log('Connected to prod');
    const devConn  = await mongoose.createConnection(DEV  as string).asPromise();
    console.log('Connected to dev');

    const prodItems = prodConn.db!.collection('items');
    const devItems  = devConn.db!.collection('items');
    const devPlayers = devConn.db!.collection('players');

    // ── Build lookup map from prod ───────────────────────────────────────────
    const prodWeapons = await prodItems.find({ type: 'weapon' }).toArray();
    console.log(`Found ${prodWeapons.length} weapon(s) in prod`);

    const lookup = new Map<number, { baseMinDamage: number; baseMaxDamage: number }>();
    for (const w of prodWeapons) {
        lookup.set(w.itemId, {
            baseMinDamage: w.affectedStats?.accuracy ?? 0,
            baseMaxDamage: w.affectedStats?.strength ?? 0,
        });
    }

    // ── Update items collection ──────────────────────────────────────────────
    let itemsUpdated = 0;
    for (const [itemId, vals] of lookup) {
        const result = await devItems.updateOne({ itemId }, { $set: vals });
        if (result.matchedCount > 0) {
            console.log(`  item ${itemId}: baseMinDamage=${vals.baseMinDamage} baseMaxDamage=${vals.baseMaxDamage}`);
            itemsUpdated++;
        } else {
            console.warn(`  item ${itemId}: not found in dev items`);
        }
    }
    console.log(`Updated ${itemsUpdated} item(s) in dev\n`);

    // ── Update player documents ──────────────────────────────────────────────
    const players = await devPlayers.find({}).toArray();
    console.log(`Found ${players.length} player document(s) in dev`);

    let playersUpdated = 0;
    for (const player of players) {
        const $set: Record<string, any> = {};

        if (Array.isArray(player.inventory)) {
            player.inventory.forEach((item: any, idx: number) => {
                if (item?.type === 'weapon' && lookup.has(item.itemId)) {
                    const vals = lookup.get(item.itemId)!;
                    $set[`inventory.${idx}.baseMinDamage`] = vals.baseMinDamage;
                    $set[`inventory.${idx}.baseMaxDamage`] = vals.baseMaxDamage;
                }
            });
        }

        if (player.equippedItems) {
            const entries = player.equippedItems instanceof Map
                ? Array.from(player.equippedItems.entries())
                : Object.entries(player.equippedItems);
            for (const [slot, item] of entries as [string, any][]) {
                if (item?.type === 'weapon' && lookup.has(item.itemId)) {
                    const vals = lookup.get(item.itemId)!;
                    $set[`equippedItems.${slot}.baseMinDamage`] = vals.baseMinDamage;
                    $set[`equippedItems.${slot}.baseMaxDamage`] = vals.baseMaxDamage;
                }
            }
        }

        if (Object.keys($set).length > 0) {
            await devPlayers.updateOne({ _id: player._id }, { $set });
            playersUpdated++;
        }
    }
    console.log(`Updated weapon fields in ${playersUpdated} player document(s)`);

    await prodConn.close();
    await devConn.close();
    console.log('Done');
}

main().catch(err => { console.error('Failed:', err); process.exit(1); });
