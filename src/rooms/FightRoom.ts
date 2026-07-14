import { Client, Room } from '@colyseus/core';
import { FightState } from './schema/FightState';
import { buildJoe, getPlayer, getSameRoundPlayer, incrementRunsEnded, JOE_PLAYER_ID, snapshotPlayer, updatePlayer } from '../players/db/Player';
import { Player } from '../players/schema/PlayerSchema';
import { delay } from '../common/utils';
import { END_BURN_START_MS, FightResultType, GAME_VERSION, WINS_TO_WIN } from '../common/types';
import { Dispatcher } from '@colyseus/command';
import { ReplayRecorder } from '../replay/ReplayRecorder';
import { saveReplay } from '../replay/db/Replay';
import { randomUUID } from 'crypto';
import { ActiveTriggerCommand } from '../commands/triggers/ActiveTriggerCommand';
import { FightStartTriggerCommand } from '../commands/triggers/FightStartTriggerCommand';
import { FightEndTriggerCommand } from '../commands/triggers/FightEndTriggerCommand';
import { OnDamageTriggerCommand } from '../commands/triggers/OnDamageTriggerCommand';
import { OnAttackedTriggerCommand } from '../commands/triggers/OnAttackedTriggerCommand';
import { OnAttackTriggerCommand } from '../commands/triggers/OnAttackTriggerCommand';
import { TalentType } from '../talents/types/TalentTypes';
import { ensureMartialFists } from '../talents/behavior/TalentBehaviors';
import { cloneItem, getItemById, getQuestItems } from '../items/db/Item';
import { rollItemStats } from '../items/stats/itemStatRoller';
import { applyRarityUpgrade, getEquippedUpgradeableItems } from '../commands/ShopUpgradeUtils';
import { FightAuraTriggerCommand } from '../commands/triggers/FightAuraTriggerCommand';
import { UpdateStatsCommand } from "../commands/UpdateStatsCommand";
import { OnDodgeTriggerCommand } from "../commands/triggers/OnDodgeTriggerCommand";
import { Item } from '../items/schema/ItemSchema';
import { ItemType } from '../items/types/ItemTypes';
import { CombatLogMessage, FightSideStats, FightStatsMessage, GameWinMessage, LossRewardResultMessage, RewardGainMessage, SelectLossRewardMessage, SetFightSpeedMessage, fmt } from '../common/MessageTypes';
import { track } from '../talents/behavior/TalentBehaviors';
import { BURN_DAMAGE_PER_STACK } from '../items/behavior/uniqueItemBalance';

const ALLOWED_FIGHT_SPEEDS = [0.5, 1, 2];

export class FightRoom extends Room {
    declare state: FightState;
    maxClients = 1;

    dispatcher = new Dispatcher(this);
    // Game-time timestamps (clock.elapsedTime): replays of a sped-up/slowed-down fight
    // still play back at normal 1x pacing.
    private recorder = new ReplayRecorder(() => this.clock.elapsedTime);
    // Stable id for the fight currently in progress — generated up front (in startBattle)
    // so it can be included in the end_battle broadcast, not just the fire-and-forget
    // replay save that happens afterward. Lets the client deep-link "Watch Replay".
    private replayId = randomUUID();
    // Built once in handleFightEnd, before any end_battle broadcast — included in every
    // end_battle payload and the saved replay doc. null until the fight actually concludes.
    private fightStatsPayload: FightStatsMessage | null = null;

    onCreate() {
        this.state = new FightState();

        // Wrap broadcast so every outbound event is captured by the recorder.
        const origBroadcast = this.broadcast.bind(this);
        (this as any).broadcast = (type: string, message?: any, options?: any) => {
            this.stampCombatLogSeq(type, message);
            this.recorder.record('broadcast', type, message);
            return origBroadcast(type, message, options);
        };

        this.onMessage('chat', (client, message) => {
            this.broadcast('messages', `${client.sessionId}: ${message}`);
        });

        this.onMessage('abandon_run', async (client) => {
            this.state.player.lives = 0;
            await updatePlayer(this.state.player);
        });

        this.onMessage('select_loss_reward', (client, message: SelectLossRewardMessage) => {
            this.handleSelectLossReward(client, message);
        });

        // Concede the current fight only — counts as a normal loss (life + loss-bonus
        // reward), unlike abandon_run which ends the whole run. Works any time before the
        // fight has already resolved, including during the pre-battle countdown.
        this.onMessage('forfeit_fight', () => {
            if (this.state.fightResult) return;
            this.state.fightResult = FightResultType.LOSE;
            this.concludeBattle();
        });

        this.onMessage('set_fight_speed', (client, message: SetFightSpeedMessage) => {
            const speed = Number(message?.speed);
            if (!ALLOWED_FIGHT_SPEEDS.includes(speed)) {
                client.send('error', 'Invalid fight speed.');
                return;
            }
            if (this.state.fightResult) return;
            this.state.timeScale = speed;
            this.applySimulationResolution(speed);
        });

        //start clock for timings
        this.clock.start();
        this.patchClockTimeScale();

        //set simulation interval for room
        this.applySimulationResolution(this.state.timeScale);

        this.autoDispose = false;
    }

    // All fight timers (attacks, poison/burn/regen ticks, skill loops, end burn, delay())
    // run off this.clock, and every Delayed advances by the deltaTime computed in tick().
    // Scaling that delta scales the whole fight uniformly, so outcomes are unaffected.
    // Gated on battleStarted: the countdown, post-fight delays and the onLeave disconnect
    // timeout stay real-time.
    //
    // The tick body is reimplemented (mirroring ClockTimer.tick) rather than wrapped:
    // ClockTimer.tick() ignores its arguments and reads this.now() internally, so a
    // scaled time cannot be injected from outside. currentTime stays wall-clock because
    // Colyseus's per-client message rate limiting reads it; elapsedTime becomes game-time,
    // which keeps the 65s end-burn gate and replay timestamps consistent at any speed.
    private patchClockTimeScale() {
        const clock = this.clock as any;
        clock.tick = () => {
            const now = clock.now();
            const scale = this.state.battleStarted ? this.state.timeScale : 1;
            clock.deltaTime = (now - clock.currentTime) * scale;
            clock.currentTime = now;
            clock.elapsedTime += clock.deltaTime;
            const delayedList = clock.delayed;
            let i = delayedList.length;
            while (i--) {
                const delayed = delayedList[i];
                if (delayed.active) {
                    delayed.tick(clock.deltaTime);
                } else {
                    delayedList.splice(i, 1);
                }
            }
        };
    }

    // Keep the game-time tick quantum at ~100ms: at 2x a 100ms wall tick would deliver
    // 200ms of game time, making sub-second attack intervals coarse. Slowing down only
    // gains resolution, so the interval is never lengthened past 100ms.
    private applySimulationResolution(scale: number) {
        const wallMs = scale > 1 ? Math.round(100 / scale) : 100;
        this.setSimulationInterval(() => this.update(), wallMs);
    }

    async onJoin(client: Client, options: any) {
        console.log('[FightRoom]', client.sessionId, 'joined!');
        console.log('[FightRoom]', 'player id', options.playerId);

        // check if player id is provided
        if (!options.playerId) throw new Error('Player ID is required!');

        //get player from db
        await delay(1000, this.clock);
        let player = await getPlayer(options.playerId);
        if (!player) throw new Error('Player not found!');

        //set up player state
        await this.setUpState(player);

        //set up enemy state
        if (!this.state.enemy.playerId) {
            // pass the freshly loaded player: copyFrom drops the plain (non-@type)
            // nextFightEnemyId/Round fields, so state.player never carries them.
            let enemy = await this.pickEnemy(options.enemyPlayerId, player);
            //set up enemy state
            await this.setUpState(enemy, true);
        }

        // check if player is already playing
        if (this.state.player.sessionId !== '') throw new Error('Player already playing!');
        if (this.state.player.lives <= 0) throw new Error('Player has no lives left!');
        this.state.playerClient = client;
        this.wrapPlayerClient(client);
        this.state.player.sessionId = client.sessionId;

        //set up initial room state
        this.state.questItems.clear();
        (await getQuestItems()).forEach(item => this.state.questItems.push(item));
        // this.state.availableItemCollections = await getAllItemCollections();

        //start battle after 3 seconds
        let countdown = 3;
        const countdownTimer = this.clock.setInterval(() => {
            this.logCombat('broadcast', { text: `The battle will begin in ${countdown--} second(s)...`, kind: 'countdown' });
        }, 1000);

        this.clock.setTimeout(async () => {
            countdownTimer.clear();
            this.logCombat('broadcast', { text: 'The battle begins!', kind: 'fight_start' });
            console.log('[FightRoom]', 'battle started!');
            console.log('[FightRoom]', 'player', this.state.player.name);
            console.log('[FightRoom]', 'enemy', this.state.enemy.name);
            this.state.battleStarted = true;
            this.startBattle();
        }, 3500);
    }

    // Priority order:
    // 1. Dev-only debug override ("next fight picker") — client-requested opponent, ignored
    //    in production regardless of what the client sends (spoof-proof).
    // 2. The opponent locked in at draft start (Next-Enemy Preview): honored only while
    //    nextFightEnemyRound matches the current round (round increments in onLeave, so a
    //    stale pick from a previous round is never reused). JOE_PLAYER_ID (0 — falsy, hence
    //    the != null checks) maps back to the deterministic buildJoe().
    // 3. Random same-round matchmaking fallback (round 1 lands here → same deterministic Joe).
    async pickEnemy(enemyPlayerId: any, player: Player): Promise<Player> {
        if (enemyPlayerId && process.env.NODE_ENV !== 'production') {
            const enemy = await getPlayer(Number(enemyPlayerId));
            if (enemy) return enemy;
        }
        if (player.nextFightEnemyRound === player.round && player.nextFightEnemyId != null) {
            if (player.nextFightEnemyId === JOE_PLAYER_ID) return buildJoe(player.playerId);
            const enemy = await getPlayer(player.nextFightEnemyId);
            if (enemy) return enemy;
            // Locked-in snapshot deleted before the fight — rare preview mismatch, fall through.
            console.warn('[FightRoom] locked-in enemy', player.nextFightEnemyId, 'not found — falling back to random matchmaking');
        }
        return getSameRoundPlayer(player.round, player.playerId);
    }

    async sendFightEndToClient() {
        await delay(2000, this.clock);
        if (!this.state.fightResult) return;

        if (this.state.gameWinPending) {
            this.broadcast('game_win', { wins: this.state.player.wins, losses: this.state.player.losses, season: GAME_VERSION } as GameWinMessage);
        } else if (this.state.player.lives <= 0) {
            this.broadcast('game_over', 'You have lost the game!');
        } else if (this.state.lossRewardOptions) {
            // Reconnect after a loss: resend the pending options (or the resolved outcome).
            this.broadcast('end_battle', this.buildLossEndBattlePayload());
        } else {
            this.broadcast('end_battle', { result: this.state.fightResult ?? 'win', replayId: this.currentReplayId, stats: this.currentFightStats, wins: this.state.player.wins });
        }
    }

    onDrop(client: Client) {
        console.log(`[FightRoom] allowReconnection(60) started  sid=${client.sessionId}`);
        // allow disconnected client to reconnect into this room until 60 seconds
        this.allowReconnection(client, 30);
        console.log(`[FightRoom] reconnected  sid=${client.sessionId} fightResult=${!!this.state.fightResult}`);
        // Re-wrap the reconnected client so sendFightEndToClient events are still captured.
        this.state.playerClient = client;
        this.wrapPlayerClient(client);
        this.sendFightEndToClient();
    }

    private wrapPlayerClient(client: Client): void {
        if ((client.send as any).__replayWrapped) return;
        const origSend = client.send.bind(client);
        (client as any).send = (type: string, message?: any) => {
            this.stampCombatLogSeq(type, message);
            this.recorder.record('send', type, message);
            return origSend(type, message);
        };
        (client.send as any).__replayWrapped = true;
    }

    // Monotonic sequence counter for combat_log messages. Logs are delivered via a mix
    // of buffered broadcast() and immediate client.send(), so arrival order on the
    // client isn't guaranteed — stamping seq here (the single choke point both delivery
    // paths pass through) lets the client sort them back into the order they were
    // actually emitted in.
    private combatLogSeq = 0;

    private stampCombatLogSeq(type: string, message?: any): void {
        if (type === 'combat_log' && message && typeof message === 'object') {
            message.seq = this.combatLogSeq++;
        }
    }

    async onLeave(client: Client, code: number) {
        console.log(`[FightRoom] onLeave  sid=${client.sessionId} code=${code} roomId=${this.roomId}`);
        // Let an in-flight item upgrade finish before saving, and default to the
        // gold option if the player left without choosing a loss reward.
        if (this.state.lossRewardApplication) await this.state.lossRewardApplication;
        if (this.state.lossRewardPending && this.state.lossRewardOptions) {
            this.state.lossRewardPending = false;
            this.state.player.gold += this.state.lossRewardOptions.goldAmount;
        }
        //save player state to db
        this.state.player.sessionId = '';
        //set player for next round
        this.state.player.round++;
        await updatePlayer(this.state.player);
        console.log(`[FightRoom] player saved, scheduling disconnect in 5s  roomId=${this.roomId}`);
        this.clock.setTimeout(() => {
            this.disconnect();
        }, 5000);

    }

    onDispose() {
        console.log('[FightRoom]', 'room', this.roomId, 'disposing...');
    }

    // Only meaningful once startBattle() has run (recorder.start() populates initialState) —
    // e.g. a fight forfeited during the pre-battle countdown never gets a recorded replay,
    // so the client shouldn't be pointed at a replayId that will 404.
    private get currentReplayId(): string | undefined {
        return this.recorder.initialState ? this.replayId : undefined;
    }

    // Same gating as currentReplayId: a fight forfeited during the pre-battle countdown
    // never builds stats (nothing happened yet), so omit rather than send all-zeros.
    private get currentFightStats(): FightStatsMessage | undefined {
        return this.recorder.initialState ? this.fightStatsPayload ?? undefined : undefined;
    }

    private buildFightStatsPayload(): FightStatsMessage {
        const sideFor = (self: Player, opponent: Player): FightSideStats => ({
            damageDealt: {
                weapon: Math.round(opponent.fightStats.damageTaken.normal),
                burn: Math.round(opponent.fightStats.damageTaken.burn),
                poison: Math.round(opponent.fightStats.damageTaken.poison),
            },
            healingReceived: Math.round(self.fightStats.healingReceived),
            damageReducedByDefense: Math.round(self.fightStats.damageReducedByDefense),
            attacksDodged: self.fightStats.attacksDodged,
            damageBlockedByInvincible: Math.round(self.fightStats.damageBlockedByInvincible),
        });
        return {
            player: sideFor(this.state.player, this.state.enemy),
            enemy: sideFor(this.state.enemy, this.state.player),
        };
    }

    private logCombat(target: Client | 'broadcast', entry: CombatLogMessage) {
        if (target === 'broadcast') this.broadcast('combat_log', entry);
        else target.send('combat_log', entry);
    }

    //this is running all the time
    update() {

        //update stats
        if (this.state.player && this.state.enemy) {
            this.dispatcher.dispatch(new UpdateStatsCommand());
        }

        //check for battle end
        if (this.state.battleStarted) {
            this.checkPoison(this.state.player, this.state.enemy);
            this.checkPoison(this.state.enemy, this.state.player);
            this.checkBurn(this.state.player, this.state.enemy);
            this.checkBurn(this.state.enemy, this.state.player);

            this.state.endBurnCountdownMs = Math.max(0, END_BURN_START_MS - this.clock.elapsedTime);

            if (this.clock.elapsedTime > END_BURN_START_MS && !this.state.endBurnTimer) {
                this.startEndBurnTimer();
            }

            if (
                (this.state.player.hp <= 0 && !this.state.player.invincible) ||
                (this.state.enemy.hp <= 0 && !this.state.enemy.invincible)
            ) {
                this.concludeBattle();
            }
        }
    }

    // Stops every combat timer and runs the win/lose/draw resolution. Shared by the
    // natural HP<=0 check in update() and the forfeit_fight handler below.
    private concludeBattle() {
        this.state.battleStarted = false;
        this.state.player.clearAllAttackTimers();
        this.state.enemy.clearAllAttackTimers();
        this.state.player.poisonTimer?.clear();
        this.state.enemy.poisonTimer?.clear();
        this.state.player.burnTimer?.clear();
        this.state.enemy.burnTimer?.clear();
        this.state.endBurnTimer?.clear();
        this.state.endBurnActive = false;
        this.state.endBurnCountdownMs = END_BURN_START_MS;
        this.state.skillsTimers.forEach((timer) => timer.clear());
        this.state.player.regenTimer?.clear();
        this.state.enemy.regenTimer?.clear();
        this.logCombat('broadcast', { text: 'The battle has ended!', kind: 'fight_end' });
        this.handleFightEnd();
    }

    startEndBurnTimer() {
        if (this.state.endBurnTimer) return;
        this.state.endBurnActive = true;
        this.state.endBurnCountdownMs = 0;
        this.state.endBurnTimer = this.clock.setInterval(() => {
            const burnDamage = this.state.endBurnDamage;
            const increment = Math.pow(10, Math.floor(Math.log10(burnDamage)));
            this.state.endBurnDamage += increment;
            this.state.player.hp -= burnDamage;
            this.state.enemy.hp -= burnDamage;
            this.logCombat('broadcast', { text: `The battle is dragging on! Both players burned for ${burnDamage} damage!`, kind: 'end_burn', damage: burnDamage, attackerId: this.state.player.playerId, defenderId: this.state.enemy.playerId });
            this.broadcast('damage', {
                playerId: this.state.player.playerId,
                damage: burnDamage,
                type: 'burn',
            });
            this.broadcast('damage', {
                playerId: this.state.enemy.playerId,
                damage: burnDamage,
                type: 'burn',
            });
        }, 1000);
    }

    createFistWeapon(): Item {
        const fist = new Item();
        fist.itemId = 0;
        fist.name = 'Fist';
        fist.baseMinDamage = 0;
        fist.baseMaxDamage = 0;
        fist.baseAttackSpeed = 0.8;
        fist.type = ItemType.WEAPON;
        return fist;
    }

    startWeaponAttackTimers(player: Player, enemy: Player) {
        player.clearAllAttackTimers();

        // Opponent snapshots saved before the Martial Artist rework have no fists in their hand
        // slots; timers are only created once, here, so prime the fists before iterating.
        if (player.talents.some((t) => t.talentId === TalentType.MARTIAL_ARTIST)) {
            ensureMartialFists(player);
        }

        player.equippedItems.forEach((item, slot) => {
            if (item.baseAttackSpeed > 0) {
                this.startSingleWeaponTimer(player, enemy, item, slot);
            }
        });

        if (player.attackTimers.size === 0) {
            const fist = this.createFistWeapon();
            this.startSingleWeaponTimer(player, enemy, fist, 'fist');
        }
    }

    startSingleWeaponTimer(player: Player, enemy: Player, weapon: Item, slot: string) {
        const effectiveSpeed = weapon.baseAttackSpeed * player.attackSpeedMultiplier;
        const clampedSpeed = effectiveSpeed < 0.1 ? 0.1 : effectiveSpeed;
        const interval = (1 / clampedSpeed) * 1000;

        const timer = this.clock.setInterval(() => {
            this.tryWeaponAttack(player, enemy, weapon, slot);
            player.attackTimers.get(slot)?.clear();
            this.startSingleWeaponTimer(player, enemy, weapon, slot);
        }, interval);

        player.attackTimers.set(slot, timer);
    }

    startRegenTimer(player: Player, opponent?: Player) {
        if (player.hpRegen) {
            player.regenTimer = this.clock.setInterval(() => {
                const healed = player.heal(player.hpRegen, opponent);
                if (healed === 0) return;
                const isMinusRegen = healed < 0;
                this.logCombat(this.state.playerClient, { text: `${player.name} regenerates ${fmt(healed)} hp!`, kind: 'regen', attackerId: player.playerId, healing: healed });
                this.state.playerClient.send(isMinusRegen ? 'damage' : 'healing', {
                    playerId: player.playerId,
                    healing: healed,
                    damage: healed * -1,
                    type: 'normal',
                });
            }, 1000);
        }
    }

    checkPoison(attacker: Player, defender: Player) {
        if (defender.poisonStack <= 0) return;
        const poisonTalents = attacker.talents.filter(t =>
            t.talentId === TalentType.POISON || t.talentId === TalentType.POISON_2
        );

        if (!defender.poisonTimer) {
            defender.poisonTimer = this.clock.setInterval(() => {
                const poisonDamage = defender.poisonStack * defender.maxHp * 0.002;

                this.dispatcher.dispatch(new OnDamageTriggerCommand(), {
                    defender: defender,
                    damage: poisonDamage,
                    attacker: attacker,
                    damageType: 'poison',
                });

                defender.takeDamage(poisonDamage, this.state.playerClient, 'poison');
                poisonTalents.forEach(t => track(t, 0, poisonDamage));
                this.logCombat(this.state.playerClient, { text: `${defender.name} takes ${fmt(poisonDamage)} poison damage!`, kind: 'poison_tick', defenderId: defender.playerId, damage: poisonDamage, poisonStacks: defender.poisonStack });
            }, 1000);
        }
    }

    checkBurn(attacker: Player, defender: Player) {
        if (defender.burnStack <= 0) return;
        const burnTalents = attacker.talents.filter(t => t.talentId === TalentType.BURNING_BLOOD);
        if (!defender.burnTimer) {
            defender.burnTimer = this.clock.setInterval(() => {
                const burnDamage = defender.burnStack * BURN_DAMAGE_PER_STACK;

                this.dispatcher.dispatch(new OnDamageTriggerCommand(), {
                    defender: defender,
                    damage: burnDamage,
                    attacker: attacker,
                    damageType: 'burn',
                });

                defender.takeDamage(burnDamage, this.state.playerClient, 'burn');
                burnTalents.forEach(t => track(t, 0, burnDamage));
                this.logCombat(this.state.playerClient, { text: `${defender.name} takes ${fmt(burnDamage)} burn damage!`, kind: 'burn_tick', defenderId: defender.playerId, damage: burnDamage, burnStacks: defender.burnStack });
            }, 1000);
        }
    }

    tryWeaponAttack(attacker: Player, defender: Player, weapon: Item, slot: string, isCounter = false) {
        const minDmg = weapon.baseMinDamage + attacker.accuracy;
        const strengthMultiplier = weapon.strengthScaling;
        const maxDmg = weapon.baseMaxDamage + attacker.strength * strengthMultiplier;
        const attackRoll = Math.random() * (maxDmg - minDmg) + minDmg;

        // Unstoppable Force (WARRIOR_3): consumes the empowered flag for this attack — skips the
        // dodge roll entirely and doubles the final damage below.
        const empowered = attacker.empoweredNextAttack;
        if (empowered) attacker.empoweredNextAttack = false;

        if (!empowered && defender.dodgeRate > 0) {
            const dodgeChance = 1 - 100 / (100 + defender.dodgeRate);

            if (Math.random() < dodgeChance) {
                defender.fightStats.attacksDodged++;
                this.logCombat(this.state.playerClient, { text: `${defender.name} dodged ${attacker.name}'s ${weapon.name}!`, kind: 'dodge', attackerId: attacker.playerId, defenderId: defender.playerId, weaponItemId: weapon.itemId });
                this.dispatcher.dispatch(new OnDodgeTriggerCommand(), {
                    attacker: attacker,
                    defender: defender,
                    isCounter: isCounter,
                });
                return;
            }
        }

        let damage = defender.getDamageAfterDefense(attackRoll);
        if (empowered) damage *= 2;

        this.dispatcher.dispatch(new OnAttackedTriggerCommand(), {
            attacker: attacker,
            defender: defender,
            damage: damage,
            weapon: weapon,
        });
        this.dispatcher.dispatch(new OnAttackTriggerCommand(), {
            attacker: attacker,
            defender: defender,
            damage: damage,
            weapon: weapon,
        });
        this.dispatcher.dispatch(new OnDamageTriggerCommand(), {
            defender: defender,
            damage: damage,
            attacker: attacker
        });

        defender.takeDamage(damage, this.state.playerClient);

        this.state.playerClient.send('trigger_item', { playerId: attacker.playerId, itemId: weapon.itemId, slot });
        this.logCombat(this.state.playerClient, { text: `${attacker.name}'s ${weapon.name} hits ${defender.name} for ${fmt(damage)} damage!`, kind: 'attack', attackerId: attacker.playerId, defenderId: defender.playerId, weaponItemId: weapon.itemId, slot, damage, rolledDamage: attackRoll, mitigatedDamage: attackRoll - damage, defenderHpAfter: defender.hp });
        this.state.playerClient.send('attack', attacker.playerId);
    }

    //start attack/skill loop for player and enemy, they run at different intervals according to their attack speed
    startBattle() {
        this.replayId = randomUUID();
        this.recorder.start({
            player: snapshotPlayer(this.state.player),
            enemy: snapshotPlayer(this.state.enemy),
            round: this.state.player.round,
            gameVersion: GAME_VERSION,
        });

        this.state.player.talents.forEach(t => t.resetCombatStats());
        this.state.enemy.talents.forEach(t => t.resetCombatStats());
        this.state.player.fightStats.reset();
        this.state.enemy.fightStats.reset();

        //start attack timers
        this.startWeaponAttackTimers(this.state.player, this.state.enemy);
        this.startWeaponAttackTimers(this.state.enemy, this.state.player);
        this.startRegenTimer(this.state.player, this.state.enemy);
        this.startRegenTimer(this.state.enemy, this.state.player);

        //start fight start effects
        this.dispatcher.dispatch(new FightStartTriggerCommand());

        //start active skill loops
        this.dispatcher.dispatch(new ActiveTriggerCommand());
        this.dispatcher.dispatch(new FightAuraTriggerCommand());

    }

    //get player, enemy and talents from db and map them to the room state
    async setUpState(player: Player, isEnemy = false) {
        if (!isEnemy) {
            this.state.player.copyFrom(player);
        } else {
            this.state.enemy.copyFrom(player);
        }
    }

    private async handleFightEnd() {
        // Health Flask's regen buff is a one-fight consumable — spent the moment this fight
        // concludes (win, lose, or draw), regardless of whether it actually procced any healing.
        this.state.player.pendingRegenBuff = 0;

        if (!this.state.fightResult) {
            if (this.state.player.hp <= 0 && this.state.enemy.hp <= 0) {
                this.state.fightResult = FightResultType.DRAW;
            } else if (this.state.player.hp <= 0) {
                this.state.fightResult = FightResultType.LOSE;
            } else {
                this.state.fightResult = FightResultType.WIN;
            }
        }

        // Built before any end_battle broadcast (win/lose/draw handlers below) and before
        // FightEndTriggerCommand, so post-fight trigger heals don't leak into the totals.
        if (this.recorder.initialState) {
            this.fightStatsPayload = this.buildFightStatsPayload();
        }

        switch (this.state.fightResult) {
            case FightResultType.WIN:
                this.handleWin();
                break;
            case FightResultType.LOSE:
                this.handleLoose();
                break;
            case FightResultType.DRAW:
                this.handleDraw();
                break;
        }

        const goldToGet = Math.floor(this.state.player.income);
        this.state.player.baseStats.income += 1;

        this.state.player.gold += goldToGet;
        this.state.player.xp += this.state.player.round * 2;

        const xpToGet = this.state.player.round * 2;
        this.logCombat('broadcast', { text: `You gained ${goldToGet} gold! (Income grows to ${goldToGet + 1} next fight)`, kind: 'reward', goldDelta: goldToGet });
        this.logCombat('broadcast', { text: `You gained ${xpToGet} xp!`, kind: 'reward', xpDelta: xpToGet });
        this.broadcast('reward_gain', { playerId: this.state.player.playerId, gold: goldToGet, xp: xpToGet } as RewardGainMessage);

        //trigger fight-end effects
        this.dispatcher.dispatch(new FightEndTriggerCommand());

        this.recorder.finalize();
        if (this.recorder.initialState) {
            saveReplay({
                replayId: this.replayId,
                originalPlayerId: this.state.player.originalPlayerId,
                playerId: this.state.player.playerId,
                round: this.state.player.round,
                playerName: this.state.player.name,
                enemyName: this.state.enemy.name,
                result: this.state.fightResult,
                gameVersion: GAME_VERSION,
                durationMs: this.recorder.durationMs(),
                initialState: this.recorder.initialState,
                events: this.recorder.events,
                truncated: this.recorder.truncated,
                stats: this.fightStatsPayload ?? undefined,
            }).catch(err => console.error('[FightRoom] replay save failed:', err));
        }
    }

    private handleWin() {
        this.logCombat('broadcast', { text: 'You win!', kind: 'result', result: 'win' });
        console.log(`'[FightRoom]' ${this.state.player.name} wins!`);
        this.state.player.wins++;

        if (this.state.player.wins >= WINS_TO_WIN) {
            this.state.gameWinPending = true;
            // Hard-ends the run server-side: DraftRoom/FightRoom onJoin already reject
            // lives <= 0, so a finished character can't be continued.
            this.state.player.lives = 0;
            this.broadcast('game_win', {
                wins: this.state.player.wins,
                losses: this.state.player.losses,
                season: GAME_VERSION,
            } as GameWinMessage);
            return;
        }

        this.broadcast('end_battle', { result: 'win', replayId: this.currentReplayId, stats: this.currentFightStats, wins: this.state.player.wins });
    }

    private handleLoose() {
        this.logCombat('broadcast', { text: 'You loose!', kind: 'result', result: 'lose' });
        console.log(`[FightRoom]' ${this.state.player.name} looses!`);
        this.state.player.losses++;
        this.state.player.lives--;
        if (this.state.player.lives <= 0) {
            // Run truly over — credit the enemy who delivered the final blow and remember them
            // as this character's nemesis. Set directly on state.player (not via copyFrom, so
            // the fields don't need @type) and persisted once by the normal onLeave -> updatePlayer.
            const killer = this.state.enemy;
            this.state.player.killedByPlayerId = killer.playerId;
            this.state.player.killedByOriginalPlayerId = killer.originalPlayerId;
            this.state.player.killedByName = killer.name;
            incrementRunsEnded(killer.originalPlayerId); // fire-and-forget, like saveReplay
            this.broadcast('game_over', 'You have lost the game!');
        } else {
            const goldAmount = this.state.player.lives === 1 ? 30
                             : this.state.player.lives === 2 ? 20
                             : 10;
            this.state.lossRewardOptions = {
                goldAmount,
                xpAmount: Math.round(goldAmount * 1.2),
                itemUpgradeAvailable: getEquippedUpgradeableItems(this.state.player).length > 0,
            };
            this.state.lossRewardPending = true;
            this.broadcast('end_battle', this.buildLossEndBattlePayload());
        }
    }

    private buildLossEndBattlePayload() {
        return {
            result: 'lose',
            replayId: this.currentReplayId,
            stats: this.currentFightStats,
            lossReward: {
                ...this.state.lossRewardOptions,
                outcome: this.state.lossRewardOutcome ?? undefined,
            },
        };
    }

    private handleSelectLossReward(client: Client, message: SelectLossRewardMessage) {
        const state = this.state;
        if (!state.lossRewardPending || !state.lossRewardOptions) {
            client.send('error', 'No loss reward to choose.');
            return;
        }
        const choice = message?.choice;
        if (choice !== 'gold' && choice !== 'xp' && choice !== 'item_upgrade') {
            client.send('error', 'Unknown loss reward choice.');
            return;
        }
        if (choice === 'item_upgrade' && !state.lossRewardOptions.itemUpgradeAvailable) {
            client.send('error', 'No upgradeable item.');
            return;
        }
        state.lossRewardPending = false;

        if (choice === 'gold' || choice === 'xp') {
            this.grantLossReward(choice, choice === 'gold' ? state.lossRewardOptions.goldAmount : state.lossRewardOptions.xpAmount);
            return;
        }
        state.lossRewardApplication = this.applyLossItemUpgrade(state.lossRewardOptions.goldAmount);
    }

    private grantLossReward(choice: 'gold' | 'xp', amount: number) {
        const player = this.state.player;
        if (choice === 'gold') {
            player.gold += amount;
            this.logCombat('broadcast', { text: `You received ${amount} bonus gold for losing!`, kind: 'reward', goldDelta: amount });
            this.broadcast('reward_gain', { playerId: player.playerId, gold: amount } as RewardGainMessage);
            this.state.lossRewardOutcome = { choice, gold: amount };
        } else {
            // Raw xp add only — level-up resolves in DraftRoom.checkLevelUp on rejoin.
            player.xp += amount;
            this.logCombat('broadcast', { text: `You received ${amount} bonus XP for losing!`, kind: 'reward', xpDelta: amount });
            this.broadcast('reward_gain', { playerId: player.playerId, xp: amount } as RewardGainMessage);
            this.state.lossRewardOutcome = { choice, xp: amount };
        }
        this.broadcast('loss_reward_result', this.state.lossRewardOutcome as LossRewardResultMessage);
    }

    private async applyLossItemUpgrade(fallbackGold: number) {
        const player = this.state.player;
        const candidates = getEquippedUpgradeableItems(player);
        const picked = candidates[Math.floor(Math.random() * candidates.length)];
        const base = picked ? await getItemById(picked.item.itemId) : null;
        if (!base) {
            // No candidate or missing template — fall back to the gold option.
            this.grantLossReward('gold', fallbackGold);
            return;
        }

        // Merge a freshly rolled copy of the template, same as lucky shop finds.
        const rolled = cloneItem(base);
        rollItemStats(rolled);
        applyRarityUpgrade(picked.item, rolled, player, false);
        if (picked.slot) player.equippedItems.set(picked.slot, picked.item);

        this.logCombat('broadcast', { text: `Your ${picked.item.name} was upgraded for losing!`, kind: 'reward', itemId: picked.item.itemId });
        this.state.lossRewardOutcome = {
            choice: 'item_upgrade',
            item: { itemId: picked.item.itemId, name: picked.item.name, rarity: picked.item.rarity },
        };
        this.broadcast('loss_reward_result', this.state.lossRewardOutcome as LossRewardResultMessage);
    }

    private handleDraw() {
        console.log('[FightRoom]', 'draw!');
        this.logCombat('broadcast', { text: "It's a draw!", kind: 'result', result: 'draw' });
        this.broadcast('end_battle', { result: 'draw', replayId: this.currentReplayId, stats: this.currentFightStats });
    }
}
