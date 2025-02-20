import mongoose, {Schema} from 'mongoose';
import {StatsSchema} from "../../common/db/Stats";
import {Talent} from "../schema/TalentSchema";
import {AffectedStats} from "../../common/schema/AffectedStatsSchema";

export const TalentSchema = new Schema({
  talentId: Number,
  name: String,
  description: String,
  tier: { type: Number, alias: 'levelRequirement' },
  activationRate: Number,
  image: String,
  tags: [String],
  triggerType: String,
  affectedStats: StatsSchema
});

export const talentModel = mongoose.model('Talent', TalentSchema);

export async function getRandomTalents(
  selectionSize: number,
  level: number,
  exceptions: number[]
): Promise<Talent[]> {
  const randomTalents = await talentModel.aggregate([
    {$match: {tier: level, tags: {$ne: 'used'}, talentId: {$nin: exceptions}}},
    {$sample: {size: selectionSize}},
  ]) as Talent[];
  return randomTalents.map((talent) => {
    return getTalentSchemaObject(talent)
  })
}

function getTalentSchemaObject(talentObjectFromDb: Object): Talent {
  const newTalent = new Talent().assign(talentObjectFromDb);
  newTalent.affectedStats = new AffectedStats();
  return newTalent;
}

export async function getAllTalents(): Promise<{}[]> {
  return talentModel.find().lean();
}
