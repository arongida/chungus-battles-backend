import mongoose, {Schema, PipelineStage} from 'mongoose';
import {Player} from '../schema/PlayerSchema';
import {Item} from '../../items/schema/ItemSchema';
import {getItemById, ItemSchema} from "../../items/db/Item";
import {TalentSchema} from "../../talents/db/Talent";
import {Talent} from "../../talents/schema/TalentSchema";
import {ArraySchema, MapSchema} from "@colyseus/schema";
import {StatsSchema} from "../../common/db/Stats";
import {AffectedStats} from "../../common/schema/AffectedStatsSchema";
import {EquipSlot} from '../../items/types/ItemTypes';
import {rollTheDice} from "../../common/utils";
import {PlayerAvatar} from "../types/PlayerTypes";
import {GAME_VERSION} from "../../common/types";


const PlayerSchema = new Schema({
    playerId: Number,
    originalPlayerId: Number,
    name: String,
    gold: {type: Number, alias: '_gold'},
    xp: Number,
    level: {type: Number, alias: '_level'},
    sessionId: String,
    maxXp: Number,
    round: Number,
    lives: Number,
    wins: Number,
    avatarUrl: String,
    gameVersion: Number,
    hasVersionWin: Boolean,
    talents: [TalentSchema],
    inventory: [ItemSchema],
    lockedShop: [ItemSchema],
    baseStats: StatsSchema,
    equippedItems: {type: Map, of: ItemSchema},
});

export const playerModel = mongoose.model('Player', PlayerSchema);

export async function getPlayer(playerId: number): Promise<Player> {
    const playerSchema = await playerModel.findOne({playerId: playerId}).lean().select({_id: 0, __v: 0});

    return playerSchema ? getPlayerSchemaObject(playerSchema) : null;
}

function buildItemSchema(itemFromDb: any): Item {
    const { affectedStats, setBonusStats, affectedEnemyStats, tags, equipOptions, itemCollections, triggerTypes, _id, __v, ...primitives } = itemFromDb;
    const item = new Item().assign(primitives);
    if (!item.sellPrice) item.sellPrice = Math.floor(item.price * item.rarity * 0.7);
    item.affectedStats = new AffectedStats().assign(affectedStats || {});
    item.setBonusStats = new AffectedStats().assign(setBonusStats || {});
    item.affectedEnemyStats = new AffectedStats().assign(affectedEnemyStats || {});
    const tagsArr = new ArraySchema<string>();
    if (tags?.length) (tags as string[]).forEach(t => tagsArr.push(t));
    item.tags = tagsArr;
    const equipOptionsArr = new ArraySchema<string>();
    if (equipOptions?.length) (equipOptions as string[]).forEach(e => equipOptionsArr.push(e));
    (item as any).equipOptions = equipOptionsArr;
    const itemCollectionsArr = new ArraySchema<number>();
    if (itemCollections?.length) (itemCollections as number[]).forEach(c => itemCollectionsArr.push(c));
    (item as any).itemCollections = itemCollectionsArr;
    const triggerTypesArr = new ArraySchema<string>();
    if (triggerTypes?.length) (triggerTypes as string[]).forEach(t => triggerTypesArr.push(t));
    item.triggerTypes = triggerTypesArr;
    return item;
}

function getPlayerSchemaObject(playerFromDb: any): Player {
    const { baseStats, equippedItems, talents, inventory, lockedShop, ...primitives } = playerFromDb;

    const newPlayerSchemaObject = new Player().assign(primitives);
    newPlayerSchemaObject.baseStats = new AffectedStats().assign(baseStats || {});

    const newPlayerEquippedItemsMapSchema = new MapSchema();
    if (equippedItems) {
        const entries = equippedItems instanceof Map ? equippedItems.entries() : Object.entries(equippedItems);
        for (const [key, rawItem] of entries) {
            newPlayerEquippedItemsMapSchema.set(key, buildItemSchema(rawItem as any));
        }
    }
    newPlayerSchemaObject.equippedItems = newPlayerEquippedItemsMapSchema;

    const newPlayerTalentArraySchema = new ArraySchema();
    (talents || []).forEach((talent: any) => {
        const { affectedStats: tAs, affectedEnemyStats: tAes, ...talentPrimitives } = talent;
        const talentSchemaObject = new Talent().assign(talentPrimitives);
        talentSchemaObject.affectedStats = new AffectedStats().assign(tAs || {});
        talentSchemaObject.affectedEnemyStats = new AffectedStats().assign(tAes || {});
        newPlayerTalentArraySchema.push(talentSchemaObject);
    });
    newPlayerSchemaObject.talents = newPlayerTalentArraySchema;

    const newPlayerInventoryArraySchema = new ArraySchema();
    (inventory || []).forEach((item: any) => {
        newPlayerInventoryArraySchema.push(buildItemSchema(item));
    });
    newPlayerSchemaObject.inventory = newPlayerInventoryArraySchema;

    const newPlayerLockedShopArraySchema = new ArraySchema();
    (lockedShop || []).forEach((item: any) => {
        newPlayerLockedShopArraySchema.push(buildItemSchema(item));
    });
    newPlayerSchemaObject.lockedShop = newPlayerLockedShopArraySchema;

    return newPlayerSchemaObject;
}

function getNewPlayer(playerId: number,
                      name: string,
                      sessionId: string,
                      avatarUrl: string,
                      startingGold: number) {
    return new playerModel({
        playerId: playerId,
        originalPlayerId: playerId,
        name: name,
        gold: startingGold,
        xp: 0,
        level: 1,
        sessionId: sessionId,
        maxXp: 12,
        round: 1,
        lives: 3,
        wins: 0,
        avatarUrl: avatarUrl,
        gameVersion: GAME_VERSION,
        talents: [],
        inventory: [],
        activeItemCollections: [],
        equippedItems: {},
        baseStats: {
            strength: 3,
            accuracy: 1,
            maxHp: 100,
            defense: 0,
            attackSpeed: 1,
            flatDmgReduction: 0,
            dodgeRate: 0,
            income: 0,
            hpRegen: 0,
        }
    });
}

function getDefaultWeaponId(avatarUrl: string): number {
    if (avatarUrl === PlayerAvatar.WARRIOR) return 1;
    if (avatarUrl === PlayerAvatar.THIEF) return 2;
    return 68;
}

export async function createNewPlayer(
    playerId: number,
    name: string,
    sessionId: string,
    avatarUrl: string
): Promise<Player> {
    const startingGold = process.env.NODE_ENV === 'production' ? 6 : 1000;
    const newPlayer = getNewPlayer(playerId, name, sessionId, avatarUrl, startingGold);
    await newPlayer.save().catch((err) => console.error(err));
    const playerSchema = getPlayerSchemaObject(newPlayer.toObject());
    const defaultWeapon = await getItemById(getDefaultWeaponId(avatarUrl));
    if (defaultWeapon) {
        playerSchema.inventory.push(defaultWeapon);
        playerSchema.setItemEquipped(defaultWeapon, EquipSlot.MAIN_HAND);
        await updatePlayer(playerSchema);
    } else {
        console.warn(`Default weapon for avatar ${avatarUrl} not found in DB`);
    }
    return playerSchema;
}

export async function copyPlayer(player: Player): Promise<Player> {
    const newPlayerObject = {
        ...playerToPlainObject(player),
        playerId: await getNextPlayerId(),
    };

    const newPlayer = new playerModel(newPlayerObject);
    await newPlayer.save().catch((err) => console.error(err));
    return getPlayerSchemaObject(newPlayer.toObject());
}

export async function updatePlayer(player: Player): Promise<Player> {
    const playerObject = playerToPlainObject(player);

    const foundPlayerModel = await playerModel.findOne({playerId: player.playerId});
    if (!foundPlayerModel) return player;
    foundPlayerModel.set(playerObject);

    await foundPlayerModel.save().catch((err) => console.error(err));
    return player;
}

export async function getNextPlayerId(): Promise<number> {
    const lastPlayer = await playerModel.findOne().sort({playerId: -1}).limit(1).lean().catch((e) => {
        console.error(e);
    });
    return lastPlayer ? lastPlayer.playerId + 1 : 1;
}

function cleanRawObj(obj: any): Record<string, any> {
    if (!obj) return {};
    const { _id, __v, ...rest } = obj;
    return rest;
}

function cleanRawItem(item: any): Record<string, any> | null {
    if (!item) return null;
    const { _id, __v, affectedStats, setBonusStats, affectedEnemyStats, ...rest } = item;
    return {
        ...rest,
        affectedStats: cleanRawObj(affectedStats),
        setBonusStats: cleanRawObj(setBonusStats),
        affectedEnemyStats: cleanRawObj(affectedEnemyStats),
    };
}

function cleanRawTalent(talent: any): Record<string, any> | null {
    if (!talent) return null;
    const { _id, __v, affectedStats, affectedEnemyStats, ...rest } = talent;
    return {
        ...rest,
        affectedStats: cleanRawObj(affectedStats),
        affectedEnemyStats: cleanRawObj(affectedEnemyStats),
    };
}

function cleanRawPlayerDoc(doc: any): Record<string, any> {
    const { _id, __v, equippedItems, inventory, talents, lockedShop, baseStats, ...rest } = doc;
    const cleanEquippedItems: Record<string, any> = {};
    if (equippedItems) {
        for (const [slot, item] of Object.entries(equippedItems)) {
            cleanEquippedItems[slot] = cleanRawItem(item as any);
        }
    }
    return {
        ...rest,
        baseStats: cleanRawObj(baseStats),
        equippedItems: cleanEquippedItems,
        inventory: (inventory || []).map(cleanRawItem),
        talents: (talents || []).map(cleanRawTalent),
        lockedShop: (lockedShop || []).map(cleanRawItem),
    };
}

export function playerToPlainObject(player: Player): Record<string, any> {
    const equippedItems: Record<string, any> = {};
    player.equippedItems.forEach((item, slot) => {
        equippedItems[slot] = item.toJSON();
    });
    return {
        playerId: player.playerId,
        originalPlayerId: player.originalPlayerId,
        name: player.name,
        gold: player.gold,
        xp: player.xp,
        level: player.level,
        sessionId: player.sessionId,
        maxXp: player.maxXp,
        round: player.round,
        lives: player.lives,
        wins: player.wins,
        avatarUrl: player.avatarUrl,
        gameVersion: player.gameVersion,
        hasVersionWin: player.hasVersionWin,
        income: player.income,
        hpRegen: player.hpRegen,
        dodgeRate: player.dodgeRate,
        refreshShopCost: player.refreshShopCost,
        maxHp: player.maxHp,
        hp: player.hp,
        strength: player.strength,
        accuracy: player.accuracy,
        defense: player.defense,
        attackSpeed: player.attackSpeed,
        flatDmgReduction: player.flatDmgReduction,
        baseStats: player.baseStats?.toJSON() || {},
        equippedItems,
        inventory: player.inventory.map(item => item.toJSON()),
        talents: player.talents.map(talent => talent.toJSON()),
        lockedShop: player.lockedShop.map(item => item.toJSON()),
    };
}

const TOP_PLAYERS_AGGREGATION: PipelineStage[] = [
    {$sort: {wins: -1, originalPlayerId: -1, playerId: 1}},
    {$group: {_id: '$originalPlayerId', doc: {$first: '$$ROOT'}}},
    {$replaceRoot: {newRoot: '$doc'}},
    {$sort: {wins: -1, originalPlayerId: -1, playerId: 1}},
];

export async function getTopPlayers(number: number): Promise<Record<string, any>[]> {
    const topPlayers = await playerModel
        .aggregate([...TOP_PLAYERS_AGGREGATION, {$limit: number}])
        .exec();
    return topPlayers.map(cleanRawPlayerDoc);
}

export async function getTopPlayersByVersion(number: number, gameVersion: number): Promise<Record<string, any>[]> {
    const topPlayers = await playerModel
        .aggregate([{$match: {gameVersion}}, ...TOP_PLAYERS_AGGREGATION, {$limit: number}])
        .exec();
    return topPlayers.map(cleanRawPlayerDoc);
}

export async function getHighestWinByVersion(gameVersion: number): Promise<number> {
    const player = await playerModel.findOne({gameVersion}).sort({wins: -1}).limit(1).lean();
    return player?.wins ?? 0;
}

export async function getPlayerRank(playerId: number): Promise<number> {
    const player = await playerModel.findOne({playerId: playerId}).lean();
    const rank = await playerModel.countDocuments({wins: {$gt: player.wins}});
    return rank + 1;
}

export async function getHighestWin(): Promise<number> {
    const highestWinPlayer = await playerModel.findOne().sort({wins: -1}).limit(1).lean();
    return highestWinPlayer.wins;
}

export async function getSameRoundPlayer(round: number, playerId: number): Promise<Player> {
    if (round < 1) {
        const defaultPlayerClone = await playerModel
            .findOne({originalPlayerId: playerId, playerId: {$ne: playerId}})
            .lean();
        return defaultPlayerClone ? getPlayerSchemaObject(defaultPlayerClone) : null;
    }

    if (round === 1) {
        const avatarArray = Array.from(Object.values(PlayerAvatar));
        const joeModel = getNewPlayer(0, 'Joe', '', avatarArray[rollTheDice(0, 2)], 10);
        const joe = getPlayerSchemaObject(joeModel.toObject());
        joe.baseStats.maxHp = 50;
        joe.baseStats.strength = 2;
        const weapon = await getItemById(81);
        joe.setItemEquipped(weapon, EquipSlot.MAIN_HAND);
        return joe;
    }

    const baseMatch = {round, originalPlayerId: {$ne: playerId}};

    const [sameVersion] = await playerModel.aggregate([
        {$match: {...baseMatch, gameVersion: GAME_VERSION}},
        {$sample: {size: 1}},
    ]);
    if (sameVersion) return getPlayerSchemaObject(sameVersion);

    const [anyVersion] = await playerModel.aggregate([
        {$match: baseMatch},
        {$sample: {size: 1}},
    ]);
    if (anyVersion) return getPlayerSchemaObject(anyVersion);

    console.log('No player found for round', round, '— trying round', round - 1);
    return getSameRoundPlayer(round - 1, playerId);
}
