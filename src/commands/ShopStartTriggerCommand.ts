import { Command } from '@colyseus/command';
import { DraftRoom } from '../rooms/DraftRoom';
import { Client } from 'colyseus';
import { Talent } from '../talents/schema/TalentSchema';
import { TriggerType } from '../common/types';

export class ShopStartTriggerCommand extends Command<
	DraftRoom,
	{
		playerClient: Client;
	}
> {
	execute({ playerClient } = this.payload) {
		const onShopStartTalents: Talent[] = this.state.player.talents.filter(
			(talent) => talent.tags.includes(TriggerType.SHOP_START)
		);
		const onShopStartTalentsContext = {
			client: playerClient,
			attacker: this.state.player,
			shop: this.state.shop,
		};
		onShopStartTalents.forEach((talent) => {
			talent.executeBehavior(onShopStartTalentsContext);
		});
	}
}
