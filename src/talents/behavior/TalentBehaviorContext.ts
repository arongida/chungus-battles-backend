import { Talent } from '../schema/TalentSchema';
import { BehaviorContext } from '../../common/BehaviorContext';

export interface TalentBehaviorContext extends BehaviorContext {
	talent?: Talent;
}
