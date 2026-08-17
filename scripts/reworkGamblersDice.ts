// Season 24: Gambler's Dice (703) now pays out on FIGHT_END (ItemBehaviors.ts) — main hand gains
// permanent income on a win, off hand refunds gold on a loss. Every item construction path
// (getNumberOfItems/getQuestItems/getAllItems and embedded copies loaded via players/db/Player.ts)
// already runs migrateLegacyItem (common/reworkMigrations.ts), which self-adds the fight-end
// trigger on load — so this script is cosmetic hygiene on the canonical `items` collection doc,
// not load-bearing. Kept anyway so a fresh DB export/import carries the correct triggerTypes and
// description without depending on the migration having ever run.
//
// Run with: npx tsx scripts/reworkGamblersDice.ts
import mongoose from 'mongoose';
import { itemModel } from '../src/items/db/Item';
import { diceDescription } from '../src/items/behavior/uniqueItemBalance';

async function main() {
    const connectionString = process.env.DB_CONNECTION_STRING;
    if (!connectionString) {
        console.error('DB_CONNECTION_STRING env var is required');
        process.exit(1);
    }

    await mongoose.connect(connectionString);
    console.log('Connected to MongoDB');

    const result = await itemModel.updateOne(
        { itemId: 703 },
        {
            $set: {
                description: diceDescription(1),
                triggerTypes: ['level-up', 'fight-end'],
            },
        }
    );
    console.log(`itemId 703: matched ${result.matchedCount}, modified ${result.modifiedCount}`);

    await mongoose.disconnect();
    console.log('Done');
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
