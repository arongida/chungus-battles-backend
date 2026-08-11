import mongoose, {Schema} from 'mongoose';
import {StatsSchema} from "../../common/db/Stats";
import {Item} from "../schema/ItemSchema";
import {affectedStatsFromRaw} from "../../common/schema/AffectedStatsSchema";
import {ArraySchema} from "@colyseus/schema";
import {rollItemStats} from "../stats/itemStatRoller";
import {reconcileItemSkill, reconcileItemSkill2} from "../skills/itemSkillRoller";
import {ItemType} from "../types/ItemTypes";
import {migrateLegacyItem} from "../../common/reworkMigrations";

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
    // Activations per second for TriggerType.ACTIVE items — same meaning as Talent.activationRate.
    activationRate: Number,
    affectedEnemyStats: StatsSchema,
    upgradePreview: Boolean,
    luckyFind: Boolean,
    previewBaseRarity: Number,
    luckyFindSteps: Number,
    // Class-item skill display fields (see items/skills/itemSkillRoller.ts). Note
    // skillAffectedStats/skillAffectedEnemyStats are deliberately NOT here — they're pure
    // runtime aura output (ItemSchema.ts), never persisted.
    skillId: Number,
    skillName: String,
    skillDescription: String,
    // Weapon Whisperer's second skill slot (ItemSchema.ts) — same persistence treatment as slot 1.
    skillId2: Number,
    skillName2: String,
    skillDescription2: String,
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
    // skillAffectedStats/skillAffectedEnemyStats must be excluded here too, not just persisted
    // affectedStats/affectedEnemyStats: cloneItem() round-trips a LIVE item through toJSON(),
    // which serializes them as plain objects — left in `primitives`, .assign() would clobber the
    // Item constructor's real AffectedStats instance with that plain object (breaking Colyseus
    // schema sync — "AffectedStats was expected, but Object was provided"). skillStatus is
    // excluded for the same "pure runtime output, never worth carrying over" reason — leaving it
    // out of `primitives` lets it fall back to the schema default ('') rather than a stale string.
    const { affectedStats, affectedEnemyStats, skillAffectedStats, skillAffectedEnemyStats, skillStatus, skillAffectedStats2, skillAffectedEnemyStats2, skillStatus2, tags, equipOptions, itemCollections, triggerTypes, _id, __v, ...primitives } = itemFromDb;

    const newItemSchemaObject = new Item().assign(primitives);
    if (!newItemSchemaObject.sellPrice) newItemSchemaObject.sellPrice = Math.floor(newItemSchemaObject.price * 0.7);
    newItemSchemaObject.affectedStats = affectedStatsFromRaw(affectedStats);
    newItemSchemaObject.affectedEnemyStats = affectedStatsFromRaw(affectedEnemyStats);
    // Always a fresh AffectedStats — this is pure runtime aura output (see ItemSchema.ts), never
    // meaningfully persisted, so there's nothing worth carrying over from `skillAffectedStats`
    // even when a toJSON() round-trip did include a (soon stale) snapshot of it.
    newItemSchemaObject.skillAffectedStats = affectedStatsFromRaw(undefined);
    newItemSchemaObject.skillAffectedEnemyStats = affectedStatsFromRaw(undefined);
    // Same treatment for Weapon Whisperer's second skill slot.
    newItemSchemaObject.skillAffectedStats2 = affectedStatsFromRaw(undefined);
    newItemSchemaObject.skillAffectedEnemyStats2 = affectedStatsFromRaw(undefined);

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

    // Re-sync skillName/skillDescription/triggerTypes against the current ITEM_SKILLS table —
    // covers shop rolls, quest items, and cloneItem() (dual-wield ghost copies, upgrade previews).
    reconcileItemSkill(newItemSchemaObject);
    reconcileItemSkill2(newItemSchemaObject);
    // Cooldown-reduction rework (Season 24): see common/reworkMigrations.ts.
    migrateLegacyItem(newItemSchemaObject);

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

/**
 * Random sample of non-quest, non-ring WEAPONS at an exact tier (Martial Artist's per-round free
 * weapon grant). Rings (Band of Vigor, Ring of Immortality) are type WEAPON but excluded here: a
 * free Ring of Immortality every round would transform into a free Legendary every round.
 */
export async function getRandomWeaponsByTier(tier: number, count: number): Promise<Item[]> {
    const itemArrayFromDb = await itemModel.aggregate([
        {$match: {tier, type: ItemType.WEAPON, tags: {$nin: ['quest', 'ring']}}},
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
