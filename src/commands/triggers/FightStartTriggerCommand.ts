import { Command } from '@colyseus/command';
import { Talent } from '../../talents/schema/TalentSchema';
import { TalentBehaviorContext } from '../../talents/behavior/TalentBehaviorContext';
import { TriggerType } from '../../common/types';
import { FightRoom } from '../../rooms/FightRoom';
import { Player } from '../../players/schema/PlayerSchema';

export class FightStartTriggerCommand extends Command<FightRoom> {
	execute() {
		this.applyFightStartTalents(this.state.player, this.state.enemy);
		this.applyFightStartTalents(this.state.enemy, this.state.player);
	}

	applyFightStartTalents(player: Player, enemy: Player) {
		//handle on fight start talents
		const onFightStartTalents: Talent[] = player.talents.filter((talent) =>
			talent.tags.includes(TriggerType.FIGHT_START)
		);
		const onFightStartTalentsContext: TalentBehaviorContext = {
			client: this.state.playerClient,
			attacker: player,
			defender: enemy,
			clock: this.clock,
		};
		onFightStartTalents.forEach((talent) => {
			talent.executeBehavior(onFightStartTalentsContext);
		});
	}
}
