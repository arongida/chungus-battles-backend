import { BehaviorContext } from '../../common/BehaviorContext';
import { Item } from '../schema/ItemSchema';

export interface ItemBehaviorContext extends BehaviorContext {
    item?: Item;
}
