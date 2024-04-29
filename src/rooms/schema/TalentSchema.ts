import { Schema, type } from "@colyseus/schema";

export class Talent extends Schema {
  @type("number") talentId: number;
  @type("string") name: string;
  @type("string") description: string;
  @type("number") levelRequirement: number;
  @type("string") class: string;
  @type("number") level: number;
  @type("number") activationRate: number;
}