import {Command} from '@colyseus/command';
import {Talent} from '../../talents/schema/TalentSchema';
import {TriggerType} from '../../common/types';
import {FightRoom} from '../../rooms/FightRoom';
import {BehaviorContext} from '../../common/BehaviorContext';
import {ItemCollection} from '../../item-collections/schema/ItemCollectionSchema';

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

		//handle on fight start item collections
		const onFightEndItemCollections: ItemCollection[] = this.state.player.activeItemCollections.filter(
			(itemCollection) => itemCollection.triggerTypes.includes(TriggerType.FIGHT_END)
		);
		onFightEndItemCollections.forEach((itemCollection) => {
			itemCollection.executeBehavior(fightEndBehaviorContext);
		});
	}
}
