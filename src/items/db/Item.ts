import mongoose, {Schema} from 'mongoose';
import {StatsSchema} from "../../common/db/Stats";
import {Item} from "../schema/ItemSchema";
import {AffectedStats} from "../../common/schema/AffectedStatsSchema";
import {ArraySchema} from "@colyseus/schema";
import {rollItemStats} from "../stats/itemStatRoller";

export const ItemSchema = new Schema({
    itemId: Number,
    name: String,
    description: String,
    price: Number,
    tier: {type: Number, alias: 'levelRequirement'},
    affectedStats: StatsSchema,
    class: String,
    image: String,
    tags: [String],
    itemCollections: [Number],
    type: String,
    equipOptions: [String],
    rarity: Number,
    sellPrice: Number,
    baseMinDamage: Number,
    baseMaxDamage: Number,
    baseAttackSpeed: Number,
    strengthScaling: Number,
    triggerTypes: [String],
    affectedEnemyStats: StatsSchema,
    upgradePreview: Boolean,
});

export const itemModel = mongoose.model('Item', ItemSchema);

export async function getNumberOfItems(
    numberOfItems: number,
    levelRequirement: number,
    excludeTypes: string[] = []
): Promise<Item[]> {
    const match: any = {
        $or: [
            {tier: {$lte: levelRequirement}},
            {levelRequirement: {$lte: levelRequirement}},
        ],
        tags: {$ne: 'quest'},
    };
    if (excludeTypes.length > 0) match.type = {$nin: excludeTypes};

    const itemArrayFromDb = await itemModel.aggregate([
        {$match: match},
        {$sample: {size: numberOfItems}},
    ]);

    return itemArrayFromDb.map(item => {
        const schemaItem = getItemSchemaObject(item);
        rollItemStats(schemaItem);
        return schemaItem;
    });
}

function getItemSchemaObject(itemFromDb: any): Item {
    const { affectedStats, affectedEnemyStats, tags, equipOptions, itemCollections, triggerTypes, _id, __v, ...primitives } = itemFromDb;

    const newItemSchemaObject = new Item().assign(primitives);
    if (!newItemSchemaObject.sellPrice) newItemSchemaObject.sellPrice = Math.floor(newItemSchemaObject.price * 0.7);
    newItemSchemaObject.affectedStats = new AffectedStats().assign(affectedStats || {});
    newItemSchemaObject.affectedEnemyStats = new AffectedStats().assign(affectedEnemyStats || {});

    const tagsArr = new ArraySchema<string>();
    if (tags?.length) (tags as string[]).forEach(t => tagsArr.push(t));
    newItemSchemaObject.tags = tagsArr;
    const equipOptionsArr = new ArraySchema<string>();
    let equipOptionsList: string[] = [];
    if (typeof equipOptions === 'string') {
        try { equipOptionsList = JSON.parse(equipOptions); } catch {}
    } else if (Array.isArray(equipOptions)) {
        equipOptionsList = equipOptions;
    }
    equipOptionsList.forEach(e => equipOptionsArr.push(e));
    (newItemSchemaObject as any).equipOptions = equipOptionsArr;
    const itemCollectionsArr = new ArraySchema<number>();
    if (itemCollections?.length) (itemCollections as number[]).forEach(c => itemCollectionsArr.push(c));
    (newItemSchemaObject as any).itemCollections = itemCollectionsArr;
    const triggerTypesArr = new ArraySchema<string>();
    if (triggerTypes?.length) (triggerTypes as string[]).forEach(t => triggerTypesArr.push(t));
    newItemSchemaObject.triggerTypes = triggerTypesArr;

    return newItemSchemaObject;
}

/**
 * Random sample of non-quest items at an exact tier (e.g. tier 5, for items that
 * transform into a "random legendary" reward). Unlike getNumberOfItems, this matches
 * tier exactly rather than `tier <= levelRequirement`.
 */
export async function getRandomItemsByTier(tier: number, count: number): Promise<Item[]> {
    const itemArrayFromDb = await itemModel.aggregate([
        {$match: {tier, tags: {$ne: 'quest'}}},
        {$sample: {size: count}},
    ]);

    return itemArrayFromDb.map(item => {
        const schemaItem = getItemSchemaObject(item);
        rollItemStats(schemaItem);
        return schemaItem;
    });
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
        .find({tags: "quest"})
        .lean()
        .select({_id: 0, __v: 0});

    return itemArrayFromDb.map(item => getItemSchemaObject(item));
}

export async function getAllItems(): Promise<Item[]>{
    const allItemsFromDb = await itemModel.find({}).lean();
    return allItemsFromDb.map(item => getItemSchemaObject(item));
}

/**
 * Deep-clones a live Item schema object (preserving rolled stats, rarity,
 * sellPrice) by round-tripping through the same DB→Colyseus reconstruction
 * used when first loading from MongoDB.
 */
export function cloneItem(item: Item): Item {
    return getItemSchemaObject(item.toJSON());
}
