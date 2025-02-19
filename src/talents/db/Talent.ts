import mongoose, {Schema} from 'mongoose';

export const TalentSchema = new Schema({
  talentId: Number,
  name: String,
  description: String,
  tier: { type: Number, alias: 'levelRequirement' },
  activationRate: Number,
  image: String,
  tags: [String],
  triggerType: String,
});

export const talentModel = mongoose.model('Talent', TalentSchema);

export async function getRandomTalents(
  selectionSize: number,
  level: number,
  exceptions: number[]
): Promise<{}[]> {
  // const talentSchemaArray = await talentModel.find().lean().limit(selectionSize);
  return talentModel.aggregate([
    {$match: {tier: level, tags: {$ne: 'used'}, talentId: {$nin: exceptions}}},
    {$sample: {size: selectionSize}},
  ]);
}

export async function getAllTalents(): Promise<{}[]> {
  return talentModel.find().lean();
}
