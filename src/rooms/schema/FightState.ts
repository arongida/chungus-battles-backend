import { Schema, Context, type } from "@colyseus/schema";
import { Player } from "./PlayerSchema";

export class FightState extends Schema {

  @type(Player) player: Player = new Player();
  @type(Player) enemy: Player = new Player();
}
