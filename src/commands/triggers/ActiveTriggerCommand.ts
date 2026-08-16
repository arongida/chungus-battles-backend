import {Command} from '@colyseus/command';
import {Talent} from '../../talents/schema/TalentSchema';
import {Item} from '../../items/schema/ItemSchema';
import {TalentBehaviorContext} from '../../talents/behavior/TalentBehaviorContext';
import {TriggerType} from '../../common/types';
import {FightRoom} from '../../rooms/FightRoom';
import {Player} from '../../players/schema/PlayerSchema';
import {BehaviorContext} from '../../common/BehaviorContext';
import {applyCooldownReduction} from '../../common/cooldown';

export class ActiveTriggerCommand extends Command<FightRoom> {
    execute() {
        this.startActiveEffectsLoop(this.state.player, this.state.enemy);
        this.startActiveEffectsLoop(this.state.enemy, this.state.player);
    }

    /**
     * Schedules one self-rescheduling timer for a single active skill. Unlike a plain
     * `clock.setInterval` (fixed for the whole fight), this clears and re-creates itself after
     * every firing — same idiom as FightRoom.startSingleWeaponTimer for attack speed — so a
     * live change to `player.cooldownReduction` (Flowering Staff/Magic Ring/Wand of Fire
     * stacking mid-fight) speeds up the NEXT activation instead of only ones picked after a
     * fresh fight start.
     */
    private scheduleActive(player: Player, baseIntervalMs: number, run: () => void) {
        // Guard against a mis-seeded DB doc (activationRate 0/undefined) creating an
        // Infinity/NaN-interval timer.
        if (!baseIntervalMs || !isFinite(baseIntervalMs)) return;

        const start = () => {
            const timer = this.clock.setInterval(() => {
                try {
                    run();
                } catch (e) {
                    console.error(e);
                }
                timer.clear();
                player.activeSkillTimers.delete(timer);
                start();
            }, applyCooldownReduction(baseIntervalMs, player.cooldownReduction));
            this.state.skillsTimers.push(timer);
            // Shield Bash (item skill): lets Player.setStunned pause/resume exactly this player's
            // active-skill timers without touching the enemy's — see activeSkillTimers' comment.
            player.activeSkillTimers.add(timer);
        };
        start();
    }

    startActiveEffectsLoop(player: Player, enemy: Player) {
        const activeTalents: Talent[] = player.talents.filter((talent) =>
            talent.triggerTypes.includes(TriggerType.ACTIVE)
        );

        const activeEffectBehaviorContext: TalentBehaviorContext = {
            client: this.state.playerClient,
            attacker: player,
            defender: enemy,
            clock: this.clock,
            commandDispatcher: this.room.dispatcher,
            trigger: TriggerType.ACTIVE
        };

        activeTalents.forEach((talent: Talent) => {
            this.scheduleActive(player, (1 / talent.activationRate) * 1000, () => {
                talent.executeBehavior(activeEffectBehaviorContext);
            });
        });

        const activeItemContext: BehaviorContext = {
            client: this.state.playerClient,
            attacker: player,
            defender: enemy,
            clock: this.clock,
            commandDispatcher: this.room.dispatcher,
            trigger: TriggerType.ACTIVE
        };

        player.equippedItems.forEach((item: Item, slot: string) => {
            if (item.triggerTypes?.includes(TriggerType.ACTIVE)) {
                this.scheduleActive(player, (1 / item.activationRate) * 1000, () => {
                    item.executeBehavior(activeItemContext);
                    // Flashes the equip-slot icon (see triggerUtils.ts's triggerEquippedItems,
                    // whose 'trigger_item' send this mirrors) — every other trigger command routes
                    // items through that helper, but ACTIVE needs its own per-item reschedule loop
                    // above, so it isn't wired through there and has to send this itself.
                    this.state.playerClient.send('trigger_item', {
                        playerId: player.playerId,
                        itemId: item.itemId,
                        slot,
                    });
                });
            }
        });
    }
}
