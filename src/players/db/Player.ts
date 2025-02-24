import mongoose, { Schema } from 'mongoose';
import { Player } from '../schema/PlayerSchema';
import {Item} from '../../items/schema/ItemSchema';
import {ItemSchema} from "../../items/db/Item";
import {TalentSchema} from "../../talents/db/Talent";
import {Talent} from "../../talents/schema/TalentSchema";
import {ArraySchema, MapSchema} from "@colyseus/schema";
import {StatsSchema} from "../../common/db/Stats";
import {AffectedStats} from "../../common/schema/AffectedStatsSchema";


const PlayerSchema = new Schema({
	playerId: Number,
	originalPlayerId: Number,
	name: String,
	gold: { type: Number, alias: '_gold' },
	xp: Number,
	level: { type: Number, alias: '_level' },
	sessionId: String,
	maxXp: Number,
	round: Number,
	lives: Number,
	wins: Number,
	avatarUrl: String,
	talents: [TalentSchema],
	inventory: [ItemSchema],
	baseStats: StatsSchema,
	equippedItems: {type: Map, of: ItemSchema},
});

export const playerModel = mongoose.model('Player', PlayerSchema);

export async function getPlayer(playerId: number): Promise<Player> {
	const playerSchema = await playerModel.findOne({ playerId: playerId }).lean().select({ _id: 0, __v: 0 });

	return playerSchema ? getPlayerSchemaObject(playerSchema) : null;
}

function getPlayerSchemaObject(playerFromDb: Object): Player {
	const newPlayerSchemaObject = new Player().assign(playerFromDb);
	newPlayerSchemaObject.baseStats = new AffectedStats().assign(newPlayerSchemaObject.baseStats);

	const newPlayerEquippedItemsMapSchema = new MapSchema();
	newPlayerSchemaObject.equippedItems.forEach((item, key) => {
		const itemSchemaObject = new Item().assign(item);
		itemSchemaObject.affectedStats = new AffectedStats().assign(item.affectedStats);
		itemSchemaObject.setBonusStats = new AffectedStats().assign(item.setBonusStats);
		newPlayerEquippedItemsMapSchema.set(key, itemSchemaObject);
	})
	newPlayerSchemaObject.equippedItems = newPlayerEquippedItemsMapSchema;

	const newPlayerTalentArraySchema = new ArraySchema();
	newPlayerSchemaObject.talents.map((talent) => {
		const talentSchemaObject = new Talent().assign(talent);
		talentSchemaObject.affectedStats = new AffectedStats().assign(talent.affectedStats);
		talentSchemaObject.affectedEnemyStats = new AffectedStats().assign(talent.affectedEnemyStats);
		newPlayerTalentArraySchema.push(talentSchemaObject);
	})
	newPlayerSchemaObject.talents = newPlayerTalentArraySchema;


	const newPlayerInventoryArraySchema = new ArraySchema();
	newPlayerSchemaObject.inventory.map((item) => {
		const itemSchemaObject = new Item().assign(item);
		itemSchemaObject.affectedStats = new AffectedStats().assign(item.affectedStats);
		itemSchemaObject.setBonusStats = new AffectedStats().assign(item.setBonusStats);
		newPlayerInventoryArraySchema.push(itemSchemaObject);
	})
	newPlayerSchemaObject.inventory = newPlayerInventoryArraySchema;

	return newPlayerSchemaObject;
}

export async function createNewPlayer(
	playerId: number,
	name: string,
	sessionId: string,
	avatarUrl: string
): Promise<Player> {
	const startingGold = process.env.NODE_ENV === 'production' ? 6 : 1000;
	const newPlayer = new playerModel({
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
			defense: 10,
			attackSpeed: 0.8,
			flatDmgReduction: 0,
			dodgeRate: 0,
			income: 0,
			hpRegen: 0,
		}
	});
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
	const lastPlayer = await playerModel.findOne().sort({ playerId: -1 }).limit(1).lean().catch((e) => {
		console.error(e);
	});
	return lastPlayer ? lastPlayer.playerId + 1 : 1;
}

export async function getTopPlayers(number: number): Promise<Player[]> {
	const topPlayers = await playerModel
		.aggregate([
			{
				$sort: { wins: -1, originalPlayerId: -1, playerId: 1 }, // Sort by wins (descending) and then by _id (ascending) for stability
			},
			{
				$group: {
					_id: '$originalPlayerId',
					doc: { $first: '$$ROOT' }, // Keep the first (highest win) document per player
				},
			},
			{
				$replaceRoot: { newRoot: '$doc' }, // Replace root with selected document
			},
			{
				$sort: { wins: -1, originalPlayerId: -1, playerId: 1 }, // Re-sort to maintain order after grouping
			},
			{
				$limit: number, // Limit the number of results
			},
		])
		.exec();

	return topPlayers as unknown as Player[];
}

export async function getPlayerRank(playerId: number): Promise<number> {
	const player = await playerModel.findOne({ playerId: playerId }).lean();
	const rank = await playerModel.countDocuments({ wins: { $gt: player.wins } });
	return rank + 1;
}

export async function getHighestWin(): Promise<number> {
	const highestWinPlayer = await playerModel.findOne().sort({ wins: -1 }).limit(1).lean();
	return highestWinPlayer.wins;
}

export async function getSameRoundPlayer(round: number, playerId: number): Promise<Player> {
	if (round <= 0) {
		const defaultPlayerClone = await playerModel
			.findOne({ originalPlayerId: playerId, playerId: { $ne: playerId } })
			.lean();
		return defaultPlayerClone ? getPlayerSchemaObject(defaultPlayerClone) : null;
	}

	const randomPlayerWithSameTurn = await playerModel.aggregate([
		{ $match: { round: round, originalPlayerId: { $ne: playerId } } },
		{ $sample: { size: 1 } },
	]);
	const [enemyPlayerObject] = randomPlayerWithSameTurn;

	if (!enemyPlayerObject) {
		console.log('No player found for round', round);
		return await getSameRoundPlayer(round - 1, playerId);
	}
	return getPlayerSchemaObject(enemyPlayerObject);
}
