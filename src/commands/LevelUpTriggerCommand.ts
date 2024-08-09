import { Command } from '@colyseus/command';
import { DraftRoom } from '../rooms/DraftRoom';
import { Client } from 'colyseus';
import { Talent } from '../talents/schema/TalentSchema';
import { TalentBehaviorContext } from '../talents/behavior/TalentBehaviorContext';
import { TriggerType } from '../common/types';

export class LevelUpTriggerCommand extends Command<
	DraftRoom,
	{
		playerClient: Client;
	}
> {
	execute({ playerClient } = this.payload) {
		const onLevelUpTalents: Talent[] = this.state.player.talents.filter(
			(talent) => talent.tags.includes(TriggerType.LEVEL_UP)
		);
		const onLevelUpTalentsContext: TalentBehaviorContext = {
			client: playerClient,
			attacker: this.state.player,
			clock: this.clock,
		};
		onLevelUpTalents.forEach((talent) => {
			talent.executeBehavior(onLevelUpTalentsContext);
		});
	}
}
