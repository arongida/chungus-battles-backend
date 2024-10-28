import mongoose, { Schema } from 'mongoose';

const ItemCollectionSchema = new Schema({
	itemCollectionId: Number,
	name: String,
	requirements: String,
	effect: String,
	image: String,
	tags: [String],
	base: Number,
	scaling: Number,
	tier: Number,
});

export const itemcollectionModel = mongoose.model(
	'ItemCollection',
	ItemCollectionSchema
);

export async function getAllItemCollections(): Promise<{}[]> {
	const itemCollectionSchemaArray = await itemcollectionModel.find().lean();
	return itemCollectionSchemaArray;
}

export async function getItemCollectionsById(
	itemCollectionIds: number[]
): Promise<{}[]> {
	const itemCollections = await itemcollectionModel
		.find({ itemCollectionId: { $in: itemCollectionIds } })
		.lean()
		.select({ _id: 0, __v: 0 });
	return itemCollections;
}
