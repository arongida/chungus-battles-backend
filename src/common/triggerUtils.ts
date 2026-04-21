import { Player } from '../players/schema/PlayerSchema';
import { BehaviorContext } from './BehaviorContext';
import { TriggerType } from './types';

export function triggerEquippedItems(player: Player, context: BehaviorContext, triggerType: TriggerType) {
    player.equippedItems.forEach((item, slot) => {
        if (item.triggerTypes?.includes(triggerType)) {
            try {
                item.executeBehavior(context);
                context.client.send('trigger_item', {
                    playerId: context.attacker?.playerId ?? player.playerId,
                    itemId: item.itemId,
                    slot,
                });
            } catch (e) {
                console.error(e);
            }
        }
    });
}
