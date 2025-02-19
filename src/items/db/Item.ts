import mongoose, {Schema} from 'mongoose';
import {ItemTier} from '../types/ItemTypes';

export const ItemSchema = new Schema({
  itemId: Number,
  name: String,
  description: String,
  price: Number,
  tier: { type: Number, alias: 'levelRequirement' },
  affectedStats: {
    strength: Number,
    accuracy: Number,
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
  type: String,
  equipOptions: [String]
});

export const itemModel = mongoose.model('Item', ItemSchema);

export async function getNumberOfItems(
  numberOfItems: number,
  levelRequirement: number
): Promise<{}[]> {
  return itemModel.aggregate([
    {
      $match: {
        $or: [
          {tier: {$lte: levelRequirement}},
          {levelRequirement: {$lte: levelRequirement}},
        ],
      },
    },
    {$sample: {size: numberOfItems}},
  ]);
}

export async function getItemsById(itemIds: number[]): Promise<{}[]> {
  return itemModel
      .find({itemId: {$in: itemIds}})
      .lean()
      .select({_id: 0, __v: 0});
}

export async function getQuestItems(): Promise<{}[]> {
  return itemModel
      .find({tier: ItemTier.QUEST_TIER_1})
      .lean()
      .select({_id: 0, __v: 0});
}
