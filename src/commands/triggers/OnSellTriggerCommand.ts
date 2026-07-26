import {Command} from '@colyseus/command';
import {DraftRoom} from '../../rooms/DraftRoom';
import {Talent} from '../../talents/schema/TalentSchema';
import {TriggerType} from '../../common/types';
import {BehaviorContext} from '../../common/BehaviorContext';
import {triggerEquippedItems} from '../../common/triggerUtils';

export class OnSellTriggerCommand extends Command<DraftRoom> {
    execute() {
        const context: BehaviorContext = {
            client: this.state.playerClient,
            attacker: this.state.player,
            shop: this.state.shop,
            trigger: TriggerType.ON_SELL,
        };

        const onSellTalents: Talent[] = this.state.player.talents.filter((talent) =>
            talent.triggerTypes.includes(TriggerType.ON_SELL)
        );
        onSellTalents.forEach((talent) => {
            try {
                talent.executeBehavior(context);
            } catch (e) {
                console.error(e);
            }
        });

        triggerEquippedItems(this.state.player, context, TriggerType.ON_SELL);

        this.room.checkLevelUp();
    }
}
