import { Command } from '@colyseus/command';
import { Talent } from '../../talents/schema/TalentSchema';
import { TalentBehaviorContext } from '../../talents/behavior/TalentBehaviorContext';
import { TriggerType } from '../../common/types';
import { FightRoom } from '../../rooms/FightRoom';
import { Player } from '../../players/schema/PlayerSchema';

export class ActiveTriggerCommand extends Command<FightRoom> {
	execute() {
		this.startActiveTalentLoop(this.state.player, this.state.enemy);
		this.startActiveTalentLoop(this.state.enemy, this.state.player);
	}

	startActiveTalentLoop(player: Player, enemy: Player) {
		const activeTalents: Talent[] = player.talents.filter((talent) =>
			talent.tags.includes(TriggerType.ACTIVE)
		);
		const activeTalentBehaviorContext: TalentBehaviorContext = {
			client: this.state.playerClient,
			attacker: player,
			defender: enemy,
		};
		activeTalents.forEach((talent) => {
			this.state.skillsTimers.push(
				this.clock.setInterval(() => {
					talent.executeBehavior(activeTalentBehaviorContext);
				}, (1 / talent.activationRate) * 1000)
			);
		});
	}
}
