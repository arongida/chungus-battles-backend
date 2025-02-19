import mongoose, {Schema} from 'mongoose';

export const ItemCollectionSchema = new Schema({
	itemCollectionId: Number,
	name: String,
	requirements: String,
	effect: String,
	image: String,
	tags: [String],
	base: Number,
	scaling: Number,
	tier: Number,
  triggerType: String,
});

export const itemcollectionModel = mongoose.model(
	'ItemCollection',
	ItemCollectionSchema
);

export async function getAllItemCollections(): Promise<{}[]> {
	return itemcollectionModel.find().lean();
}

export async function getItemCollectionsById(
	itemCollectionIds: number[]
): Promise<{}[]> {
	return itemcollectionModel
		.find({itemCollectionId: {$in: itemCollectionIds}})
		.lean()
		.select({_id: 0, __v: 0});
}
