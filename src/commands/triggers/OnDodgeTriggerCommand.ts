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

        // Battle Focus (item skill): the mirror case — fires on the player whose attack WAS
        // dodged (attacker), not the dodger (defender). Context field names are unchanged:
        // `attacker` stays the skill owner who missed, `defender` stays the dodger. Items only
        // for now — add a talent filter here too if a talent ever needs this trigger.
        triggerEquippedItems(attacker, { ...attackContext, trigger: TriggerType.ON_ATTACK_DODGED }, TriggerType.ON_ATTACK_DODGED);
    }
}
