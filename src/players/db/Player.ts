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
import {rollItemStats} from "../../items/stats/itemStatRoller";
import {PlayerAvatar} from "../types/PlayerTypes";
import {GAME_VERSION, WINS_TO_WIN} from "../../common/types";
import {recalculatePlayerStats} from "../../common/statsUtils";


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
    losses: {type: Number, default: 0},
    avatarUrl: String,
    gameVersion: Number,
    talents: [TalentSchema],
    inventory: [ItemSchema],
    lockedShop: [ItemSchema],
    baseStats: StatsSchema,
    equippedItems: {type: Map, of: ItemSchema},
    // Locked-in next-fight opponent (Next-Enemy Preview). Persisted via the targeted
    // setNextFightEnemy() $set only — deliberately NOT part of playerToPlainObject/
    // snapshotPlayer so matchmaking snapshots never carry a stale enemy pointer.
    nextFightEnemyId: Number,
    nextFightEnemyRound: Number,
    pendingRegenBuff: {type: Number, default: 0},
    // Permanent Lucky Find snowball bonus (see PlayerSchema.luckyFindMythicBonus) — persisted
    // normally, unlike pendingRegenBuff it is NOT reset in copyPlayer since it only affects the
    // owner's own future shop rolls, never an opponent-bot snapshot's fight stats.
    luckyFindMythicBonus: {type: Number, default: 0},
    // "Runs ended" leaderboard stat: how many other characters' final loss this character
    // delivered. Mutated ONLY via incrementRunsEnded's targeted $inc on the killer's original
    // doc — deliberately excluded from playerToPlainObject so a concurrent live save from the
    // killer's own session can never clobber it.
    runsEnded: {type: Number, default: 0},
    // This character's nemesis — the enemy that dealt their final game-over hit. Set once in
    // FightRoom.handleLoose, persisted normally via playerToPlainObject/updatePlayer.
    killedByPlayerId: Number,
    killedByOriginalPlayerId: Number,
    killedByName: String,
});

// Backs the wall-of-fame aggregation sorts ({$sort: {wins:-1, originalPlayerId:-1, playerId:1}})
// so they run index-backed instead of blocking-sorting the whole collection in memory.
PlayerSchema.index({ wins: -1, originalPlayerId: -1, playerId: 1 });
// Backs the "All Characters" leaderboard recency sort ({$sort: {playerId:-1}}) and getNextPlayerId's
// findOne().sort({playerId:-1}) — without it those blocking-sort the whole collection and exceed the 32MB sort limit.
PlayerSchema.index({ playerId: -1 });

export const playerModel = mongoose.model('Player', PlayerSchema);

export async function getPlayer(playerId: number): Promise<Player> {
    const playerSchema = await playerModel.findOne({playerId: playerId}).lean().select({_id: 0, __v: 0});

    return playerSchema ? getPlayerSchemaObject(playerSchema) : null;
}

function buildItemSchema(itemFromDb: any): Item {
    const { affectedStats, affectedEnemyStats, tags, equipOptions, itemCollections, triggerTypes, _id, __v, ...primitives } = itemFromDb;
    const item = new Item().assign(primitives);
    if (!item.sellPrice) item.sellPrice = Math.floor(item.price * item.rarity * 0.7);
    item.affectedStats = new AffectedStats().assign(affectedStats || {});
    item.affectedEnemyStats = new AffectedStats().assign(affectedEnemyStats || {});
    const tagsArr = new ArraySchema<string>();
    if (tags?.length) (tags as string[]).forEach(t => tagsArr.push(t));
    item.tags = tagsArr;
    const equipOptionsArr = new ArraySchema<string>();
    let equipOptionsList: string[] = [];
    if (typeof equipOptions === 'string') {
        try { equipOptionsList = JSON.parse(equipOptions); } catch {}
    } else if (Array.isArray(equipOptions)) {
        equipOptionsList = equipOptions;
    }
    equipOptionsList.forEach(e => equipOptionsArr.push(e));
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
    const startingLevel = avatarUrl === PlayerAvatar.THIEF ? 2 : 1;
    return new playerModel({
        playerId: playerId,
        originalPlayerId: playerId,
        name: name,
        gold: startingGold,
        xp: 0,
        level: startingLevel,
        sessionId: sessionId,
        maxXp: avatarUrl === PlayerAvatar.THIEF ? 15 : 10,
        round: 1,
        lives: avatarUrl === PlayerAvatar.WARRIOR ? 4 : 3,
        wins: 0,
        losses: 0,
        avatarUrl: avatarUrl,
        gameVersion: GAME_VERSION,
        talents: [],
        inventory: [],
        activeItemCollections: [],
        equippedItems: {},
        baseStats: {
            strength: 3,
            accuracy: 1,
            // +10 max HP per level, matching DraftRoom.levelUp (Season 17)
            maxHp: 100 + (startingLevel - 1) * 10,
            defense: 0,
            // Thief starts at level 2, so it must already have its free level's class bonus baked in (Season 18)
            attackSpeed: avatarUrl === PlayerAvatar.THIEF ? 1.2 : 1,
            dodgeRate: avatarUrl === PlayerAvatar.THIEF ? 10 : 0,
            income: avatarUrl === PlayerAvatar.MERCHANT ? 7 : 4,
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
        rollItemStats(defaultWeapon);
        playerSchema.inventory.push(defaultWeapon);
        playerSchema.setItemEquipped(defaultWeapon, EquipSlot.MAIN_HAND);
        if (defaultWeapon.itemId === 68) playerSchema.gold += 3;
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
        // This snapshot is only ever read back as a future opponent bot — it never plays through
        // its own FightRoom.handleFightEnd, so a banked Health Flask regen buff would otherwise
        // leak in permanently and grant free regen every time this snapshot is drawn as an enemy.
        pendingRegenBuff: 0,
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

// Credits the killer's canonical (original) document. runsEnded lives ONLY here + is read via
// $max in the leaderboard aggregation; it is deliberately never written through
// playerToPlainObject, so a concurrent updatePlayer() from the killer's own live session can't
// clobber this increment.
export async function incrementRunsEnded(killerOriginalPlayerId: number): Promise<void> {
    if (killerOriginalPlayerId === undefined || killerOriginalPlayerId === null) return;
    if (killerOriginalPlayerId === JOE_PLAYER_ID) return; // round-1 bot isn't persisted
    await playerModel.updateOne({playerId: killerOriginalPlayerId}, {$inc: {runsEnded: 1}})
        .catch(err => console.error('[incrementRunsEnded]', err));
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
    const { _id, __v, affectedStats, affectedEnemyStats, ...rest } = item;
    return {
        ...rest,
        affectedStats: cleanRawObj(affectedStats),
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
    const { _id, __v, latestPlayerId, equippedItems, inventory, talents, lockedShop, baseStats, ...rest } = doc;
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
        losses: player.losses,
        avatarUrl: player.avatarUrl,
        gameVersion: player.gameVersion,
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
        pendingRegenBuff: player.pendingRegenBuff,
        luckyFindMythicBonus: player.luckyFindMythicBonus,
        killedByPlayerId: player.killedByPlayerId,
        killedByOriginalPlayerId: player.killedByOriginalPlayerId,
        killedByName: player.killedByName,
        baseStats: player.baseStats?.toJSON() || {},
        equippedItems,
        inventory: player.inventory.map(item => item.toJSON()),
        talents: player.talents.map(talent => talent.toJSON()),
        lockedShop: player.lockedShop.map(item => item.toJSON()),
    };
}

export function snapshotPlayer(player: Player): Record<string, any> {
    const equippedItems: Record<string, any> = {};
    player.equippedItems.forEach((item, slot) => {
        equippedItems[slot] = item.toJSON();
    });
    return {
        playerId: player.playerId,
        originalPlayerId: player.originalPlayerId,
        name: player.name,
        avatarUrl: player.avatarUrl,
        gold: player.gold,
        level: player.level,
        xp: player.xp,
        maxXp: player.maxXp,
        round: player.round,
        lives: player.lives,
        wins: player.wins,
        losses: player.losses,
        hp: player.hp,
        maxHp: player.maxHp,
        strength: player.strength,
        accuracy: player.accuracy,
        defense: player.defense,
        attackSpeed: player.attackSpeed,
        dodgeRate: player.dodgeRate,
        hpRegen: player.hpRegen,
        income: player.income,
        refreshShopCost: player.refreshShopCost,
        gameVersion: player.gameVersion,
        baseStats: player.baseStats?.toJSON() || {},
        equippedItems,
        inventory: player.inventory.map(item => item.toJSON()),
        talents: player.talents.map(talent => talent.toJSON()),
        lockedShop: player.lockedShop.map(item => item.toJSON()),
    };
}

// $top instead of $sort + $first: a pre-group sort has no supporting index, and the
// prod Atlas shared tier caps in-memory sorts at 32MB and ignores allowDiskUse.
const TOP_PLAYERS_AGGREGATION: PipelineStage[] = [
    {$group: {
        _id: '$originalPlayerId',
        // each character's best/final snapshot (wins never decrease, so this is the live/original doc)
        doc: {$top: {sortBy: {wins: -1, round: -1, playerId: -1}, output: '$$ROOT'}},
        latestPlayerId: {$max: '$playerId'},
        // ObjectId embeds its creation time, and a fresh snapshot doc is written each round,
        // so the newest snapshot's _id timestamp is this character's "last played" time.
        lastPlayedAt: {$max: {$toDate: '$_id'}},
        // runsEnded is only ever incremented on the character's original doc (see
        // incrementRunsEnded), but $top above may have picked a different round's snapshot as
        // `doc` — take the max across every snapshot so the count always shows up.
        runsEnded: {$max: '$runsEnded'},
    }},
    {$addFields: {
        'doc.latestPlayerId': '$latestPlayerId',
        'doc.lastPlayedAt': '$lastPlayedAt',
        'doc.runsEnded': {$ifNull: ['$runsEnded', 0]},
    }},
    {$replaceRoot: {newRoot: '$doc'}},
    {$sort: {latestPlayerId: -1}},                             // final order: most-recently-active character first
];

export interface LeaderboardFilters {
    limit?: number;
    skip?: number;
    gameVersion?: number;
    name?: string;
    avatar?: string;
    minRound?: number;
    level?: number;
    minWins?: number;
    rankForOriginalPlayerId?: number;
}

function buildMatchConditions(filters: LeaderboardFilters): Record<string, any> {
    const match: Record<string, any> = {};
    if (filters.gameVersion !== undefined) match.gameVersion = filters.gameVersion;
    if (filters.name) match.name = { $regex: filters.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    if (filters.avatar) match.avatarUrl = filters.avatar;
    if (filters.minRound !== undefined) match.round = { $gte: filters.minRound };
    if (filters.level !== undefined) match.level = filters.level;
    if (filters.minWins !== undefined) match.wins = { $gte: filters.minWins };
    return match;
}

export async function getLeaderboard(filters: LeaderboardFilters = {}): Promise<{ players: Record<string, any>[]; total: number; userRank: number | null }> {
    const { limit = 20, skip = 0, rankForOriginalPlayerId } = filters;
    const clampedLimit = Math.min(Math.max(1, limit), 100);

    const matchConditions = buildMatchConditions(filters);
    const matchStage = Object.keys(matchConditions).length ? [{ $match: matchConditions }] : [];

    const pipeline: any[] = [
        ...matchStage,
        ...TOP_PLAYERS_AGGREGATION,
        { $facet: {
            players: [{ $skip: skip }, { $limit: clampedLimit }],
            totalCount: [{ $count: 'n' }],
        }},
    ];

    const [result] = await playerModel.aggregate(pipeline).allowDiskUse(true).exec();

    let userRank: number | null = null;
    if (rankForOriginalPlayerId) {
        // Find this player's latest snapshot in the filtered set (its playerId = the dedupe's latestPlayerId recency key)
        const [userDoc] = await playerModel.aggregate([
            ...matchStage,
            { $match: { originalPlayerId: rankForOriginalPlayerId } },
            { $sort: { playerId: -1 } },
            { $limit: 1 },
        ]).allowDiskUse(true).exec();

        if (userDoc) {
            // Count deduped players that sort strictly above this player (more recently active = higher latestPlayerId)
            const [countResult] = await playerModel.aggregate([
                ...matchStage,
                ...TOP_PLAYERS_AGGREGATION,
                { $match: { latestPlayerId: { $gt: userDoc.playerId } } },
                { $count: 'n' },
            ]).allowDiskUse(true).exec();
            userRank = (countResult?.n ?? 0) + 1;
        }
    }

    return {
        players: (result?.players ?? []).map(cleanRawPlayerDoc),
        total: result?.totalCount?.[0]?.n ?? 0,
        userRank,
    };
}

export async function getPlayerRank(playerId: number): Promise<number> {
    const player = await playerModel.findOne({playerId: playerId}).lean();
    const rank = await playerModel.countDocuments({wins: {$gt: player.wins}});
    return rank + 1;
}

/** "Wall of Fame": finished (12-win) characters ranked by most runs ended, most recent first.
 *  gameVersion >= 16 + losses field presence excludes pre-Season-16 record-chasing
 *  snapshots that could otherwise have wins >= WINS_TO_WIN from an old, different win condition.
 *  Pass `season` to scope the wall to one specific season (exact gameVersion match); omit it
 *  (or pass undefined) to show all seasons since Wall of Fame was introduced. */
export async function getWallOfFame({ limit = 20, skip = 0, season }: { limit?: number; skip?: number; season?: number } = {}):
    Promise<{ players: Record<string, any>[]; total: number }> {
    const clampedLimit = Math.min(Math.max(1, limit), 100);

    const pipeline: PipelineStage[] = [
        { $match: { gameVersion: season !== undefined ? season : { $gte: 16 }, wins: { $gte: WINS_TO_WIN }, losses: { $exists: true } } },
        // Dedupe insurance: exactly one >=12-win doc per character is expected, but keep
        // the best (fewest-losses) doc per originalPlayerId in case of a double-save.
        { $sort: { losses: 1, wins: -1, playerId: 1 } },
        { $group: {
            _id: '$originalPlayerId',
            doc: { $first: '$$ROOT' },
            // Same reasoning as TOP_PLAYERS_AGGREGATION: runsEnded is only incremented on the
            // character's original doc, which may not be the $first-picked doc here.
            runsEnded: { $max: '$runsEnded' },
            // ObjectId embeds its creation time; take the max across every snapshot so
            // this reflects the character's most recent activity, not just the $first-picked doc.
            lastPlayedAt: { $max: { $toDate: '$_id' } },
        } },
        { $addFields: { 'doc.runsEnded': { $ifNull: ['$runsEnded', 0] }, 'doc.lastPlayedAt': '$lastPlayedAt' } },
        { $replaceRoot: { newRoot: '$doc' } },
        { $sort: { runsEnded: -1, lastPlayedAt: -1, originalPlayerId: -1 } },
        { $facet: {
            players: [{ $skip: skip }, { $limit: clampedLimit }],
            totalCount: [{ $count: 'n' }],
        }},
    ];

    const [result] = await playerModel.aggregate(pipeline).allowDiskUse(true).exec();

    return {
        players: (result?.players ?? []).map(cleanRawPlayerDoc),
        total: result?.totalCount?.[0]?.n ?? 0,
    };
}

export const JOE_PLAYER_ID = 0;

export async function buildJoe(forPlayerId: number): Promise<Player> {
    const avatarArray = Array.from(Object.values(PlayerAvatar));
    // Deterministic (not random) so the draft preview and the fight show the same portrait —
    // the live player's playerId is stable across the whole run.
    const joeModel = getNewPlayer(JOE_PLAYER_ID, 'Joe', '', avatarArray[Math.abs(forPlayerId) % 3], 10);
    const joe = getPlayerSchemaObject(joeModel.toObject());
    joe.baseStats.maxHp = 50;
    joe.baseStats.strength = 2;
    const weapon = await getItemById(81);
    joe.setItemEquipped(weapon, EquipSlot.MAIN_HAND);
    // Rooms recompute synced stats every tick (UpdateStatsCommand), but the draft preview is a
    // plain copy — compute Joe's final stats here (50/50 HP incl. weapon bonuses) the same way
    // the fight room later will, so preview and fight always agree.
    recalculatePlayerStats(joe);
    return joe;
}

export async function setNextFightEnemy(playerId: number, enemyId: number, round: number) {
    await playerModel.updateOne({ playerId }, { $set: { nextFightEnemyId: enemyId, nextFightEnemyRound: round } });
}

export async function getSameRoundPlayer(round: number, playerId: number): Promise<Player> {
    if (round < 1) {
        const defaultPlayerClone = await playerModel
            .findOne({originalPlayerId: playerId, playerId: {$ne: playerId}})
            .lean();
        return defaultPlayerClone ? getPlayerSchemaObject(defaultPlayerClone) : null;
    }

    if (round === 1) {
        return buildJoe(playerId);
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
