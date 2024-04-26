import mongoose, { Document, Schema } from 'mongoose';


export const talentMongooseSchema = new Schema({
  talentId: Number,
  name: String,
  description: String,
  levelRequirement: Number,
  class: String
});

export const talentModel = mongoose.model('Talent', talentMongooseSchema);

export async function seedTalents(): Promise<void> {

  const talents = [
    {
      talentId: 1,
      name: 'Rage',
      description: 'Loose health to gain attack',
      levelRequirement: 1,
      class: 'Warrior',
    },
    {
      talentId: 2,
      name: 'Greed',
      description: 'Gain gold',
      levelRequirement: 1,
      class: 'Merchant'
    }
  ];

  await talentModel.insertMany(talents);

}

export async function getNumberOfTalents(selectionSize: number): Promise<{}[]> {
  const talentSchemaArray = await talentModel.find().lean().limit(selectionSize);
  return talentSchemaArray;
}

export async function getAllTalents(): Promise<{}[]> {
  const talentSchemaArray = await talentModel.find().lean();
  return talentSchemaArray;
}
