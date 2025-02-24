import {ArraySchema, Schema, type} from '@colyseus/schema';
import {TalentBehaviors} from '../behavior/TalentBehaviors';
import {BehaviorContext} from '../../common/BehaviorContext';
import {TalentBehaviorContext} from '../behavior/TalentBehaviorContext';
import {AffectedStats} from "../../common/schema/AffectedStatsSchema";

export class Talent extends Schema {
    @type('number') talentId: number;
    @type('string') name: string;
    @type('string') description: string;
    @type('number') tier: number;
    @type('number') activationRate: number;
    @type('number') base: number = 0;
    @type('number') scaling: number = 0;
    @type('string') image: string;
    @type(['string']) tags: ArraySchema<string>;
    @type('string') triggerType: string;
    @type(['string']) triggerTypes: ArraySchema<string>;
    @type(AffectedStats) affectedStats: AffectedStats;
    @type(AffectedStats) affectedEnemyStats: AffectedStats;

    executeBehavior(context: BehaviorContext) {
        const behaviorKey = this.talentId as keyof typeof TalentBehaviors;
        const behavior = TalentBehaviors[behaviorKey];
        if (behavior) {
            const talentContext: TalentBehaviorContext = {...context, talent: this};
            behavior(talentContext);
        } else {
            throw new Error(`No behavior defined for talentId ${this.talentId}`);
        }
    }
}
