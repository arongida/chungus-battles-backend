import mongoose, { Schema } from 'mongoose';

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
  const talentSchemaArray = await talentModel.aggregate([
    { $match: { tier: level, tags: {$ne: 'used'}, talentId: {$nin: exceptions} } },
    { $sample: { size: selectionSize } },
  ]);
  return talentSchemaArray;
}

export async function getAllTalents(): Promise<{}[]> {
  const talentSchemaArray = await talentModel.find().lean();
  return talentSchemaArray;
}

export async function getTalentsById(talentIds: number[]): Promise<{}[]> {
  const talentCollection = await talentModel
    .find({ talentId: { $in: talentIds } })
    .lean()
    .select({ _id: 0, __v: 0 });
  return talentCollection;
}
