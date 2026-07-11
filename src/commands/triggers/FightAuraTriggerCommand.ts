import {Command} from '@colyseus/command';
import {TriggerType} from '../../common/types';
import {FightRoom} from '../../rooms/FightRoom';
import {Talent} from '../../talents/schema/TalentSchema';
import {BehaviorContext} from '../../common/BehaviorContext';
import {Player} from '../../players/schema/PlayerSchema';
import {buildBaseAndItemsSnapshot} from '../../common/statsUtils';

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
    }
}
