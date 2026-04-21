import {Command} from '@colyseus/command';
import {Talent} from '../../talents/schema/TalentSchema';
import {BehaviorContext} from '../../common/BehaviorContext';
import {TriggerType} from '../../common/types';
import {FightRoom} from '../../rooms/FightRoom';
import {Player} from '../../players/schema/PlayerSchema';
import {Item} from '../../items/schema/ItemSchema';

export class OnAttackTriggerCommand extends Command<
    FightRoom,
    {
        damage: number;
        attacker: Player;
        defender: Player;
        weapon?: Item;
    }
> {
    execute({damage, attacker, defender, weapon} = this.payload) {
        const attackContext: BehaviorContext = {
            client: this.state.playerClient,
            attacker: attacker,
            defender: defender,
            damage: damage,
            clock: this.clock,
            commandDispatcher: this.room.dispatcher,
            trigger: TriggerType.ON_ATTACK,
            weapon: weapon
        };

        const talentsToTrigger: Talent[] = attacker.talents.filter((talent) =>
            talent.triggerTypes.includes(TriggerType.ON_ATTACK)
        );
        talentsToTrigger.forEach((talent) => {
            try {
                talent.executeBehavior(attackContext);
            } catch (e) {
                console.error(e);
            }
        });

        if (weapon?.triggerTypes?.includes(TriggerType.ON_ATTACK)) {
            try {
                weapon.executeBehavior(attackContext);
            } catch (e) {
                console.error(e);
            }
        }
    }
}
