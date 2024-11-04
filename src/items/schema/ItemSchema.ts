import { Schema, type, ArraySchema } from '@colyseus/schema';
import { IStats } from '../../common/types';

export class AffectedStats extends Schema implements IStats {
  @type('number') hp: number = 0;
  @type('number') attack: number = 0;
  @type('number') defense: number = 0;
  @type('number') attackSpeed: number = 0;
  @type('number') income: number = 0;
  @type('number') hpRegen: number = 0;
}
export class Item extends Schema {
  @type('number') itemId: number;
  @type('string') name: string;
  @type('string') description: string;
  @type('number') price: number = 100;
  @type(AffectedStats) affectedStats: AffectedStats;
  @type('number') tier: number;
  @type('string') image: string;
  @type(['string']) tags: ArraySchema<string>;
  @type('boolean') sold: boolean = false;
  @type(['number']) itemCollections: number[];
}
