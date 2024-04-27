import mongoose, { Document, Schema } from 'mongoose';


const ItemSchema = new Schema({
  itemId: Number,
  name: String,
  description: String,
  price: Number,
  affectedStat: String,
  affectedValue: Number,
});

export const itemModel = mongoose.model('Item', ItemSchema);


export async function getNumberOfItems(newShopSize: number): Promise<{}[]> {
  const itemSchemaArray = await itemModel.find().lean().limit(newShopSize).select({ _id: 0, __v: 0});
  return itemSchemaArray;
}
