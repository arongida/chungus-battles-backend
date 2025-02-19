import mongoose, { Schema } from 'mongoose';
import { Player } from '../schema/PlayerSchema';
import {AffectedStats, Item} from '../../items/schema/ItemSchema';
import {ItemSchema} from "../../items/db/Item";
import {TalentSchema} from "../../talents/db/Talent";
import {Talent} from "../../talents/schema/TalentSchema";
import {ArraySchema} from "@colyseus/schema";

const PlayerSchema = new Schema({
	playerId: Number,
	originalPlayerId: Number,
	name: String,
	hp: { type: Number, alias: '_hp' },
	strength: { type: Number, alias: '_strength' },
	accuracy: { type: Number, alias: '_accuracy' },
	gold: { type: Number, alias: '_gold' },
	xp: Number,
	level: { type: Number, alias: '_level' },
	sessionId: String,
	defense: { type: Number, alias: '_defense' },
	attackSpeed: { type: Number, alias: '_attackSpeed' },
	maxXp: Number,
	round: Number,
	lives: Number,
	wins: Number,
	avatarUrl: String,
	talents: [TalentSchema],
	inventory: [ItemSchema],
	helmet: ItemSchema,
	armor: ItemSchema,
	mainHand: ItemSchema,
	offHand: ItemSchema,
	income: Number,
	hpRegen: Number,
	dodgeRate: Number,
	flatDmgReduction: Number,
});

export const playerModel = mongoose.model('Player', PlayerSchema);

export async function getPlayer(playerId: number): Promise<Player> {
	const playerSchema = await playerModel.findOne({ playerId: playerId }).lean().select({ _id: 0, __v: 0 });

	return playerSchema ? getPlayerSchemaObject(playerSchema) : null;
}

function getPlayerSchemaObject(playerFromDb: Object): Player {
	const newPlayerSchemaObject = new Player().assign(playerFromDb)
	newPlayerSchemaObject.helmet = new Item().assign(newPlayerSchemaObject.helmet);
	newPlayerSchemaObject.helmet.affectedStats = new AffectedStats().assign(newPlayerSchemaObject.helmet.affectedStats);
	newPlayerSchemaObject.armor = new Item().assign(newPlayerSchemaObject.armor);
	newPlayerSchemaObject.armor.affectedStats = new AffectedStats().assign(newPlayerSchemaObject.armor.affectedStats);
	newPlayerSchemaObject.mainHand = new Item().assign(newPlayerSchemaObject.mainHand);
	newPlayerSchemaObject.mainHand.affectedStats = new AffectedStats().assign(newPlayerSchemaObject.mainHand.affectedStats);
	newPlayerSchemaObject.offHand = new Item().assign(newPlayerSchemaObject.offHand);
	newPlayerSchemaObject.offHand.affectedStats = new AffectedStats().assign(newPlayerSchemaObject.offHand.affectedStats);

	const newPlayerTalentArraySchema = new ArraySchema();
	newPlayerSchemaObject.talents.map((talent) => {
		newPlayerTalentArraySchema.push(new Talent().assign(talent));
	})
	newPlayerSchemaObject.talents = newPlayerTalentArraySchema;

	const newPlayerInventoryArraySchema = new ArraySchema();
	newPlayerSchemaObject.inventory.map((item) => {
		const itemSchemaObject = new Item().assign(item);
		itemSchemaObject.affectedStats = new AffectedStats().assign(item.affectedStats);
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
		hp: 100,
		strength: 3,
		accuracy: 0,
		gold: startingGold,
		xp: 0,
		level: 1,
		sessionId: sessionId,
		defense: 10,
		attackSpeed: 0.8,
		maxXp: 12,
		round: 1,
		lives: 3,
		wins: 0,
		avatarUrl: avatarUrl,
		talents: [],
		inventory: [],
		mainHand: {},
		offHand: {},
		armor: {},
		helmet: {},
		income: 0,
		hpRegen: 0,
		dodgeRate: 0,
		flatDmgReduction: 0,
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
	const lastPlayer = await playerModel.findOne().sort({ playerId: -1 }).limit(1).lean();
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
