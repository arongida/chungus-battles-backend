import { Schema, Context, type } from "@colyseus/schema";

export class Player extends Schema {
  @type("number") playerId: number;
  @type("string") name: string;
  @type("number") hp: number;
  @type("number") attack: number;
  @type("number") gold: number;
  @type("number") xp: number;
  @type("number") level: number;
  @type("string") sessionId: string;
  @type("number") defense: number;
  @type("number") attackSpeed: number;
  @type("number") maxXp: number;
}

export class FightState extends Schema {

  @type(Player) player: Player = new Player();
  @type(Player) enemy: Player = new Player();

}
