// Season 21 reroll-line rework: moves Zealot (28) down to tier 2, and replaces Quickness (202)
// with Second Thoughts and Learn by doing (403) with Fortune's Fool. Talent IDs are reused so
// in-progress player copies keep resolving through TalentBehaviors — the behavior functions
// self-migrate any stale embedded triggerTypes the first time they see the old trigger fire (see
// the AFTER_REFRESH back-compat branches in TalentBehaviors.ts). This script only needs to update
// the canonical `talents` collection that offers/re-rolls read from.
//
// Run with: npx tsx scripts/reworkRerollTalents.ts
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

    const updates: { talentId: number; set: Record<string, any> }[] = [
        {
            talentId: 28, // Zealot
            set: {
                tier: 2,
                description: 'Zeal blinds you: your dodge rate is set to 0. Gain +1.2% attack speed per defense.',
            },
        },
        {
            talentId: 202, // was Quickness -> Second Thoughts
            set: {
                name: 'Second Thoughts',
                description: 'When you reroll, the most expensive unsold item from the old shop is carried into the new shop at half price. It occupies a shop slot, and survives only one reroll.',
                tier: 3,
                triggerTypes: ['before-refresh'],
                base: 0,
                scaling: 0,
            },
        },
        {
            talentId: 403, // was Learn by doing -> Fortune's Fool
            set: {
                name: "Fortune's Fool",
                description: 'Rerolls are free. Each reroll this round makes you start the next fight with 5% less HP (max 25%).',
                tier: 4,
                triggerTypes: ['aura', 'fight-start'],
                base: 0.05,
                scaling: 0.25,
            },
        },
    ];

    for (const { talentId, set } of updates) {
        const result = await talentModel.updateOne({ talentId }, { $set: set });
        console.log(`talentId ${talentId}: matched ${result.matchedCount}, modified ${result.modifiedCount}`);
    }

    await mongoose.disconnect();
    console.log('Done');
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
