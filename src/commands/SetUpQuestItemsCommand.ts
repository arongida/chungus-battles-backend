import { Command } from '@colyseus/command';
import { FightRoom } from '../rooms/FightRoom';
import { DraftRoom } from '../rooms/DraftRoom';
import { AffectedStats, Item } from '../items/schema/ItemSchema';

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
