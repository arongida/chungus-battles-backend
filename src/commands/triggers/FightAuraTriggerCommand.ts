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
            clock: this.clock,
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
                            // No trigger_item notification here (unlike other triggerEquippedItems
                            // call sites) — this loop is AURA-only, and a continuous passive
                            // effect re-firing every ~1s has no discrete activation moment worth
                            // flashing (it would just pulse forever). See triggerUtils.ts's
                            // matching AURA skip for the non-fight-specific item trigger path.
                            item.executeBehavior(behaviorContext);
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
        // of them that modify luckyFindChance (Black Market Contact) compose on a fresh base
        // instead of the base clobbering their result a moment later.
        this.state.skillsTimers.push(
            this.clock.setInterval(() => {
                player.luckyFindChance = baseLuckyFindChance(player.level) + player.luckyFindMythicBonus;
            }, 1000)
        );
    }
}
