import { Command } from '@colyseus/command';
import { Talent } from '../../talents/schema/TalentSchema';
import { TalentBehaviorContext } from '../../talents/behavior/TalentBehaviorContext';
import { TriggerType } from '../../common/types';
import { FightRoom } from '../../rooms/FightRoom';
import { BehaviorContext } from '../../common/BehaviorContext';
import { ItemCollection } from '../../item-collections/schema/ItemCollectionSchema';

export class FightEndTriggerCommand extends Command<FightRoom> {
	execute() {
		const fightEndBehaviorContext: BehaviorContext = {
			client: this.state.playerClient,
			attacker: this.state.player,
			defender: this.state.enemy,
		};

		const fightEndTalents: Talent[] = this.state.player.talents.filter((talent) =>
			talent.triggerType === TriggerType.FIGHT_END
		);

		fightEndTalents.forEach((talent) => {
			talent.executeBehavior(fightEndBehaviorContext);
		});

		//handle on fight start item collections
		const onFightEndItemCollections: ItemCollection[] = this.state.player.activeItemCollections.filter(
			(itemCollection) => itemCollection.triggerType === TriggerType.FIGHT_END
		);
		onFightEndItemCollections.forEach((itemCollection) => {
			itemCollection.executeBehavior(fightEndBehaviorContext);
		});
	}
}
