import mongoose, { Document, Schema } from 'mongoose';


const TalentSchema = new Schema({
  talentId: Number,
  name: String,
  description: String,
  levelRequirement: Number,
  class: String
});

export const talentModel = mongoose.model('Talent', TalentSchema);

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

export async function getTalents(selectionSize: number): Promise<{}[]> {
  const talentSchemaArray = await talentModel.find().lean().limit(selectionSize).select({ _id: 0, __v: 0 });
  return talentSchemaArray;
}
