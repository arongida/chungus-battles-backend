import mongoose, {Schema} from 'mongoose';
import {ItemCollection} from "../schema/ItemCollectionSchema";
import {ArraySchema, MapSchema} from "@colyseus/schema";
import {StatsSchema} from "../../common/db/Stats";
import {AffectedStats} from "../../common/schema/AffectedStatsSchema";
import {Player} from "../../players/schema/PlayerSchema";
import {Item} from "../../items/schema/ItemSchema";
import {Talent} from "../../talents/schema/TalentSchema";

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
    affectedStats: StatsSchema
});

export const itemcollectionModel = mongoose.model(
    'ItemCollection',
    ItemCollectionSchema
);

export async function getAllItemCollections(): Promise<ArraySchema<ItemCollection>> {
    const itemCollectionsFromDb = await itemcollectionModel.find().lean();
    const itemCollectionsArraySchema = new ArraySchema<ItemCollection>();

    itemCollectionsFromDb.forEach((itemCollection) => {
        const newItemCollection = new ItemCollection().assign(itemCollectionsFromDb as Object);
        newItemCollection.affectedStats = new AffectedStats();
    });
    return itemCollectionsArraySchema;
}

export async function getItemCollectionsById(
    itemCollectionIds: number[]
): Promise<{}[]> {
    return itemcollectionModel
        .find({itemCollectionId: {$in: itemCollectionIds}})
        .lean()
        .select({_id: 0, __v: 0});
}
