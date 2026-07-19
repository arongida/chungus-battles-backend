import { Player } from '../players/schema/PlayerSchema';
import { BehaviorContext } from './BehaviorContext';
import { TriggerType } from './types';

/**
 * Fires item behaviors for every equipped item subscribed to triggerType.
 *
 * Most behaviors are synchronous and run to completion inline, exactly as before.
 * A behavior may instead return a Promise (e.g. one that needs a DB round trip)
 * — those are collected and only awaited via the returned promise, so hot
 * combat-loop callers that don't await this function see no change in timing,
 * while callers that do await it (currently only ShopStartTriggerCommand) can
 * rely on the async work having finished.
 */
export function triggerEquippedItems(player: Player, context: BehaviorContext, triggerType: TriggerType): Promise<void> | void {
    const pending: Promise<void>[] = [];

    player.equippedItems.forEach((item, slot) => {
        if (item.triggerTypes?.includes(triggerType)) {
            try {
                const result = item.executeBehavior(context);
                const sendTrigger = () => context.client.send('trigger_item', {
                    playerId: context.attacker?.playerId ?? player.playerId,
                    itemId: item.itemId,
                    slot,
                });
                if (result instanceof Promise) {
                    pending.push(result.then(sendTrigger).catch((e) => console.error(e)));
                } else {
                    sendTrigger();
                }
            } catch (e) {
                console.error(e);
            }
        }
    });

    if (pending.length > 0) return Promise.all(pending).then(() => {});
}

/**
 * Fires item behaviors for every inventory (unequipped) item subscribed to
 * triggerType. Used for triggers like LEVEL_UP that should apply regardless
 * of whether the item is equipped (e.g. the Magic Ring evolving in the
 * inventory). Unlike triggerEquippedItems, there is no equipped slot to
 * animate, so no 'trigger_item' message is sent.
 */
export function triggerInventoryItems(player: Player, context: BehaviorContext, triggerType: TriggerType): void {
    player.inventory.forEach((item) => {
        if (item.triggerTypes?.includes(triggerType)) {
            try {
                item.executeBehavior(context);
            } catch (e) {
                console.error(e);
            }
        }
    });
}
