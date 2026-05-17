import mongoose from 'mongoose';
import { talentModel } from '../src/talents/db/Talent';
import { playerModel } from '../src/players/db/Player';

async function main() {
    const connectionString = process.env.DB_CONNECTION_STRING;
    if (!connectionString) {
        console.error('DB_CONNECTION_STRING env var is required');
        process.exit(1);
    }

    await mongoose.connect(connectionString);
    console.log('Connected to MongoDB');

    const talents = await talentModel.find({}, { talentId: 1, image: 1 }).lean();
    const imageByTalentId = new Map<number, string>();
    for (const t of talents) {
        if (t.image) imageByTalentId.set(t.talentId, t.image);
    }
    console.log(`Loaded ${imageByTalentId.size} talents with images`);

    const players = await playerModel.find({}).lean();
    console.log(`Found ${players.length} player documents`);

    let updatedPlayers = 0;
    for (const player of players) {
        if (!player.talents?.length) continue;

        const updates: Record<string, string> = {};
        player.talents.forEach((talent: any, i: number) => {
            const image = imageByTalentId.get(talent.talentId);
            if (image && talent.image !== image) {
                updates[`talents.${i}.image`] = image;
            }
        });

        if (Object.keys(updates).length > 0) {
            await playerModel.updateOne({ _id: player._id }, { $set: updates });
            updatedPlayers++;
        }
    }

    console.log(`Updated ${updatedPlayers} player documents`);
    await mongoose.disconnect();
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
