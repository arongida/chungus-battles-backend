// OnJoinCommand.ts
import { Command } from '@colyseus/command';
import { DraftRoom } from '../../../DraftRoom';
import { TalentType } from '../TalentTypes';
import { Client } from 'colyseus';
import { Talent } from '../TalentSchema';

export class LevelUpTalentTriggerCommand extends Command<
	DraftRoom,
	{
		playerClient: Client;
	}
> {
	execute({ playerClient } = this.payload) {
		//check penny stock talent
		const pennyStocksTalent = this.state.player.talents.find(
			(talent) => talent.talentId === TalentType.PennyStocks
		);
		if (pennyStocksTalent) {
			this.state.player.gold += pennyStocksTalent.activationRate;
			playerClient.send(
				'draft_log',
				`Gained ${pennyStocksTalent.activationRate} gold!`
			);

			this.state.player.talents = this.state.player.talents.filter(
				(talent) => talent.talentId !== TalentType.PennyStocks
			);
			this.state.player.talents.push(
				new Talent({
					talentId: 7,
					name: 'Broken Penny Stocks',
					description: 'Already used',
					tier: 1,
					activationRate: 0,
				})
			);
			setTimeout(() => {
				playerClient.send('trigger_talent', {
					playerId: this.state.player.playerId,
					talentId: 7,
				});
			}, 100);
		}
	}
}
