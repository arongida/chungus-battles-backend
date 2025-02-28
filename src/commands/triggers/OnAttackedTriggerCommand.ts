import {Command} from '@colyseus/command';
import {Talent} from '../../talents/schema/TalentSchema';
import {TalentBehaviorContext as BehaviorContext} from '../../talents/behavior/TalentBehaviorContext';
import {TriggerType} from '../../common/types';
import {FightRoom} from '../../rooms/FightRoom';
import {Player} from '../../players/schema/PlayerSchema';

export class OnAttackedTriggerCommand extends Command<
    FightRoom,
    { damage: number; attacker: Player; defender: Player }
> {
    execute({damage, attacker, defender} = this.payload) {
        const attackContext: BehaviorContext = {
            client: this.state.playerClient,
            attacker: attacker,
            defender: defender,
            damage: damage,
            clock: this.clock,
            commandDispatcher: this.room.dispatcher,
            trigger: TriggerType.ON_ATTACKED
        };
        //handle on attacked talents
        const talentsToTriggerOnDefender: Talent[] = defender.talents.filter(
            (talent) => talent.triggerTypes.includes(TriggerType.ON_ATTACKED)
        );
        talentsToTriggerOnDefender.forEach((talent) => {
            try {
                talent.executeBehavior(attackContext);
            } catch (e) {
                console.error(e);
            }
        });

    }
}
