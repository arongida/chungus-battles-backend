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
});

export const dbPlayerSchema = mongoose.model('Player', PlayerSchema);

export async function getPlayer(playerId: number): Promise<Player> {
  const playerSchema = await dbPlayerSchema.findOne({ playerId: playerId }).lean().select({ _id: 0, __v: 0 });
  return playerSchema as unknown as Player;
}

export async function createNewPlayer(playerId: number, name: string, sessionId: string): Promise<Player> {
  const newPlayer = new Player({
    playerId: playerId,
    name: name,
    hp: 100,
    attack: 10,
    gold: 10,
    xp: 0,
    level: 1,
    sessionId: sessionId,
    defense: 0,
    attackSpeed: 1,
    maxXp: 12,
    round: 1
  });
  await dbPlayerSchema.create(newPlayer).catch((err) => console.error(err));
  return newPlayer;
}

export async function updatePlayer(player: Player): Promise<Player> {
  await dbPlayerSchema.updateOne({ playerId: player.playerId }, player).catch((err) => console.error(err));
  return player;
}

export async function getNextPlayerId(): Promise<number> {
  const lastPlayer = await dbPlayerSchema.findOne().sort({ playerId: -1 }).limit(1).lean();
  return lastPlayer ? lastPlayer.playerId + 1 : 1;
}

export async function getSameRoundPlayer(round: number): Promise<Player> {
  //const playerSchema = await dbPlayerSchema.find({ round: round }).lean().select({ _id: 0, __v: 0 });
  const randomPlayerWithSameTurn = await dbPlayerSchema.aggregate([{ $match: { round: round } }, { $sample: { size: 1 } }]);
  const enemyPlayerObject = randomPlayerWithSameTurn[0];
  console.log("enemyPlayerObject", enemyPlayerObject);
  return enemyPlayerObject as unknown as Player;
}