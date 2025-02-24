import {Command} from '@colyseus/command';
import {DraftRoom} from '../../rooms/DraftRoom';
import {TriggerType} from '../../common/types';
import {Talent} from "../../talents/schema/TalentSchema";
import {TalentBehaviorContext} from "../../talents/behavior/TalentBehaviorContext";

export class AfterShopRefreshTriggerCommand extends Command<
    DraftRoom
> {
    execute() {
        const onShopRefreshTalents: Talent[] =
            this.state.player.talents.filter((talent) =>
                talent.triggerTypes?.includes(TriggerType.AFTER_REFRESH)
            );
        const onShopRefreshTalentContext : TalentBehaviorContext = {
            client: this.state.playerClient,
            attacker: this.state.player,
            shop: this.state.shop,
            trigger: TriggerType.AFTER_REFRESH
        };
        onShopRefreshTalents.forEach((itemCollection) => {
            itemCollection.executeBehavior(onShopRefreshTalentContext);
        });
    }
}
