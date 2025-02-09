import { Command } from '@colyseus/command';
import { Talent } from '../../talents/schema/TalentSchema';
import { BehaviorContext } from '../../common/BehaviorContext';
import { TriggerType } from '../../common/types';
import { FightRoom } from '../../rooms/FightRoom';
import { Player } from '../../players/schema/PlayerSchema';
import { ItemCollection } from '../../item-collections/schema/ItemCollectionSchema';

export class OnAttackTriggerCommand extends Command<
	FightRoom,
	{
		damage: number;
		attacker: Player;
		defender: Player;
	}
> {
	execute({ damage, attacker, defender } = this.payload) {
		const attackContext: BehaviorContext = {
			client: this.state.playerClient,
			attacker: attacker,
			defender: defender,
			damage: damage,
			clock: this.clock,
      commandDispatcher: this.room.dispatcher
		};

    const itemCollectionsToTrigger: ItemCollection[] = attacker.activeItemCollections.filter((talent) =>
      talent.triggerType === TriggerType.ON_ATTACK
    );
		const talentsToTrigger: Talent[] = attacker.talents.filter((talent) =>
			talent.triggerType === TriggerType.ON_ATTACK
		);
		talentsToTrigger.forEach((talent) => {
			talent.executeBehavior(attackContext);
		});
    itemCollectionsToTrigger.forEach((talent) => {
      talent.executeBehavior(attackContext);
    });
	}
}
