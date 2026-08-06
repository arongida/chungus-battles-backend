import {Command} from '@colyseus/command';
import {DraftRoom} from '../../rooms/DraftRoom';
import {TriggerType} from '../../common/types';
import {Talent} from "../../talents/schema/TalentSchema";
import {TalentBehaviorContext} from "../../talents/behavior/TalentBehaviorContext";
import {triggerEquippedItems} from '../../common/triggerUtils';

// Dispatched from DraftRoom.refreshShop, before the outgoing shop is cleared, so behaviors still
// see the shop that's about to be discarded. Unlike AFTER_REFRESH (also fired on the round's
// initial free shop build via updateShop), this only ever fires on a paid/free player-initiated
// reroll — no extra "was this a reroll" flag needed for talents that key off this trigger.
export class BeforeShopRefreshTriggerCommand extends Command<
    DraftRoom
> {
    execute() {
        const onBeforeRefreshTalents: Talent[] =
            this.state.player.talents.filter((talent) =>
                talent.triggerTypes?.includes(TriggerType.BEFORE_REFRESH)
            );
        const onBeforeRefreshTalentContext: TalentBehaviorContext = {
            client: this.state.playerClient,
            attacker: this.state.player,
            shop: this.state.shop,
            trigger: TriggerType.BEFORE_REFRESH
        };
        onBeforeRefreshTalents.forEach((talent) => {
            try {
                talent.executeBehavior(onBeforeRefreshTalentContext);
            } catch (e) {
                console.error(e);
            }
        });

        triggerEquippedItems(this.state.player, onBeforeRefreshTalentContext, TriggerType.BEFORE_REFRESH);
    }
}
