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
    rarity: Number,
    baseMinDamage: Number,
    baseMaxDamage: Number,
    baseAttackSpeed: Number,
    triggerTypes: [String]
});

export const itemModel = mongoose.model('Item', ItemSchema);

export async function getNumberOfItems(
    numberOfItems: number,
    levelRequirement: number
): Promise<Item[]> {
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

    return itemArrayFromDb.map(item => getItemSchemaObject(item));
}

function getItemSchemaObject(itemFromDb: any): Item {
    const { affectedStats, setBonusStats, tags, equipOptions, itemCollections, triggerTypes, _id, __v, ...primitives } = itemFromDb;

    const newItemSchemaObject = new Item().assign(primitives);
    newItemSchemaObject.affectedStats = new AffectedStats().assign(affectedStats || {});
    newItemSchemaObject.setBonusStats = new AffectedStats().assign(setBonusStats || {});

    const tagsArr = new ArraySchema<string>();
    if (tags?.length) (tags as string[]).forEach(t => tagsArr.push(t));
    newItemSchemaObject.tags = tagsArr;
    const equipOptionsArr = new ArraySchema<string>();
    if (equipOptions?.length) (equipOptions as string[]).forEach(e => equipOptionsArr.push(e));
    (newItemSchemaObject as any).equipOptions = equipOptionsArr;
    const itemCollectionsArr = new ArraySchema<number>();
    if (itemCollections?.length) (itemCollections as number[]).forEach(c => itemCollectionsArr.push(c));
    (newItemSchemaObject as any).itemCollections = itemCollectionsArr;
    const triggerTypesArr = new ArraySchema<string>();
    if (triggerTypes?.length) (triggerTypes as string[]).forEach(t => triggerTypesArr.push(t));
    newItemSchemaObject.triggerTypes = triggerTypesArr;

    return newItemSchemaObject;
}

export async function getItemById(itemId: number): Promise<Item | null> {
    const itemFromDb = await itemModel
        .findOne({itemId: itemId})
        .lean()
        .select({_id: 0, __v: 0});
    return itemFromDb ? getItemSchemaObject(itemFromDb) : null;
}

export async function getQuestItems(): Promise<Item[]> {
    const itemArrayFromDb = await itemModel
        .find({tier: ItemTier.QUEST_TIER_1})
        .lean()
        .select({_id: 0, __v: 0});

    return itemArrayFromDb.map(item => getItemSchemaObject(item));
}
