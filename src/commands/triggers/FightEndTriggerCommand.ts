import {Command} from '@colyseus/command';
import {Talent} from '../../talents/schema/TalentSchema';
import {TriggerType} from '../../common/types';
import {FightRoom} from '../../rooms/FightRoom';
import {BehaviorContext} from '../../common/BehaviorContext';

export class FightEndTriggerCommand extends Command<FightRoom> {
	execute() {
		const fightEndBehaviorContext: BehaviorContext = {
			client: this.state.playerClient,
			attacker: this.state.player,
			defender: this.state.enemy,
			trigger: TriggerType.FIGHT_END
		};

		const fightEndTalents: Talent[] = this.state.player.talents.filter((talent) =>
			talent.triggerTypes.includes(TriggerType.FIGHT_END)
		);

		fightEndTalents.forEach((talent) => {
			talent.executeBehavior(fightEndBehaviorContext);
		});

	}
}
