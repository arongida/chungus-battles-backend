import { Schema, type, ArraySchema } from '@colyseus/schema';

export class AffectedStats extends Schema {
  @type('number') hp: number;
  @type('number') attack: number;
  @type('number') defense: number;
  @type('number') attackSpeed: number;
}
export class Item extends Schema {
  @type('number') itemId: number;
  @type('string') name: string;
  @type('string') description: string;
  @type('number') price: number;
  @type(AffectedStats) affectedStats: AffectedStats;
  @type('number') levelRequirement: number;
  @type('string') image: string;
  @type(['string']) tags: ArraySchema<string>;
}
