// Season 26: Weapon Whisperer's description was last updated in scripts/updateWeaponWhisperer.ts
// (which set it to "Your main hand weapon becomes Legendary!") — two reworks stale since then,
// the talent now pushes the weapon to Mythic AND grants it one rolled item skill (previously
// blocked on unique weapons; see TalentBehaviors.ts's grantWeaponWhispererSecondSkill / itemSkillRoller.ts's
// rollItemSkill anyPool override), plus a permanent Lucky Find bonus the first time it reaches
// Mythic. This script only refreshes the canonical `talents` collection that offers/re-rolls
// read from — the talent's behavior lives entirely in code (TalentBehaviors.ts), so no other
// migration is needed.
//
// Run with: npx tsx scripts/reworkWeaponWhisperer.ts
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
        { talentId: 21 },
        {
            $set: {
                description: 'Your main hand weapon becomes Mythic and learns a bonus item skill! First time reaching Mythic: permanent Lucky Find bonus.',
            },
        }
    );
    console.log(`talentId 21: matched ${result.matchedCount}, modified ${result.modifiedCount}`);

    await mongoose.disconnect();
    console.log('Done');
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
