import { Command } from '@colyseus/command';
import { Talent } from '../../talents/schema/TalentSchema';
import { TalentBehaviorContext } from '../../talents/behavior/TalentBehaviorContext';
import { TriggerType } from '../../common/types';
import { FightRoom } from '../../rooms/FightRoom';
import { Player } from '../../players/schema/PlayerSchema';

export class OnDamageTriggerCommand extends Command<
	FightRoom,
	{ defender: Player, damage: number }
> {
	execute({defender, damage} = this.payload) {
		const onDamageTalents: Talent[] = defender.talents.filter((talent) =>
			talent.tags.includes(TriggerType.ON_DAMAGE)
		);

		const onDamageTalentBehaviorContext: TalentBehaviorContext = {
			client: this.state.playerClient,
			defender: defender,
			damage: damage,
		};
		onDamageTalents.forEach((talent) => {
			talent.executeBehavior(onDamageTalentBehaviorContext);
		});
	}
}
