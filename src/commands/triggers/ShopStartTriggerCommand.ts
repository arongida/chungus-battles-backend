import {Command} from '@colyseus/command';
import {DraftRoom} from '../../rooms/DraftRoom';
import {Talent} from '../../talents/schema/TalentSchema';
import {TriggerType} from '../../common/types';
import {BehaviorContext} from "../../common/BehaviorContext";
import {triggerEquippedItems, triggerInventoryItems} from '../../common/triggerUtils';

export class ShopStartTriggerCommand extends Command<DraftRoom> {
    async execute() {

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
            try {
                talent.executeBehavior(onShopStartTalentsContext);
            } catch (e) {
                console.error(e);
            }
        });

        await triggerEquippedItems(this.state.player, onShopStartTalentsContext, TriggerType.SHOP_START);
        triggerInventoryItems(this.state.player, onShopStartTalentsContext, TriggerType.SHOP_START);
    }
}
