import { Command } from '@colyseus/command';
import { DraftRoom } from '../../rooms/DraftRoom';
import { ItemCollection } from '../../item-collections/schema/ItemCollectionSchema';
import { TriggerType } from '../../common/types';

export class AfterShopRefreshTriggerCommand extends Command<
	DraftRoom
> {
	execute() {
		const onShopRefreshItemCollections: ItemCollection[] =
			this.state.player.activeItemCollections.filter((itemCollection) =>
				itemCollection.triggerType === TriggerType.AFTER_REFRESH
			);
		const onShopRefreshItemCollectionsContext = {
			client: this.state.playerClient,
			attacker: this.state.player,
			shop: this.state.shop,
		};
		onShopRefreshItemCollections.forEach((itemCollection) => {
			itemCollection.executeBehavior(onShopRefreshItemCollectionsContext);
		});
	}
}
