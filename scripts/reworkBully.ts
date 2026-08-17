// Season 24: replaces "Warrior vol II." (201, warrior, throw-weapon damage active) with Bully
// (conditional stun). Talent ID is reused so in-progress player copies keep resolving through
// TalentBehaviors — the embedded snapshot's stale name/description/base/activationRate are
// self-migrated the first time the player document loads (see the WARRIOR_2 branch in
// common/reworkMigrations.ts). This script only needs to update the canonical `talents`
// collection that offers/re-rolls read from.
//
// Run with: npx tsx scripts/reworkBully.ts
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
            talentId: 201, // was "Warrior vol II." (throw weapon damage active) -> Bully (conditional stun)
            set: {
                name: 'Bully',
                description: 'Every 4s: if your Strength is higher than the enemy\'s right now, stun them for 1s — they cannot attack, regenerate, use skills or dodge. If you\'re not stronger, nothing happens. +20 ⏳',
                tier: 2,
                tags: ['collection', 'warrior'],
                image: 'assets/talents/Icon_Warrior_basic_01.png',
                triggerTypes: ['active'],
                base: 1,
                scaling: 0,
                activationRate: 0.25,
                affectedStats: { cooldownReduction: 20 },
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
