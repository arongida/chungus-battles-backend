// OnJoinCommand.ts
import { Command } from '@colyseus/command';
import { DraftRoom } from '../../../DraftRoom';
import { TalentType } from '../TalentTypes';
import { increaseStats } from '../../../../common/utils';
import { Client } from 'colyseus';

export class ShopStartTalentTriggerCommand extends Command<
	DraftRoom,
	{
		playerClient: Client;
	}
> {
	execute({ playerClient } = this.payload) {
		//check robbery talent
		const robberyTalent = this.state.player.talents.find(
			(talent) => talent.talentId === TalentType.Robbery
		);
		if (robberyTalent) {
			const randomItem =
				this.state.shop[Math.floor(Math.random() * this.state.shop.length)];

			if (randomItem) {
				increaseStats(this.state.player, randomItem.affectedStats);
				randomItem.sold = true;
				this.state.player.inventory.push(randomItem);
				playerClient.send('trigger_talent', {
					playerId: this.state.player.playerId,
					talentId: TalentType.Robbery,
				});
				playerClient.send(
					'draft_log',
					`Robbery talent activated! Gained ${randomItem.name}!`
				);
			}
		}
	}
}
