import mongoose, { Schema } from 'mongoose';

const ItemSchema = new Schema({
  itemId: Number,
  name: String,
  description: String,
  price: Number,
  tier: { type: Number, alias: 'levelRequirement' },
  affectedStats: {
    strength: Number,
    accuracy: Number,
    minDmg: Number,
    maxDmg: Number,
    hp: Number,
    defense: Number,
    attackSpeed: Number,
    flatDmgReduction: Number,
    dodgeRate: Number,
    income: Number,
    hpRegen: Number,

  },
  image: String,
  tags: [String],
  itemCollections: [Number],
});

export const itemModel = mongoose.model('Item', ItemSchema);

export async function getNumberOfItems(
  numberOfItems: number,
  levelRequirement: number
): Promise<{}[]> {
  const randomItems = await itemModel.aggregate([
    {
      $match: {
        $or: [
          { tier: { $lte: levelRequirement } },
          { levelRequirement: { $lte: levelRequirement } },
        ],
      },
    },
    { $sample: { size: numberOfItems } },
  ]);
  //const itemSchemaArray = await itemModel.find({ levelRequirement: {$lte:levelRequirement}}).lean().limit(numberOfItems).select({ _id: 0, __v: 0});
  return randomItems;
}

export async function getItemsById(itemIds: number[]): Promise<{}[]> {
  const itemCollection = await itemModel
    .find({ itemId: { $in: itemIds } })
    .lean()
    .select({ _id: 0, __v: 0 });
  return itemCollection;
}
