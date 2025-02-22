import {Command} from '@colyseus/command';
import {Talent} from '../../talents/schema/TalentSchema';
import {TalentBehaviorContext} from '../../talents/behavior/TalentBehaviorContext';
import {TriggerType} from '../../common/types';
import {FightRoom} from '../../rooms/FightRoom';
import {Player} from '../../players/schema/PlayerSchema';
import {ItemCollection} from '../../item-collections/schema/ItemCollectionSchema';

export class ActiveTriggerCommand extends Command<FightRoom> {
    execute() {
        this.startActiveEffectsLoop(this.state.player, this.state.enemy);
        this.startActiveEffectsLoop(this.state.enemy, this.state.player);
    }

    startActiveEffectsLoop(player: Player, enemy: Player) {
        const activeTalents: Talent[] = player.talents.filter((talent) =>
            talent.triggerTypes.includes(TriggerType.ACTIVE)
        );
        const activeItemCollections: ItemCollection[] =
            player.activeItemCollections.filter((itemCollection) =>
                itemCollection.triggerTypes.includes(TriggerType.ACTIVE)
            );
        const activeEffectBehaviorContext: TalentBehaviorContext = {
            client: this.state.playerClient,
            attacker: player,
            defender: enemy,
            commandDispatcher: this.room.dispatcher,
            trigger: TriggerType.ACTIVE
        };

        activeTalents.forEach((talent) => {
            this.state.skillsTimers.push(
                this.clock.setInterval(() => {
                    talent.executeBehavior(activeEffectBehaviorContext);
                }, (1 / talent.activationRate) * 1000)
            );
        });

        activeItemCollections.forEach((itemCollection) => {
            this.state.skillsTimers.push(
                this.clock.setInterval(() => {
                    itemCollection.executeBehavior(activeEffectBehaviorContext);
                }, (1 / itemCollection.activationRate) * 1000)
            );
        });
    }
}
