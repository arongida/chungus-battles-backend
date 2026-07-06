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
  @type('number') sellPrice: number = 0;
  @type(AffectedStats) affectedStats: AffectedStats;
  @type('number') tier: number;
  @type('number') rarity: number = 1;
  @type('string') image: string;
  @type(['string']) tags: ArraySchema<string>;
  @type('boolean') sold: boolean = false;
  @type('boolean') equipped: boolean = false;
  @type(['number']) itemCollections: number[];
  @type('string') type: string;
  @type('string') class: string;
  @type(['string']) equipOptions: SetSchema<string>;
  @type('boolean') showDetails: boolean = false;
  @type('number') baseMinDamage: number = 0;
  @type('number') baseMaxDamage: number = 0;
  @type('number') baseAttackSpeed: number = 0;
  @type('number') strengthScaling: number = 1;
  @type(['string']) triggerTypes: ArraySchema<string> = new ArraySchema<string>();
  @type(AffectedStats) affectedEnemyStats: AffectedStats;
  // True only for shop slots that upgrade an item the player already owns.
  @type('boolean') upgradePreview: boolean = false;
  // True for shop slots that rolled a lucky-find rarity-up (see applyLuckyShopUpgrades).
  @type('boolean') luckyFind: boolean = false;
  // Server-only, not synced: Gold Genie (TalentBehaviors.ts) rolls its post-Legendary lucky-find
  // chance exactly once per shop slot — this latches that so repeat aura ticks don't re-roll it.
  goldGenieLuckyRolled: boolean = false;

  executeBehavior(context: BehaviorContext): void | Promise<void> {
    const behavior = ItemBehaviors[this.itemId] ?? ItemBehaviors[this.type];
    if (behavior) {
      const itemContext: ItemBehaviorContext = { ...context, item: this };
      return behavior(itemContext);
    }
  }
}