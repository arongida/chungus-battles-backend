import { Command } from '@colyseus/command';
import { DraftRoom } from '../../rooms/DraftRoom';
import { Talent } from '../../talents/schema/TalentSchema';
import { TriggerType } from '../../common/types';

export class ShopStartTriggerCommand extends Command<DraftRoom> {
	execute() {
		const onShopStartTalents: Talent[] = this.state.player.talents.filter(
			(talent) => talent.tags.includes(TriggerType.SHOP_START)
		);
		const onShopStartTalentsContext = {
			client: this.state.playerClient,
			attacker: this.state.player,
			shop: this.state.shop,
		};
		onShopStartTalents.forEach((talent) => {
			talent.executeBehavior(onShopStartTalentsContext);
		});
	}
}
