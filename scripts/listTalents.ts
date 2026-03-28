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
  tags: [String],
  triggerTypes: [String],
});

const Talent = mongoose.model('Talent', TalentSchema);

async function main() {
  await mongoose.connect(process.env.DB_CONNECTION_STRING!);
  const talents = await Talent.find({}).sort({ talentId: 1 }).lean();
  for (const t of talents) {
    console.log(
      `[${t.talentId}] ${t.name} (tier ${t.tier}, activationRate=${t.activationRate}, base=${t.base}, scaling=${t.scaling})`
    );
    console.log(`  Triggers: ${(t.triggerTypes || []).join(', ')}`);
    console.log(`  Desc: ${t.description}`);
    console.log();
  }
  await mongoose.disconnect();
}

main().catch(console.error);
