import { Schema, type, ArraySchema, SetSchema } from '@colyseus/schema';
import {AffectedStats} from "../../common/schema/AffectedStatsSchema";


export class Item extends Schema {
  @type('number') itemId: number;
  @type('string') name: string;
  @type('string') description: string;
  @type('number') price: number;
  @type(AffectedStats) affectedStats: AffectedStats;
  @type('number') tier: number;
  @type('string') image: string;
  @type(['string']) tags: ArraySchema<string>;
  @type('boolean') sold: boolean = false;
  @type('boolean') equipped: boolean = false;
  @type(['number']) itemCollections: number[];
  @type('string') type: string;
  @type(['string']) equipOptions: SetSchema<string>;
}