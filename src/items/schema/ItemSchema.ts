import { Schema, type, ArraySchema, SetSchema } from '@colyseus/schema';
import {AffectedStats} from "../../common/schema/AffectedStatsSchema";
import {ItemBehaviors} from '../behavior/ItemBehaviors';
import {BehaviorContext} from '../../common/BehaviorContext';
import {ItemBehaviorContext} from '../behavior/ItemBehaviorContext';


export class Item extends Schema {
  @type('number') itemId: number = 0;
  @type('string') name: string = 'Missing';
  @type('string') description: string;
  @type('number') price: number = 0;
  @type(AffectedStats) affectedStats: AffectedStats;
  @type(AffectedStats) setBonusStats: AffectedStats;
  @type('boolean') setActive: boolean = false;
  @type('number') tier: number;
  @type('number') rarity: number = 1;
  @type('string') image: string;
  @type(['string']) tags: ArraySchema<string>;
  @type('boolean') sold: boolean = false;
  @type('boolean') equipped: boolean = false;
  @type(['number']) itemCollections: number[];
  @type('string') type: string;
  @type('string') set: string;
  @type(['string']) equipOptions: SetSchema<string>;
  @type('boolean') showDetails: boolean = false;
  @type('number') baseMinDamage: number = 0;
  @type('number') baseMaxDamage: number = 0;
  @type('number') baseAttackSpeed: number = 0;
  @type(['string']) triggerTypes: ArraySchema<string> = new ArraySchema<string>();
  @type(AffectedStats) affectedEnemyStats: AffectedStats;

  executeBehavior(context: BehaviorContext) {
    const behavior = ItemBehaviors[this.itemId];
    if (behavior) {
      const itemContext: ItemBehaviorContext = { ...context, item: this };
      behavior(itemContext);
    }
  }
}