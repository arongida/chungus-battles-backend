import mongoose, { Document, Schema } from 'mongoose';


const ItemSchema = new Schema({
  itemId: Number,
  name: String,
  description: String,
  price: Number,
  levelRequirement: Number,
  affectedStats: {
    hp: Number,
    attack: Number,
    defense: Number,
    attackSpeed: Number,
  },
  image: String
});

export const itemModel = mongoose.model('Item', ItemSchema);


export async function getNumberOfItems(numberOfItems: number, levelRequirement: number): Promise<{}[]> {
  const randomItems = await itemModel.aggregate([{ $match: { levelRequirement: {$lte:levelRequirement} } }, { $sample: { size: numberOfItems } }]);
  //const itemSchemaArray = await itemModel.find({ levelRequirement: {$lte:levelRequirement}}).lean().limit(numberOfItems).select({ _id: 0, __v: 0});
  return randomItems;
}
