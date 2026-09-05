import {Command} from '@colyseus/command';
import {TriggerType} from '../../common/types';
import {FightRoom} from '../../rooms/FightRoom';
import {BehaviorContext} from '../../common/BehaviorContext';
import {Player} from '../../players/schema/PlayerSchema';
import {buildFloorSnapshot} from '../../common/statsUtils';
import {baseLuckyFindChance} from '../ShopUpgradeUtils';
import {triggerEquippedItems, runScalingSources} from '../../common/triggerUtils';
import {SCALING_TALENT_IDS, SCALING_SKILL_IDS} from '../../common/scalingRegistry';

export class FightAuraTriggerCommand extends Command<FightRoom> {
    execute() {
        this.startAuraEffectsLoop(this.state.player, this.state.enemy);
        this.startAuraEffectsLoop(this.state.enemy, this.state.player);
    }

    /**
     * Single interval per player runs the full ordered scaling pass, then every non-scaling
     * AURA talent/item — replaces the old per-talent `clock.setInterval` list (whose shared
     * `attackerSnapshot` was built ONCE at fight start and never refreshed) plus a separate item
     * interval, and the lucky-find re-seed's dependence on ClockTimer's reverse registration
     * order to run before them. The snapshot is now rebuilt fresh every tick, matching
     * DraftAuraTriggerCommand.
     */
    startAuraEffectsLoop(player: Player, enemy?: Player) {
        this.state.skillsTimers.push(
            this.clock.setInterval(() => {
                try {
                    // Keep the hidden shop-roll stat seeded during the fight too — a fight
                    // doesn't spend it, but Bulk Discount/Insider Trading's status lines should
                    // still read live.
                    player.luckyFindChance = baseLuckyFindChance(player.level) + player.luckyFindMythicBonus;
                    // Ironblood (item skill): re-seeded to false before the scaling pass runs, so
                    // a tick where poison isn't actually cleansed (no poison, or no regen budget)
                    // can't keep last tick's suppression latched — see statsUtils.ts.
                    player.regenSuppressed = false;

                    const attackerSnapshot = buildFloorSnapshot(player);
                    const behaviorContext: BehaviorContext = {
                        client: this.state.playerClient,
                        attacker: player,
                        defender: enemy,
                        clock: this.clock,
                        questItems: this.state.questItems,
                        commandDispatcher: this.room.dispatcher,
                        trigger: TriggerType.AURA,
                        attackerSnapshot,
                    };

                    // Scaling sources first, in dependency order — see
                    // DraftAuraTriggerCommand for the identical pattern and reasoning.
                    runScalingSources(player, behaviorContext);

                    player.talents.forEach((talent) => {
                        if (!talent.triggerTypes.includes(TriggerType.AURA)) return;
                        if (SCALING_TALENT_IDS.has(talent.talentId)) return;
                        try {
                            talent.executeBehavior(behaviorContext);
                        } catch (e) {
                            console.error(e);
                        }
                    });

                    // Re-checked every tick rather than snapshotted once per item — an item can
                    // gain a new AURA-triggered skill mid-fight (Weapon Whisperer granting its
                    // bonus item skill to an already-Mythic weapon the first time its own
                    // talent aura ticks happens to land inside FightRoom rather than during the
                    // preceding draft), and that skill must start ticking the moment it's
                    // granted rather than being silently skipped for the rest of the fight.
                    // SCALING_SKILL_IDS is skipped here since those already ran, in dependency
                    // order, via runScalingSources above.
                    triggerEquippedItems(player, behaviorContext, TriggerType.AURA, SCALING_SKILL_IDS);
                } catch (e) {
                    console.error(e);
                }
            }, 1000)
        );
    }
}
