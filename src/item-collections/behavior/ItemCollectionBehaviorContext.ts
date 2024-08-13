import { BehaviorContext } from '../../common/BehaviorContext';
import { ItemCollection } from '../schema/ItemCollectionSchema';

export interface ItemCollectionBehaviorContext extends BehaviorContext {
	itemCollection?: ItemCollection;
}
