import { Client } from 'colyseus';
import { Player } from '../players/schema/PlayerSchema';
import ClockTimer from '@gamestdio/timer';
import { Item } from '../items/schema/ItemSchema';
import { ArraySchema } from '@colyseus/schema';
import { Talent } from '../talents/schema/TalentSchema';

export interface BehaviorContext {
	client: Client;
	attacker?: Player;
	defender?: Player;
	clock?: ClockTimer;
	damage?: number;
	shop?: ArraySchema<Item>;
  availableTalents?: Talent[];
}
