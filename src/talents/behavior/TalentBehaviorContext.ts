// TalentBehaviorContext.ts
import { Client } from 'colyseus';
import { Player } from '../../players/schema/PlayerSchema';
import ClockTimer from '@gamestdio/timer';
import { Talent } from '../schema/TalentSchema';
import { Item } from '../../items/schema/ItemSchema';
import { ArraySchema } from '@colyseus/schema';

export interface TalentBehaviorContext {
	client: Client;
	attacker?: Player;
	defender?: Player;
	talent?: Talent;
	clock?: ClockTimer;
	damage?: number;
	shop?: ArraySchema<Item>;
}
