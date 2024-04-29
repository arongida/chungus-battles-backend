import { Schema, Context, type, ArraySchema } from "@colyseus/schema";
import { Player } from "./PlayerSchema";
import { Item } from "./ItemSchema";
import { Talent } from "./TalentSchema";

export class DraftState extends Schema {
  @type(Player) player: Player = new Player();
  @type([Item]) shop: ArraySchema<Item> = new ArraySchema<Item>();
  @type([Talent]) availableTalents: ArraySchema<Talent> = new ArraySchema<Talent>();
  @type("number") shopSize: number = 6;
}



