import {ArraySchema, Schema, type} from '@colyseus/schema';
import {ItemCollectionBehaviorContext} from '../behavior/ItemCollectionBehaviorContext';
import {ItemCollectionBehaviors} from '../behavior/ItemCollectionBehaviors';
import {BehaviorContext} from '../../common/BehaviorContext';
import {AffectedStats} from "../../common/schema/AffectedStatsSchema";

export class ItemCollection extends Schema {
    @type('number') itemCollectionId: number;
    @type('string') name: string;
    @type('string') requirements: string;
    @type('string') effect: string;
    @type('string') image: string;
    @type(['string']) tags: ArraySchema<string>;
    @type(['string']) triggerTypes: ArraySchema<string>;
    @type('number') tier: number;
    @type(AffectedStats) affectedStats: AffectedStats;
    @type('number') base: number;
    @type('number') scaling: number;
    @type('number') activationRate: number;

    executeBehavior(context: BehaviorContext) {
        const behaviorKey = this
            .itemCollectionId as keyof typeof ItemCollectionBehaviors;
        const behavior = ItemCollectionBehaviors[behaviorKey];
        if (behavior) {
            const itemCollectionContext: ItemCollectionBehaviorContext = {
                ...context,
                itemCollection: this,
            };

            behavior(itemCollectionContext);
        } else {
            throw new Error(
                `No behavior defined for itemCollection ${this.itemCollectionId}`
            );
        }
    }
}
