import {Command} from '@colyseus/command';
import {DraftRoom} from '../../rooms/DraftRoom';
import {Talent} from '../../talents/schema/TalentSchema';
import {TriggerType} from '../../common/types';
import {BehaviorContext} from "../../common/BehaviorContext";

export class ShopStartTriggerCommand extends Command<DraftRoom> {
    execute() {

        const onShopStartTalents: Talent[] = this.state.player.talents.filter(
            (talent) => talent.triggerTypes.includes(TriggerType.SHOP_START)
        );
        const onShopStartTalentsContext: BehaviorContext = {
            client: this.state.playerClient,
            attacker: this.state.player,
            shop: this.state.shop,
            trigger: TriggerType.SHOP_START
        };
        onShopStartTalents.forEach((talent) => {
            talent.executeBehavior(onShopStartTalentsContext);
        });
        this.room.checkLevelUp();
    }
}
