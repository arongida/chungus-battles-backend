import { Schema, Context, type, ArraySchema } from "@colyseus/schema";

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

export class Item extends Schema {
  @type("number") itemId: number;
  @type("string") name: string;
  @type("string") description: string;
  @type("number") price: number;
  @type("string") affectedStat: string;
  @type("number") affectedValue: number;
}



export class DraftState extends Schema {
  @type(Player) player: Player = new Player();
  @type([Item]) shop: ArraySchema<Item> = new ArraySchema<Item>();
  @type("number") shopSize: number = 3;
}



