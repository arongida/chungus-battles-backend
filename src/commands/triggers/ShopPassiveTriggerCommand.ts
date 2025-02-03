import { Command } from '@colyseus/command';
import { DraftRoom } from '../../rooms/DraftRoom';
import { Talent } from '../../talents/schema/TalentSchema';
import { TriggerType } from '../../common/types';

export class ShopPassiveTriggerCommand extends Command<DraftRoom> {
	execute() {
		const shopPassiveItemCollections: Talent[] =
			this.state.player.activeItemCollections.filter((talent) =>
				talent.triggerType === TriggerType.SHOP_PASSIVE
			);

		const shopPassiveItemCollectionsContext = {
			client: this.state.playerClient,
			attacker: this.state.player,
		};

		shopPassiveItemCollections.forEach((talent) => {
			talent.executeBehavior(shopPassiveItemCollectionsContext);
		});
	}
}
