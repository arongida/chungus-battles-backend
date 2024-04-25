import { Schema, type, ArraySchema } from "@colyseus/schema";

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
  @type("number") round: number;
  @type("number") lives: number;
  @type("number") wins: number;
  @type(["number"]) talentIds: ArraySchema<number> = new ArraySchema<number>();
}