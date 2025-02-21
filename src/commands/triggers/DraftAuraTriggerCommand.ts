import {Command} from '@colyseus/command';
import {TriggerType} from '../../common/types';
import {ItemCollection} from '../../item-collections/schema/ItemCollectionSchema';
import {DraftRoom} from '../../rooms/DraftRoom';
import {Talent} from '../../talents/schema/TalentSchema';
import {BehaviorContext} from '../../common/BehaviorContext';

export class DraftAuraTriggerCommand extends Command<DraftRoom> {
	execute() {
		const auraItemCollections: ItemCollection[] = this.state.player.activeItemCollections.filter(
			(itemCollection) => itemCollection.triggerTypes.includes(TriggerType.AURA)
		);

		const auraTalents: Talent[] = this.state.player.talents.filter((talent) => talent.triggerTypes.includes(TriggerType.AURA));

		let behaviorContext: BehaviorContext = {
			client: this.state.playerClient,
			attacker: this.state.player,
			questItems: this.state.questItems,
			trigger: TriggerType.AURA
		};

		auraItemCollections.forEach((itemCollection) => {
			itemCollection.executeBehavior(behaviorContext);
		});

		auraTalents.forEach((talent) => {
			talent.executeBehavior(behaviorContext);
		});
	}
}
