import {Command} from '@colyseus/command';
import {Talent} from '../../talents/schema/TalentSchema';
import {TriggerType} from '../../common/types';
import {FightRoom} from '../../rooms/FightRoom';
import {Player} from '../../players/schema/PlayerSchema';
import {BehaviorContext} from '../../common/BehaviorContext';
import {triggerEquippedItems} from '../../common/triggerUtils';
import {DamageType} from '../../common/MessageTypes';

export class OnDamageTriggerCommand extends Command<
    FightRoom,
    { defender: Player; attacker: Player; damage: number; damageType?: DamageType; isReflectedDamage?: boolean }
> {
    execute({defender, damage, attacker, damageType, isReflectedDamage } = this.payload) {
        const onDamageTalentBehaviorContext: BehaviorContext = {
            client: this.state.playerClient,
            attacker: attacker,
            defender: defender,
            damage: damage,
            damageType: damageType,
            isReflectedDamage: isReflectedDamage,
            clock: this.clock,
            trigger: TriggerType.ON_DAMAGE,
            commandDispatcher: this.room.dispatcher,
        };

        const onDamageTalents: Talent[] = defender.talents.filter((talent) =>
            talent.triggerTypes.includes(TriggerType.ON_DAMAGE)
        );

        onDamageTalents.forEach((talent) => {
            try {
                talent.executeBehavior(onDamageTalentBehaviorContext);
            } catch (e) {
                console.error(e);
            }
        });

        triggerEquippedItems(defender, onDamageTalentBehaviorContext, TriggerType.ON_DAMAGE);
    }
}
