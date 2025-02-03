import { Command } from '@colyseus/command';
import { DraftRoom } from '../../rooms/DraftRoom';
import { Talent } from '../../talents/schema/TalentSchema';
import { TriggerType } from '../../common/types';
import { ItemCollection } from '../../item-collections/schema/ItemCollectionSchema';

export class ShopStartTriggerCommand extends Command<DraftRoom> {
	execute() {
		const onShopStartTalents: Talent[] = this.state.player.talents.filter(
			(talent) => talent.triggerType === TriggerType.SHOP_START
		);
    const onShopStartItemCollections: ItemCollection[] = this.state.player.activeItemCollections.filter(
      (itemCollection) => itemCollection.triggerType === TriggerType.SHOP_START
    );
		const onShopStartTalentsContext = {
			client: this.state.playerClient,
			attacker: this.state.player,
			shop: this.state.shop,
		};
    onShopStartItemCollections.forEach((itemCollection) => {
      itemCollection.executeBehavior(onShopStartTalentsContext);
    });
		onShopStartTalents.forEach((talent) => {
			talent.executeBehavior(onShopStartTalentsContext);
		});
	}
}
