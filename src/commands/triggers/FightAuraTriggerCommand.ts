import {Command} from '@colyseus/command';
import {TriggerType} from '../../common/types';
import {FightRoom} from '../../rooms/FightRoom';
import {Talent} from '../../talents/schema/TalentSchema';
import {BehaviorContext} from '../../common/BehaviorContext';
import {Player} from '../../players/schema/PlayerSchema';
import {buildBaseAndItemsSnapshot} from '../../common/statsUtils';
import {baseLuckyFindChance} from '../ShopUpgradeUtils';
import {triggerEquippedItems} from '../../common/triggerUtils';

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

        // Re-checked every tick via triggerEquippedItems rather than snapshotted once per item —
        // an item can gain a new AURA-triggered skill mid-fight (Weapon Whisperer granting its
        // bonus item skill to an already-Mythic weapon the first time its own talent aura ticks
        // happens to land inside FightRoom rather than during the preceding draft), and that skill
        // must start ticking the moment it's granted rather than being silently skipped for the
        // rest of the fight because the per-item interval list was already built before it existed.
        // Mirrors DraftAuraTriggerCommand's identical triggerEquippedItems(..., AURA) call, which
        // re-scans every tick for the same reason. No trigger_item notification either way — this
        // is AURA-only, and a continuous passive effect re-firing every ~1s has no discrete
        // activation moment worth flashing (it would just pulse forever); triggerEquippedItems
        // already skips that notification for TriggerType.AURA.
        this.state.skillsTimers.push(
            this.clock.setInterval(() => {
                try {
                    triggerEquippedItems(player, behaviorContext, TriggerType.AURA);
                } catch (e) {
                    console.error(e);
                }
            }, 1000)
        );

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
