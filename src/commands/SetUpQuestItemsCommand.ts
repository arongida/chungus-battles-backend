import { Command } from '@colyseus/command';
import { FightRoom } from '../rooms/FightRoom';
import { DraftRoom } from '../rooms/DraftRoom';
import {  Item } from '../items/schema/ItemSchema';
import {AffectedStats} from "../common/schema/AffectedStatsSchema";

export class SetUpQuestItemsCommand extends Command<
	FightRoom | DraftRoom,
	{
		questItemsFromDb: Item[];
	}
> {
	async execute({ questItemsFromDb } = this.payload) {
		questItemsFromDb.forEach((item) => {
			const itemAffectedStatsObject = new AffectedStats().assign(item.affectedStats);
			item.affectedStats = itemAffectedStatsObject;
			const newItem = new Item().assign(item);
			this.state.questItems.push(newItem);
		});
	}
}
