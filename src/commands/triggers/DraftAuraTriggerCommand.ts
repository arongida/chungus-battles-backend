import {Command} from '@colyseus/command';
import {TriggerType} from '../../common/types';
import {DraftRoom} from '../../rooms/DraftRoom';
import {Talent} from '../../talents/schema/TalentSchema';
import {TalentBehaviorContext} from "../../talents/behavior/TalentBehaviorContext";

export class DraftAuraTriggerCommand extends Command<DraftRoom> {
    execute() {

        const auraTalents: Talent[] = this.state.player.talents.filter((talent) => talent.triggerTypes?.includes(TriggerType.AURA));

        let behaviorContext: TalentBehaviorContext = {
            client: this.state.playerClient,
            attacker: this.state.player,
            questItems: this.state.questItems,
            trigger: TriggerType.AURA,
        };

        auraTalents.forEach((talent) => {
            try {
                talent.executeBehavior(behaviorContext);
            } catch (e) {
                console.error(e);
            }
        });
    }
}
