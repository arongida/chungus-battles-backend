// Season 24: Martial Artist (37) now also grants one free weapon the moment the talent is
// picked, not just on level-up (TalentBehaviors.ts's AURA branch). The on-pick grant is latched
// via talent.tags at runtime — an already-owned copy earns it retroactively on its next AURA
// tick with no data migration needed. This script only refreshes the canonical `talents`
// collection description that fresh offers read from (embedded copies self-refresh their
// description via the MARTIAL_ARTIST branch in common/reworkMigrations.ts).
//
// Run with: npx tsx scripts/reworkMartialArtist.ts
import mongoose from 'mongoose';
import { talentModel } from '../src/talents/db/Talent';

async function main() {
    const connectionString = process.env.DB_CONNECTION_STRING;
    if (!connectionString) {
        console.error('DB_CONNECTION_STRING env var is required');
        process.exit(1);
    }

    await mongoose.connect(connectionString);
    console.log('Connected to MongoDB');

    const result = await talentModel.updateOne(
        { talentId: 37 },
        { $set: { description: 'Weapons can now be equipped in any slot. You find a free weapon the moment you take this, and again every time you level up.' } }
    );
    console.log(`talentId 37: matched ${result.matchedCount}, modified ${result.modifiedCount}`);

    await mongoose.disconnect();
    console.log('Done');
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
