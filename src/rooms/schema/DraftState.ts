import { Schema, type, ArraySchema } from '@colyseus/schema';
import { Player } from '../../players/schema/PlayerSchema';
import { Item } from '../../items/schema/ItemSchema';
import { Talent } from '../../talents/schema/TalentSchema';

export class DraftState extends Schema {
	@type(Player) player: Player = new Player();
	@type([Item]) shop: ArraySchema<Item> = new ArraySchema<Item>();
	@type([Talent]) availableTalents: ArraySchema<Talent> =
		new ArraySchema<Talent>();
	@type('number') shopSize: number = 6;
	@type('number') shopRefreshCost: number = 2;
	@type('number') remainingTalentPoints: number = 0;
}
