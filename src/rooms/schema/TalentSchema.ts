import { Schema, type, ArraySchema } from '@colyseus/schema';

export class Talent extends Schema {
  @type('number') talentId: number;
  @type('string') name: string;
  @type('string') description: string;
  @type('number') tier: number;
  @type('number') activationRate: number;
  @type('string') image: string;
  @type(['string']) tags: ArraySchema<string>;
}
