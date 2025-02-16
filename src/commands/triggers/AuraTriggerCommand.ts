import { Command } from '@colyseus/command';
import { TriggerType } from '../../common/types';
import { FightRoom } from '../../rooms/FightRoom';
import { ItemCollection } from '../../item-collections/schema/ItemCollectionSchema';
import { DraftRoom } from '../../rooms/DraftRoom';
import { Talent } from '../../talents/schema/TalentSchema';
import { BehaviorContext } from '../../common/BehaviorContext';

export class AuraTriggerCommand extends Command<FightRoom | DraftRoom> {
	execute() {
		const auraItemCollections: ItemCollection[] = this.state.player.activeItemCollections.filter(
			(itemCollection) => itemCollection.triggerType === TriggerType.AURA
		);

		const auraTalents: Talent[] = this.state.player.talents.filter((talent) => talent.triggerType === TriggerType.AURA);

		let behaviorContext: BehaviorContext = {
			client: this.state.playerClient,
			attacker: this.state.player,
		};

		if ('enemy' in this.state) { 
			behaviorContext = { ...behaviorContext, defender: this.state.enemy };
		}

		auraItemCollections.forEach((itemCollection) => {
			itemCollection.executeBehavior(behaviorContext);
		});

		auraTalents.forEach((talent) => {
			talent.executeBehavior(behaviorContext);
		});
	}
}
