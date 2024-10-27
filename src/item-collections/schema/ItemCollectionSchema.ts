import { Schema, type, ArraySchema } from '@colyseus/schema';
import { ItemCollectionBehaviorContext } from '../behavior/ItemCollectionBehaviorContext';
import { ItemCollectionBehaviors } from '../behavior/ItemCollectionBehaviors';
import { BehaviorContext } from '../../common/BehaviorContext';

export class ItemCollection extends Schema {
	@type('number') itemCollectionId: number;
	@type('string') name: string;
	@type('string') requirements: string;
	@type('string') effect: string;
	@type('string') image: string;
	@type(['string']) tags: ArraySchema<string>;
  @type('number') tier: number;
	base: number;
	scaling: number;
  activationRate: number;
  savedValue: number = 0;


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
