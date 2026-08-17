// Season 24: Joker (41) reworked from an unconditional single-stat drip on every FIGHT_END into
// a two-card pick-every-fight / suspend-until-picked mechanic — see
// src/talents/behavior/jokerState.ts and the JOKER branch in TalentBehaviors.ts. The new behavior
// needs the AURA trigger added (rebuilds affectedStats from the persisted running total every
// tick, and suspends it to 0 for as long as a card sits unpicked) — fresh offers read triggerTypes straight from this canonical
// `talents` collection doc (getRandomTalents / getTalentSchemaObject, unlike embedded copies,
// does NOT run through common/reworkMigrations.ts), so this update is load-bearing, not just
// cosmetic. Already-owned copies self-migrate the AURA trigger on next load via the JOKER branch
// in common/reworkMigrations.ts.
//
// Run with: npx tsx scripts/reworkJoker.ts
import mongoose from 'mongoose';
import { talentModel } from '../src/talents/db/Talent';
import { JOKER_BASE_DESCRIPTION } from '../src/talents/behavior/jokerState';

async function main() {
    const connectionString = process.env.DB_CONNECTION_STRING;
    if (!connectionString) {
        console.error('DB_CONNECTION_STRING env var is required');
        process.exit(1);
    }

    await mongoose.connect(connectionString);
    console.log('Connected to MongoDB');

    const result = await talentModel.updateOne(
        { talentId: 41 },
        {
            $set: {
                description: JOKER_BASE_DESCRIPTION,
                triggerTypes: ['fight-end', 'aura'],
            },
        }
    );
    console.log(`talentId 41: matched ${result.matchedCount}, modified ${result.modifiedCount}`);

    await mongoose.disconnect();
    console.log('Done');
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
