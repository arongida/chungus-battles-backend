import {Command} from '@colyseus/command';
import {TriggerType} from '../../common/types';
import {FightRoom} from '../../rooms/FightRoom';
import {Talent} from '../../talents/schema/TalentSchema';
import {BehaviorContext} from '../../common/BehaviorContext';
import {Player} from '../../players/schema/PlayerSchema';
import {buildBaseAndItemsSnapshot} from '../../common/statsUtils';
import {baseLuckyFindChance} from '../ShopUpgradeUtils';

export class FightAuraTriggerCommand extends Command<FightRoom> {
    execute() {
        this.startAuraEffectsLoop(this.state.player, this.state.enemy);
        this.startAuraEffectsLoop(this.state.enemy, this.state.player);
    }

    startAuraEffectsLoop(player: Player, enemy?: Player) {

        const auraTalents: Talent[] = player.talents.filter((talent) => talent.triggerTypes.includes(TriggerType.AURA));

        const attackerSnapshot = buildBaseAndItemsSnapshot(player);

        let behaviorContext: BehaviorContext = {
            client: this.state.playerClient,
            attacker: player,
            defender: enemy,
            questItems: this.state.questItems,
            commandDispatcher: this.room.dispatcher,
            trigger: TriggerType.AURA,
            attackerSnapshot,
        };

        auraTalents.forEach((talent) => {
            this.state.skillsTimers.push(
                this.clock.setInterval(() => {
                    try {
                        talent.executeBehavior(behaviorContext);
                    } catch (e) {
                        console.error(e);
                    }
                }, 1000)
            );
        });

        player.equippedItems.forEach((item, slot) => {
            if (item.triggerTypes?.includes(TriggerType.AURA)) {
                this.state.skillsTimers.push(
                    this.clock.setInterval(() => {
                        try {
                            const result = item.executeBehavior(behaviorContext);
                            // Aura items don't attack, so this is their only visual cue —
                            // mirrors the trigger_item send in triggerEquippedItems.
                            const sendTrigger = () => behaviorContext.client?.send('trigger_item', {
                                playerId: player.playerId,
                                itemId: item.itemId,
                                slot,
                            });
                            if (result instanceof Promise) {
                                result.then(sendTrigger).catch((e) => console.error(e));
                            } else {
                                sendTrigger();
                            }
                        } catch (e) {
                            console.error(e);
                        }
                    }, 1000)
                );
            }
        });

        // Keep the hidden shop-roll stat seeded during the fight too — previously only the draft
        // ever wrote it, so it displayed 0% mid-fight. Registered LAST, not first: ClockTimer.tick()
        // (see @colyseus/timer ClockTimer.ts) iterates its `delayed` list in REVERSE registration
        // order, so the most-recently-pushed interval runs FIRST each tick. Registering this seed
        // after the talent/item loops above means it still executes before them every tick, so any
        // of them that modify luckyFindChance (Black Market Contact, Ring of Immortality) compose
        // on a fresh base instead of the base clobbering their result a moment later.
        this.state.skillsTimers.push(
            this.clock.setInterval(() => {
                player.luckyFindChance = baseLuckyFindChance(player.level) + player.luckyFindMythicBonus;
            }, 1000)
        );
    }
}
