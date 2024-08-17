import { Command } from '@colyseus/command';
import { TriggerType } from '../../common/types';
import { FightRoom } from '../../rooms/FightRoom';
import { ItemCollection } from '../../item-collections/schema/ItemCollectionSchema';

export class AuraTriggerCommand extends Command<FightRoom> {
	execute() {
		const auraItemCollections: ItemCollection[] =
			this.state.player.activeItemCollections.filter((itemCollection) =>
				itemCollection.tags.includes(TriggerType.AURA)
			);

		const auraBehaviorContext = {
			client: this.state.playerClient,
			attacker: this.state.player,
		};

		auraItemCollections.forEach((itemCollection) => {
			itemCollection.executeBehavior(auraBehaviorContext);
		});
	}
}
