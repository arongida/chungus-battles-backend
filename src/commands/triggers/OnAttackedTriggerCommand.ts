import {Command} from '@colyseus/command';
import {Talent} from '../../talents/schema/TalentSchema';
import {TalentBehaviorContext as BehaviorContext} from '../../talents/behavior/TalentBehaviorContext';
import {TriggerType} from '../../common/types';
import {FightRoom} from '../../rooms/FightRoom';
import {Player} from '../../players/schema/PlayerSchema';
import {Item} from '../../items/schema/ItemSchema';
import {triggerEquippedItems} from '../../common/triggerUtils';

export class OnAttackedTriggerCommand extends Command<
    FightRoom,
    { damage: number; attacker: Player; defender: Player; weapon?: Item }
> {
    execute({damage, attacker, defender, weapon} = this.payload) {
        const attackContext: BehaviorContext = {
            client: this.state.playerClient,
            attacker: attacker,
            defender: defender,
            damage: damage,
            clock: this.clock,
            commandDispatcher: this.room.dispatcher,
            trigger: TriggerType.ON_ATTACKED,
            weapon: weapon
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

        triggerEquippedItems(defender, attackContext, TriggerType.ON_ATTACKED);
    }
}
