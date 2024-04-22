import { Schema, Context, type, ArraySchema } from "@colyseus/schema";
import { Player } from "./PlayerSchema";
import { Item } from "./ItemSchema";

export class DraftState extends Schema {
  @type(Player) player: Player = new Player();
  @type([Item]) shop: ArraySchema<Item> = new ArraySchema<Item>();
  @type("number") shopSize: number = 5;
}



