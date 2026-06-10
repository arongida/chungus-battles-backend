import {Command} from '@colyseus/command';
import {Talent} from '../../talents/schema/TalentSchema';
import {TalentBehaviorContext as BehaviorContext} from '../../talents/behavior/TalentBehaviorContext';
import {TriggerType} from '../../common/types';
import {FightRoom} from '../../rooms/FightRoom';
import {Player} from '../../players/schema/PlayerSchema';
import {triggerEquippedItems} from '../../common/triggerUtils';

export class OnDodgeTriggerCommand extends Command<
    FightRoom,
    { attacker: Player; defender: Player; isCounter?: boolean }
> {
    execute({ attacker, defender, isCounter} = this.payload) {
        const attackContext: BehaviorContext = {
            client: this.state.playerClient,
            attacker: attacker,
            defender: defender,
            clock: this.clock,
            trigger: TriggerType.ON_DODGE,
            isCounterAttack: isCounter,
            performWeaponAttack: (counterAttacker, counterDefender, weapon, slot) =>
                this.room.tryWeaponAttack(counterAttacker, counterDefender, weapon, slot, true),
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

        triggerEquippedItems(defender, attackContext, TriggerType.ON_DODGE);
    }
}
