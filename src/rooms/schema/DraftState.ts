import { Schema, Context, type, ArraySchema } from "@colyseus/schema";
import { Player } from "./PlayerSchema";



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
  @type("number") shopSize: number = 5;
}



