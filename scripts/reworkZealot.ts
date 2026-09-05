// Zealot rework: no longer zeroes dodge rate. Now converts half of defense into attack speed
// (activationRate drives the split — see TalentBehaviors.ts's ZEALOT behavior and
// talentScaling.ts's registration as a scaling source).
//
// Run with: npx tsx scripts/reworkZealot.ts
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
        { talentId: 28 }, // Zealot
        {
            $set: {
                activationRate: 0.5,
                description: 'Fanaticism: half of your defense is converted into attack speed — each point converted grants +1% attack speed.',
            },
        }
    );
    console.log(`talentId 28: matched ${result.matchedCount}, modified ${result.modifiedCount}`);

    await mongoose.disconnect();
    console.log('Done');
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
