// Season 24: replaces Second Thoughts (202, rogue) with VIP Pass (merchant). Talent ID is reused
// so in-progress player copies keep resolving through TalentBehaviors — the embedded snapshot's
// stale trigger/name/description/image/class tag are self-migrated the first time the player
// document loads (see the VIP_PASS branch in common/reworkMigrations.ts). This script only needs
// to update the canonical `talents` collection that offers/re-rolls read from.
//
// Run with: npx tsx scripts/reworkVipPass.ts
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
            talentId: 202, // was Second Thoughts (rogue) -> VIP Pass (merchant)
            set: {
                name: 'VIP Pass',
                description: 'Every shop is guaranteed to stock an item you already own. +10% lucky find. Membership isn\'t free — rerolls cost 1 more gold.',
                tier: 4,
                tags: ['collection', 'merchant'],
                image: 'assets/talents/Icon_Merchant_basic_01.png',
                triggerTypes: ['aura'],
                base: 0,
                scaling: 0,
                affectedStats: { luckyFindChance: 0.10 },
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
