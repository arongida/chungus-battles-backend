import mongoose, { Document, Schema } from 'mongoose';


const ItemSchema = new Schema({
  itemId: Number,
  name: String,
  description: String,
  price: Number,
  affectedStat: String,
  affectedValue: Number,
});

export const dbItemSchema = mongoose.model('Item', ItemSchema);


export async function getAllItems(newShopSize: number): Promise<{}[]> {
  const itemSchemaArray = await dbItemSchema.find().lean().limit(newShopSize).select({ _id: 0, __v: 0});
  return itemSchemaArray;
}
