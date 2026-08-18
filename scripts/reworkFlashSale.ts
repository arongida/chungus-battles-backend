// Reworks Flash Sale (103, merchant tier 1) from a per-refresh shop-wide price discount into a
// potion-themed talent: grants a free Health Flask the moment it's picked and every round after,
// and raises active-potion capacity by 1 while owned. Talent ID is reused so in-progress player
// copies keep resolving through TalentBehaviors — the embedded snapshot's stale triggerTypes/
// description are self-migrated the first time the player document loads (see the MERCHANT_1
// branch in common/reworkMigrations.ts). This script only needs to update the canonical `talents`
// collection that offers/re-rolls read from.
//
// Run with: npx tsx scripts/reworkFlashSale.ts
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
            talentId: 103, // Flash Sale: shop-wide discount -> potion-themed
            set: {
                name: 'Flash Sale',
                description: 'Get a free Health Flask the moment you pick this, and another every round after. +1 active potion capacity.',
                tier: 1,
                tags: ['collection', 'merchant'],
                image: 'assets/talents/Icon_Merchant_basic_01.png',
                triggerTypes: ['shop-start', 'aura'],
                base: 0,
                scaling: 0,
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
