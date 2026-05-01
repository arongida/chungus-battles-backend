import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
dotenv.config();

const Talent = mongoose.model('Talent', new mongoose.Schema({
  talentId: Number,
  description: String,
  activationRate: Number,
  triggerTypes: [String],
}));

async function main() {
  await mongoose.connect(process.env.DB_CONNECTION_STRING!);
  const result = await Talent.updateOne(
    { talentId: 21 },
    { $set: { triggerTypes: ['aura'], description: 'Your main hand weapon becomes Legendary!', activationRate: 1 } }
  );
  console.log(result);
  await mongoose.disconnect();
}

main().catch(console.error);
