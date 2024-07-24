import { Schema, type, ArraySchema } from '@colyseus/schema';
import { TalentType } from './TalentTypes';
import { TalentBehaviors } from './TalentBehaviors';
import { TalentBehaviorContext } from './TalentBehaviorContext';
import { Player } from '../PlayerSchema';
import { Client } from 'colyseus';
import ClockTimer from '@gamestdio/timer';

export class Talent extends Schema {
	@type('number') talentId: number;
	@type('string') name: string;
	@type('string') description: string;
	@type('number') tier: number;
	@type('number') activationRate: number;
	@type('string') image: string;
	@type(['string']) tags: ArraySchema<string>;

	executeBehavior(
		client: Client,
		attacker?: Player,
		defender?: Player,
		damage?: number,
		clock?: ClockTimer
	) {
    const behaviorKey = this.talentId as keyof typeof TalentBehaviors;
		const behavior = TalentBehaviors[behaviorKey];
		if (behavior) {
			const context: TalentBehaviorContext = {
				attacker,
				defender,
				client,
				damage,
        clock
			};
			behavior(context, this);
		} else {
			throw new Error(`No behavior defined for talentId ${this.talentId}`);
		}
	}
}
