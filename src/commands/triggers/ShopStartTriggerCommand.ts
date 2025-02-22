import {Command} from '@colyseus/command';
import {DraftRoom} from '../../rooms/DraftRoom';
import {Talent} from '../../talents/schema/TalentSchema';
import {TriggerType} from '../../common/types';
import {ItemCollection} from '../../item-collections/schema/ItemCollectionSchema';
import {BehaviorContext} from "../../common/BehaviorContext";

export class ShopStartTriggerCommand extends Command<DraftRoom> {
    execute() {

        const onShopStartTalents: Talent[] = this.state.player.talents.filter(
            (talent) => talent.triggerTypes.includes(TriggerType.SHOP_START)
        );
        const onShopStartItemCollections: ItemCollection[] = this.state.player.activeItemCollections.filter(
            (itemCollection) => itemCollection.triggerTypes.includes(TriggerType.SHOP_START)
        );
        const onShopStartTalentsContext: BehaviorContext = {
            client: this.state.playerClient,
            attacker: this.state.player,
            shop: this.state.shop,
            trigger: TriggerType.SHOP_START
        };
        onShopStartItemCollections.forEach((itemCollection) => {
            itemCollection.executeBehavior(onShopStartTalentsContext);
        });
        onShopStartTalents.forEach((talent) => {
            talent.executeBehavior(onShopStartTalentsContext);
        });
    }
}
