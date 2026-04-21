import {Command} from '@colyseus/command';
import {Talent} from '../../talents/schema/TalentSchema';
import {TriggerType} from '../../common/types';
import {FightRoom} from '../../rooms/FightRoom';
import {BehaviorContext} from '../../common/BehaviorContext';
import {triggerEquippedItems} from '../../common/triggerUtils';

export class FightEndTriggerCommand extends Command<FightRoom> {
    execute() {
        const fightEndBehaviorContext: BehaviorContext = {
            client: this.state.playerClient,
            attacker: this.state.player,
            defender: this.state.enemy,
            trigger: TriggerType.FIGHT_END
        };

        const fightEndTalents: Talent[] = this.state.player.talents.filter((talent) =>
            talent.triggerTypes.includes(TriggerType.FIGHT_END)
        );

        fightEndTalents.forEach((talent) => {
            try {
                talent.executeBehavior(fightEndBehaviorContext);
            } catch (e) {
                console.error(e);
            }
        });

        triggerEquippedItems(this.state.player, fightEndBehaviorContext, TriggerType.FIGHT_END);
        triggerEquippedItems(this.state.enemy, {...fightEndBehaviorContext, attacker: this.state.enemy, defender: this.state.player}, TriggerType.FIGHT_END);
    }
}
