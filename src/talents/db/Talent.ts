import mongoose, {Schema} from 'mongoose';
import {StatsSchema} from "../../common/db/Stats";
import {Talent} from "../schema/TalentSchema";
import {affectedStatsFromRaw} from "../../common/schema/AffectedStatsSchema";

export const TalentSchema = new Schema({
  talentId: Number,
  name: String,
  description: String,
  tier: { type: Number, alias: 'levelRequirement' },
  activationRate: Number,
  base: Number,
  scaling: Number,
  image: String,
  tags: [String],
  triggerTypes: [String],
  affectedStats: StatsSchema,
  affectedEnemyStats: StatsSchema,
  statActivations:  { type: Number, default: 0 },
  statDamageDealt:  { type: Number, default: 0 },
  statHealingDone:  { type: Number, default: 0 },
  statGoldGained:   { type: Number, default: 0 },
  statXpGained:     { type: Number, default: 0 },
  totalActivations: { type: Number, default: 0 },
  totalDamageDealt: { type: Number, default: 0 },
  totalHealingDone: { type: Number, default: 0 },
  totalGoldGained:  { type: Number, default: 0 },
  totalXpGained:    { type: Number, default: 0 },
  statHealingPrevented:  { type: Number, default: 0 },
  totalHealingPrevented: { type: Number, default: 0 },
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

function getTalentSchemaObject(talentObjectFromDb: any): Talent {
  const { affectedStats, affectedEnemyStats, ...primitives } = talentObjectFromDb;
  const newTalent = new Talent().assign(primitives);
  newTalent.affectedStats = affectedStatsFromRaw(affectedStats);
  newTalent.affectedEnemyStats = affectedStatsFromRaw(affectedEnemyStats);
  return newTalent;
}

// Short-TTL cache — getAllTalents only ever backs the public, read-only /talents catalog route
// (app.config.ts), returned as plain JSON with no per-call mutation needed, so (unlike
// getRandomTalents/getQuestItems/getAllItems) the raw result itself is safe to hand back
// directly on a cache hit. TTL rather than caching forever preserves the existing "edit a talent
// doc directly in Mongo, see it live shortly after" workflow (see CLAUDE.md) instead of requiring
// a redeploy to pick up a balance change.
const ALL_TALENTS_CACHE_TTL_MS = 5 * 60_000;
let allTalentsCache: { docs: {}[]; expiresAt: number } | null = null;

export async function getAllTalents(): Promise<{}[]> {
  const now = Date.now();
  if (!allTalentsCache || allTalentsCache.expiresAt <= now) {
    const docs = await talentModel.find().lean();
    allTalentsCache = { docs, expiresAt: now + ALL_TALENTS_CACHE_TTL_MS };
  }
  return allTalentsCache.docs;
}
