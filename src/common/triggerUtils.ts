import { Player } from '../players/schema/PlayerSchema';
import { BehaviorContext } from './BehaviorContext';
import { TriggerType } from './types';
import { SCALING_ORDER } from './scalingRegistry';
import { ItemSkillBehaviors } from '../items/behavior/ItemSkillBehaviors';
import { getSkillSlot2View } from '../items/skills/itemSkillSlot2View';
import { foldScalingOutputs } from './statsUtils';

/**
 * Fires item behaviors for every equipped item subscribed to triggerType.
 *
 * Most behaviors are synchronous and run to completion inline, exactly as before.
 * A behavior may instead return a Promise (e.g. one that needs a DB round trip)
 * — those are collected and only awaited via the returned promise, so hot
 * combat-loop callers that don't await this function see no change in timing,
 * while callers that do await it (currently only ShopStartTriggerCommand) can
 * rely on the async work having finished.
 *
 * `skipSkillIds` (only ever passed for TriggerType.AURA) excludes the skill/skillId2 slot of a
 * scaling source already run by runScalingSources below — see its header comment for why.
 */
export function triggerEquippedItems(player: Player, context: BehaviorContext, triggerType: TriggerType, skipSkillIds?: Set<number>): Promise<void> | void {
    const pending: Promise<void>[] = [];

    player.equippedItems.forEach((item, slot) => {
        if (item.triggerTypes?.includes(triggerType)) {
            try {
                const result = item.executeBehavior(context, skipSkillIds);
                // AURA re-fires every ~1s for as long as the item is equipped — there's no
                // discrete "activation" moment to flash for a continuous passive effect (it
                // would just pulse forever), so skip the client notification entirely. Other
                // triggers on the same item (e.g. Magic Ring's level-up/shop-start growth) are
                // separate triggerEquippedItems calls and still notify normally.
                if (triggerType === TriggerType.AURA) return;
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

/**
 * Runs every scaling source (item skills and talents whose AURA output is computed from another
 * stat — see scalingGraph.ts) in dependency order, folding each one's output into
 * `context.attackerSnapshot` before the next runs. Must be called with `context.trigger ===
 * TriggerType.AURA` and `context.attackerSnapshot` pointing at a mutable snapshot built by
 * statsUtils.buildFloorSnapshot — every node mutates that same object in place via
 * foldScalingOutputs, so each later node sees every earlier one's contribution. See
 * DraftAuraTriggerCommand / FightAuraTriggerCommand for the two callers.
 *
 * Deliberately bypasses triggerEquippedItems/Item.executeBehavior for the scaling skills: those
 * bundle an item's unique behavior + skillId + skillId2 into one call, which would re-run a
 * scaling skill's AURA write a second time (against the now-fully-folded snapshot, i.e.
 * self-feeding) once the caller's own later triggerEquippedItems pass covers the item's
 * remaining triggers. Callers must pass SCALING_SKILL_IDS to that later triggerEquippedItems
 * call so it skips the skill slots already handled here.
 */
export function runScalingSources(player: Player, context: BehaviorContext): void {
    const snapshot = context.attackerSnapshot;
    if (!snapshot) {
        console.error('runScalingSources called without attackerSnapshot — scaling sources would self-feed, skipping.');
        return;
    }
    SCALING_ORDER.forEach((nodeId) => {
        if (nodeId.startsWith('skill:')) {
            const skillId = Number(nodeId.slice('skill:'.length));
            const behavior = ItemSkillBehaviors[skillId];
            if (behavior) {
                player.equippedItems.forEach((item) => {
                    try {
                        if (item.skillId === skillId) behavior({ ...context, item });
                        if (item.skillId2 === skillId) behavior({ ...context, item: getSkillSlot2View(item) });
                    } catch (e) {
                        console.error(e);
                    }
                });
            }
        } else {
            const talentId = Number(nodeId.slice('talent:'.length));
            const talent = player.talents.find((t) => t.talentId === talentId);
            if (talent) {
                try {
                    talent.executeBehavior(context);
                } catch (e) {
                    console.error(e);
                }
            }
        }
        foldScalingOutputs(snapshot, player, nodeId);
    });
}
