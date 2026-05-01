import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
dotenv.config();

const TalentSchema = new mongoose.Schema({
  talentId: Number,
  name: String,
  description: String,
  tier: Number,
  activationRate: Number,
  base: Number,
  scaling: Number,
  image: String,
  tags: [String],
  triggerTypes: [String],
  affectedStats: Object,
  affectedEnemyStats: Object,
});

const Talent = mongoose.model('Talent', TalentSchema);

async function main() {
  await mongoose.connect(process.env.DB_CONNECTION_STRING!);

  const existing = await Talent.findOne({ talentId: 42 });
  if (existing) {
    console.log('Talent 42 already exists, updating...');
    await Talent.updateOne({ talentId: 42 }, {
      $set: {
        name: 'Dual Wield',
        description: 'Copy your main hand weapon to your off hand and gain +10% attack speed per weapon tier.',
        tier: 2,
        activationRate: 1,
        base: 0,
        scaling: 0.1,
        image: '',
        tags: ['rogue'],
        triggerTypes: ['aura'],
        affectedStats: {},
        affectedEnemyStats: {},
      }
    });
    console.log('Updated talent 42 (Dual Wield).');
  } else {
    await Talent.create({
      talentId: 42,
      name: 'Dual Wield',
      description: 'Copy your main hand weapon to your off hand and gain +10% attack speed per weapon tier.',
      tier: 2,
      activationRate: 1,
      base: 0,
      scaling: 0.1,
      image: '',
      tags: ['rogue'],
      triggerTypes: ['aura'],
      affectedStats: {},
      affectedEnemyStats: {},
    });
    console.log('Inserted talent 42 (Dual Wield).');
  }

  await mongoose.disconnect();
}

main().catch(console.error);
