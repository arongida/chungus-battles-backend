import {Command} from '@colyseus/command';
import {Talent} from '../../talents/schema/TalentSchema';
import {TalentBehaviorContext as BehaviorContext} from '../../talents/behavior/TalentBehaviorContext';
import {TriggerType} from '../../common/types';
import {FightRoom} from '../../rooms/FightRoom';
import {Player} from '../../players/schema/PlayerSchema';

export class OnDodgeTriggerCommand extends Command<
    FightRoom,
    { attacker: Player; defender: Player }
> {
    execute({ attacker, defender} = this.payload) {
        const attackContext: BehaviorContext = {
            client: this.state.playerClient,
            attacker: attacker,
            defender: defender,
            trigger: TriggerType.ON_DODGE
        };
        const talentsToTriggerOnDefender: Talent[] = defender.talents.filter(
            (talent) => talent.triggerTypes.includes(TriggerType.ON_DODGE)
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
