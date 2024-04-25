import mongoose, { Document, Schema } from 'mongoose';
import { Player } from '../rooms/schema/PlayerSchema';

const PlayerSchema = new Schema({
  playerId: Number,
  name: String,
  hp: Number,
  attack: Number,
  gold: Number,
  xp: Number,
  level: Number,
  sessionId: String,
  defense: Number,
  attackSpeed: Number,
  maxXp: Number,
  round: Number,
  lives: Number,
  wins: Number,
  talentIds: [Number]
});

export const playerModel = mongoose.model('Player', PlayerSchema);

export async function getPlayer(playerId: number): Promise<Player> {
  const playerSchema = await playerModel.findOne({ playerId: playerId }).lean().select({ _id: 0, __v: 0 });
  return playerSchema as unknown as Player;
}

export async function createNewPlayer(playerId: number, name: string, sessionId: string): Promise<Player> {
  const newPlayer = new playerModel({
    playerId: playerId,
    name: name,
    hp: 100,
    attack: 10,
    gold: 100,
    xp: 0,
    level: 1,
    sessionId: sessionId,
    defense: 0,
    attackSpeed: 1,
    maxXp: 12,
    round: 1,
    lives: 3,
    wins: 0,
    talentIds: []
  });
  await newPlayer.save().catch((err) => console.error(err));
  return newPlayer.toObject() as unknown as Player;
}

export async function updatePlayer(player: Player): Promise<Player> {
  let playerObject = player.toJSON();
  await playerModel.findOneAndUpdate({ playerId: player.playerId }, playerObject).catch((err) => console.error(err));
  return player;
}

export async function getNextPlayerId(): Promise<number> {
  const lastPlayer = await playerModel.findOne().sort({ playerId: -1 }).limit(1).lean();
  return lastPlayer ? lastPlayer.playerId + 1 : 1;
}

export async function getSameRoundPlayer(round: number): Promise<Player> {

  if (round <= 0) {
    return null;
  }

  const randomPlayerWithSameTurn = await playerModel.aggregate([{ $match: { round: round } }, { $sample: { size: 1 } }]);
  const [enemyPlayerObject] = randomPlayerWithSameTurn;
  if (!enemyPlayerObject) {
    return await getSameRoundPlayer(round - 1);
  }
  return enemyPlayerObject as unknown as Player;
}