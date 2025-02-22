import {Command} from '@colyseus/command';
import {TriggerType} from '../../common/types';
import {FightRoom} from '../../rooms/FightRoom';
import {ItemCollection} from '../../item-collections/schema/ItemCollectionSchema';
import {Talent} from '../../talents/schema/TalentSchema';
import {BehaviorContext} from '../../common/BehaviorContext';
import {Player} from '../../players/schema/PlayerSchema';

export class FightAuraTriggerCommand extends Command<FightRoom> {
    execute() {
        this.startAuraEffectsLoop(this.state.player, this.state.enemy);
        this.startAuraEffectsLoop(this.state.enemy, this.state.player);
    }

    startAuraEffectsLoop(player: Player, enemy?: Player) {
        const auraItemCollections: ItemCollection[] = player.activeItemCollections.filter(
            (itemCollection) => itemCollection.triggerTypes.includes(TriggerType.AURA)
        );

        const auraTalents: Talent[] = player.talents.filter((talent) => talent.triggerTypes.includes(TriggerType.AURA));

        let behaviorContext: BehaviorContext = {
            client: this.state.playerClient,
            attacker: player,
            defender: enemy,
            questItems: this.state.questItems,
            commandDispatcher: this.room.dispatcher,
            trigger: TriggerType.AURA
        };

        auraItemCollections.forEach((itemCollection) => {
            this.state.skillsTimers.push(
                this.clock.setInterval(() => {
                    itemCollection.executeBehavior(behaviorContext);
                }, 1000)
            );
        });

        auraTalents.forEach((talent) => {
            this.state.skillsTimers.push(
                this.clock.setInterval(() => {
                    talent.executeBehavior(behaviorContext);
                }, 1000)
            );
        });
    }
}
