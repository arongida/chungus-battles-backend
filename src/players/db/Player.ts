import mongoose, {Schema} from 'mongoose';
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
    const { affectedStats, setBonusStats, tags, equipOptions, itemCollections, _id, __v, ...primitives } = itemFromDb;
    const item = new Item().assign(primitives);
    item.affectedStats = new AffectedStats().assign(affectedStats || {});
    item.setBonusStats = new AffectedStats().assign(setBonusStats || {});
    const tagsArr = new ArraySchema<string>();
    if (tags?.length) (tags as string[]).forEach(t => tagsArr.push(t));
    item.tags = tagsArr;
    const equipOptionsArr = new ArraySchema<string>();
    if (equipOptions?.length) (equipOptions as string[]).forEach(e => equipOptionsArr.push(e));
    (item as any).equipOptions = equipOptionsArr;
    const itemCollectionsArr = new ArraySchema<number>();
    if (itemCollections?.length) (itemCollections as number[]).forEach(c => itemCollectionsArr.push(c));
    (item as any).itemCollections = itemCollectionsArr;
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
        talents: [],
        inventory: [],
        activeItemCollections: [],
        equippedItems: {},
        baseStats: {
            strength: 3,
            accuracy: 1,
            maxHp: 100,
            defense: 0,
            attackSpeed: 0.8,
            flatDmgReduction: 0,
            dodgeRate: 0,
            income: 0,
            hpRegen: 0,
        }
    });
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
    return getPlayerSchemaObject(newPlayer.toObject());
}

export async function copyPlayer(player: Player): Promise<Player> {
    let playerObject = player.toJSON();

    const newPlayerObject = {
        ...playerObject,
        playerId: await getNextPlayerId(),
    };

    const newPlayer = new playerModel(newPlayerObject);


    await newPlayer.save().catch((err) => console.error(err));
    return getPlayerSchemaObject(newPlayer.toObject());
}

export async function updatePlayer(player: Player): Promise<Player> {
    let playerObject = player.toJSON();


    const foundPlayerModel = await playerModel.findOne({
        playerId: player.playerId,
    });

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

export async function getTopPlayers(number: number): Promise<Player[]> {
    const topPlayers = await playerModel
        .aggregate([
            {
                $sort: {wins: -1, originalPlayerId: -1, playerId: 1}, // Sort by wins (descending) and then by _id (ascending) for stability
            },
            {
                $group: {
                    _id: '$originalPlayerId',
                    doc: {$first: '$$ROOT'}, // Keep the first (highest win) document per player
                },
            },
            {
                $replaceRoot: {newRoot: '$doc'}, // Replace root with selected document
            },
            {
                $sort: {wins: -1, originalPlayerId: -1, playerId: 1}, // Re-sort to maintain order after grouping
            },
            {
                $limit: number, // Limit the number of results
            },
        ])
        .exec();

    return topPlayers as unknown as Player[];
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
    if (round === 1) {
        const avatarArray = Array.from(Object.values(PlayerAvatar));
        const roundOneBot = getNewPlayer(0, 'Joe', '',avatarArray[rollTheDice(0, 2)], 10 )
        const roundOneBotSchemaObject = getPlayerSchemaObject(roundOneBot.toObject())

        roundOneBotSchemaObject.baseStats.maxHp = 50;
        roundOneBotSchemaObject.baseStats.strength = 2;
        const weapon = await getItemById(81);

        roundOneBotSchemaObject.setItemEquipped(weapon, EquipSlot.MAIN_HAND);

        return roundOneBotSchemaObject;
    }

    if (round < 1) {
        const defaultPlayerClone = await playerModel
            .findOne({originalPlayerId: playerId, playerId: {$ne: playerId}})
            .lean();
        return defaultPlayerClone ? getPlayerSchemaObject(defaultPlayerClone) : null;
    }

    const randomPlayerWithSameTurn = await playerModel.aggregate([
        {$match: {round: round, originalPlayerId: {$ne: playerId}}},
        {$sample: {size: 1}},
    ]);
    const [enemyPlayerObject] = randomPlayerWithSameTurn;

    if (!enemyPlayerObject) {
        console.log('No player found for round', round);
        return await getSameRoundPlayer(round - 1, playerId);
    }
    return getPlayerSchemaObject(enemyPlayerObject);
}
