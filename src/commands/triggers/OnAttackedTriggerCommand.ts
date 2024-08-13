import { Command } from '@colyseus/command';
import { Talent } from '../../talents/schema/TalentSchema';
import { TalentBehaviorContext } from '../../talents/behavior/TalentBehaviorContext';
import { TriggerType } from '../../common/types';
import { FightRoom } from '../../rooms/FightRoom';
import { Player } from '../../players/schema/PlayerSchema';

export class OnAttackedTriggerCommand extends Command<
	FightRoom,
	{ damage: number; attacker: Player; defender: Player; }
> {
	execute({ damage, attacker, defender } = this.payload) {
		const attackTalentContext: TalentBehaviorContext = {
			client: this.state.playerClient,
			attacker: attacker,
			defender: defender,
			damage: damage,
			clock: this.clock,
		};
		//handle on attacked talents
		const talentsToTriggerOnDefender: Talent[] = defender.talents.filter(
			(talent) => talent.tags.includes(TriggerType.ON_ATTACKED)
		);
		talentsToTriggerOnDefender.forEach((talent) => {
			talent.executeBehavior(attackTalentContext);
		});
	}
}
