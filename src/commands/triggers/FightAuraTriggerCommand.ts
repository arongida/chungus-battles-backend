import {Command} from '@colyseus/command';
import {TriggerType} from '../../common/types';
import {FightRoom} from '../../rooms/FightRoom';
import {Talent} from '../../talents/schema/TalentSchema';
import {BehaviorContext} from '../../common/BehaviorContext';
import {Player} from '../../players/schema/PlayerSchema';

export class FightAuraTriggerCommand extends Command<FightRoom> {
    execute() {
        this.startAuraEffectsLoop(this.state.player, this.state.enemy);
        this.startAuraEffectsLoop(this.state.enemy, this.state.player);
    }

    startAuraEffectsLoop(player: Player, enemy?: Player) {

        const auraTalents: Talent[] = player.talents.filter((talent) => talent.triggerTypes.includes(TriggerType.AURA));

        let behaviorContext: BehaviorContext = {
            client: this.state.playerClient,
            attacker: player,
            defender: enemy,
            questItems: this.state.questItems,
            commandDispatcher: this.room.dispatcher,
            trigger: TriggerType.AURA
        };

        auraTalents.forEach((talent) => {
            this.state.skillsTimers.push(
                this.clock.setInterval(() => {
                    talent.executeBehavior(behaviorContext);
                }, 1000)
            );
        });
    }
}
