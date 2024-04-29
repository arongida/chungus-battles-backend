import { Schema, type } from "@colyseus/schema";

export class Item extends Schema {
  @type("number") itemId: number;
  @type("string") name: string;
  @type("string") description: string;
  @type("number") price: number;
  @type("string") affectedStat: string;
  @type("number") affectedValue: number;
  @type("number") levelRequirement: number;
}