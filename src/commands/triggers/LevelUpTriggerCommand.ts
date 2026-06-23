import {Command} from '@colyseus/command';
import {DraftRoom} from '../../rooms/DraftRoom';
import {Talent} from '../../talents/schema/TalentSchema';
import {TalentBehaviorContext} from '../../talents/behavior/TalentBehaviorContext';
import {TriggerType} from '../../common/types';
import {triggerEquippedItems, triggerInventoryItems} from '../../common/triggerUtils';

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

        triggerEquippedItems(this.state.player, onLevelUpTalentsContext, TriggerType.LEVEL_UP);
        // Some items (e.g. Magic Ring) evolve on level-up even while sitting
        // unequipped in the inventory.
        triggerInventoryItems(this.state.player, onLevelUpTalentsContext, TriggerType.LEVEL_UP);
    }
}
