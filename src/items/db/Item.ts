import mongoose, {Schema} from 'mongoose';
import {ItemTier} from '../types/ItemTypes';
import {StatsSchema} from "../../common/db/Stats";
import {Item} from "../schema/ItemSchema";
import {AffectedStats} from "../../common/schema/AffectedStatsSchema";
import {ArraySchema} from "@colyseus/schema";

export const ItemSchema = new Schema({
    itemId: Number,
    name: String,
    description: String,
    price: Number,
    tier: {type: Number, alias: 'levelRequirement'},
    affectedStats: StatsSchema,
    setBonusStats: StatsSchema,
    setActive: Boolean,
    set: String,
    image: String,
    tags: [String],
    itemCollections: [Number],
    type: String,
    equipOptions: [String],
    rarity: Number
});

export const itemModel = mongoose.model('Item', ItemSchema);

export async function getNumberOfItems(
    numberOfItems: number,
    levelRequirement: number
): Promise<ArraySchema<Item>> {
    const itemArrayFromDb = await itemModel.aggregate([
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

    const itemArraySchema = new ArraySchema();
    itemArrayFromDb.forEach(item => {
        const itemSchemaObject = getItemSchemaObject(item);
        itemArraySchema.push(itemSchemaObject);
    })

    return itemArraySchema;
}

function getItemSchemaObject(itemFromDb: Object): Item {

    const newItemSchemaObject = new Item().assign(itemFromDb);
    newItemSchemaObject.affectedStats = new AffectedStats().assign(newItemSchemaObject.affectedStats);
    newItemSchemaObject.setBonusStats = new AffectedStats().assign(newItemSchemaObject.setBonusStats);

    return newItemSchemaObject;

}

export async function getItemById(itemId: number): Promise<Item> {
    const itemFromDb = await itemModel
        .findOne({itemId: itemId})
        .lean()
        .select({_id: 0, __v: 0});
    return getItemSchemaObject(itemFromDb);
}

export async function getQuestItems(): Promise<{}[]> {
    return itemModel
        .find({tier: ItemTier.QUEST_TIER_1})
        .lean()
        .select({_id: 0, __v: 0});
}
