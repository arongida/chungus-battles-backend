import { Command } from '@colyseus/command';
import { Talent } from '../../talents/schema/TalentSchema';
import { TriggerType } from '../../common/types';
import { FightRoom } from '../../rooms/FightRoom';
import { Player } from '../../players/schema/PlayerSchema';
import { BehaviorContext } from '../../common/BehaviorContext';
import { ItemCollection } from '../../item-collections/schema/ItemCollectionSchema';

export class FightStartTriggerCommand extends Command<FightRoom> {
	execute() {
		this.applyFightStartEffects(this.state.player, this.state.enemy);
		this.applyFightStartEffects(this.state.enemy, this.state.player);
	}

	async applyFightStartEffects(player: Player, enemy: Player) {
    const fightStartContext: BehaviorContext = {
			client: this.state.playerClient,
			attacker: player,
			defender: enemy,
			clock: this.clock,
      availableTalents: this.state.availableTalents,
		};

		//handle on fight start talents
		const onFightStartTalents: Talent[] = player.talents.filter((talent) =>
			talent.tags.includes(TriggerType.FIGHT_START)
		);
		onFightStartTalents.forEach((talent) => {
			talent.executeBehavior(fightStartContext);
		});

    //handle on fight start item collections
    const onFightStartItemCollections: ItemCollection[] = player.activeItemCollections.filter((itemCollection) =>
      itemCollection.tags.includes(TriggerType.FIGHT_START)
    );
    onFightStartItemCollections.forEach((itemCollection) => {
      itemCollection.executeBehavior(fightStartContext);
    });
	}
}
