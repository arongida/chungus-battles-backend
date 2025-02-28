import {Command} from '@colyseus/command';
import {DraftRoom} from '../../rooms/DraftRoom';
import {Talent} from '../../talents/schema/TalentSchema';
import {TalentBehaviorContext} from '../../talents/behavior/TalentBehaviorContext';
import {TriggerType} from '../../common/types';

export class LevelUpTriggerCommand extends Command<
    DraftRoom
> {
    execute() {
        const onLevelUpTalents: Talent[] = this.state.player.talents.filter(
            (talent) => talent.triggerTypes.includes(TriggerType.LEVEL_UP)
        );
        const onLevelUpTalentsContext: TalentBehaviorContext = {
            client: this.state.playerClient,
            attacker: this.state.player,
            clock: this.clock,
            trigger: TriggerType.LEVEL_UP
        };
        onLevelUpTalents.forEach((talent) => {

            try {
                talent.executeBehavior(onLevelUpTalentsContext);
            } catch (e) {
                console.error(e);
            }
        });
    }
}
