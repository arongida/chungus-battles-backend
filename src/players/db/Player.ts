import mongoose, { Schema } from 'mongoose';
import { Player } from '../../players/schema/PlayerSchema';

const PlayerSchema = new Schema({
	playerId: Number,
	name: String,
	hp: { type: Number, alias: '_hp' },
	attack: { type: Number, alias: '_attack' },
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
	talents: [Number],
	equippedItems: [Number],
	inventory: [Number],
	income: Number,
	hpRegen: Number,
});

export const playerModel = mongoose.model('Player', PlayerSchema);

export async function getPlayer(playerId: number): Promise<Player> {
	const playerSchema = await playerModel.findOne({ playerId: playerId }).lean().select({ _id: 0, __v: 0 });

	return playerSchema as unknown as Player;
}

export async function createNewPlayer(
	playerId: number,
	name: string,
	sessionId: string,
	avatarUrl: string
): Promise<Player> {
	const startingGold = process.env.NODE_ENV === 'production' ? 10 : 1000;
	const newPlayer = new playerModel({
		playerId: playerId,
		name: name,
		hp: 100,
		attack: 10,
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
    equippedItems: [],
		income: 0,
		hpRegen: 0,
	});
	await newPlayer.save().catch((err) => console.error(err));
	return newPlayer.toObject() as unknown as Player;
}

export async function copyPlayer(player: Player): Promise<Player> {
	let playerObject = player.toJSON();
	let newPlayerObject = {
		...playerObject,
		talents: [0],
		inventory: [0],
    equippedItems: [0],
	};
	newPlayerObject = {
		...playerObject,
		talents: [],
		inventory: [],
    equippedItems: [],
		playerId: await getNextPlayerId(),
	};

	const newPlayer = new playerModel(newPlayerObject);

	playerObject.talents.forEach((talent) => {
		newPlayer.talents.push(talent.talentId);
	});

	playerObject.inventory.forEach((item) => {
		newPlayer.inventory.push(item.itemId);
	});

  playerObject.equippedItems.forEach((item) => {
		newPlayer.equippedItems.push(item.itemId);
	});

	await newPlayer.save().catch((err) => console.error(err));
	return newPlayer.toObject() as unknown as Player;
}

export async function updatePlayer(player: Player): Promise<Player> {
	let playerObject = player.toJSON();
	let newPlayerObject = { ...playerObject, talents: [0], inventory: [0], equippedItems: [0] };
	newPlayerObject = { ...playerObject, talents: [], inventory: [], equippedItems: [] };

	const foundPlayerModel = await playerModel.findOne({
		playerId: player.playerId,
	});

	foundPlayerModel.set(newPlayerObject);

	playerObject.talents.forEach((talent) => {
		foundPlayerModel.talents.push(talent.talentId);
	});
	playerObject.equippedItems.forEach((item) => {
		foundPlayerModel.equippedItems.push(item.itemId);
	});
	playerObject.inventory.forEach((item) => {
		foundPlayerModel.inventory.push(item.itemId);
	});

  console.log('Updating player with talents: ', foundPlayerModel.talents);

	await foundPlayerModel.save().catch((err) => console.error(err));
	return player;
}

export async function getNextPlayerId(): Promise<number> {
	const lastPlayer = await playerModel.findOne().sort({ playerId: -1 }).limit(1).lean();
	return lastPlayer ? lastPlayer.playerId + 1 : 1;
}

export async function getTopPlayers(number: number): Promise<Player[]> {
	const topPlayers = await playerModel.find().sort({ wins: -1 }).limit(number).lean();
	return topPlayers as unknown as Player[];
}

export async function getPlayerRank(playerId: number): Promise<number> {
	const player = await playerModel.findOne({ playerId: playerId }).lean();
	const rank = await playerModel.countDocuments({ wins: { $gte: player.wins } });
	return rank + 1;
}

export async function getHighestWin(): Promise<number> {
	const highestWinPlayer = await playerModel.findOne().sort({ wins: -1 }).limit(1).lean();
	return highestWinPlayer.wins;
}

export async function getSameRoundPlayer(round: number, playerId: number): Promise<Player> {
	if (round <= 0) {
		return null;
	}

	const randomPlayerWithSameTurn = await playerModel.aggregate([
		{ $match: { round: round, playerId: { $ne: playerId } } },
		{ $sample: { size: 1 } },
	]);
	const [enemyPlayerObject] = randomPlayerWithSameTurn;
	if (!enemyPlayerObject) {
		return await getSameRoundPlayer(round - 1, playerId);
	}
	return enemyPlayerObject as unknown as Player;
}
