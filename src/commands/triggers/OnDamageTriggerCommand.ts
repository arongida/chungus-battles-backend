import {Command} from '@colyseus/command';
import {Talent} from '../../talents/schema/TalentSchema';
import {TriggerType} from '../../common/types';
import {FightRoom} from '../../rooms/FightRoom';
import {Player} from '../../players/schema/PlayerSchema';
import {BehaviorContext} from '../../common/BehaviorContext';

export class OnDamageTriggerCommand extends Command<
    FightRoom,
    { defender: Player; attacker: Player; damage: number }
> {
    execute({defender, damage, attacker} = this.payload) {
        const onDamageTalentBehaviorContext: BehaviorContext = {
            client: this.state.playerClient,
            attacker: attacker,
            defender: defender,
            damage: damage,
            clock: this.clock,
            trigger: TriggerType.ON_DAMAGE
        };

        const onDamageTalents: Talent[] = defender.talents.filter((talent) =>
            talent.triggerTypes.includes(TriggerType.ON_DAMAGE)
        );

        onDamageTalents.forEach((talent) => {
            talent.executeBehavior(onDamageTalentBehaviorContext);
        });

    }
}
