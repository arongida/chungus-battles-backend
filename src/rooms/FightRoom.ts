import { Client, Room } from '@colyseus/core';
import { FightState } from './schema/FightState';
import { getHighestWin, getHighestWinByVersion, getPlayer, getSameRoundPlayer, snapshotPlayer, updatePlayer } from '../players/db/Player';
import { Player } from '../players/schema/PlayerSchema';
import { delay } from '../common/utils';
import { FightResultType, GAME_VERSION } from '../common/types';
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
import { getQuestItems } from '../items/db/Item';
import { FightAuraTriggerCommand } from '../commands/triggers/FightAuraTriggerCommand';
import { UpdateStatsCommand } from "../commands/UpdateStatsCommand";
import { OnDodgeTriggerCommand } from "../commands/triggers/OnDodgeTriggerCommand";
import { Item } from '../items/schema/ItemSchema';
import { ItemType } from '../items/types/ItemTypes';
import { CombatLogMessage, fmt } from '../common/MessageTypes';
import { track } from '../talents/behavior/TalentBehaviors';

export class FightRoom extends Room {
    declare state: FightState;
    maxClients = 1;

    dispatcher = new Dispatcher(this);
    private recorder = new ReplayRecorder();

    onCreate() {
        this.state = new FightState();

        // Wrap broadcast so every outbound event is captured by the recorder.
        const origBroadcast = this.broadcast.bind(this);
        (this as any).broadcast = (type: string, message?: any, options?: any) => {
            this.recorder.record('broadcast', type, message);
            return origBroadcast(type, message, options);
        };

        this.onMessage('chat', (client, message) => {
            this.broadcast('messages', `${client.sessionId}: ${message}`);
        });

        this.onMessage('continue_run', () => {
            this.state.versionWinPending = false;
            this.broadcast('end_battle', { result: 'win' });
        });

        this.onMessage('accept_win', () => {
            this.state.versionWinPending = false;
            this.broadcast('game_over', 'You are the best of the current version!');
        });

        this.onMessage('abandon_run', async (client) => {
            this.state.player.lives = 0;
            await updatePlayer(this.state.player);
        });

        //start clock for timings
        this.clock.start();

        //set simulation interval for room
        this.setSimulationInterval(() => this.update(), 100);

        this.autoDispose = false;
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
            let enemy = await getSameRoundPlayer(this.state.player.round, this.state.player.playerId);
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

        //start battle after 5 seconds
        let countdown = 5;
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
        }, 5500);
    }

    async sendFightEndToClient() {
        await delay(2000, this.clock);
        if (!this.state.fightResult) return;

        if (this.state.versionWinPending) {
            this.broadcast('version_win', {wins: this.state.player.wins});
        } else if (this.state.player.lives <= 0) {
            this.broadcast('game_over', 'You have lost the game!');
        } else {
            this.broadcast('end_battle', { result: this.state.fightResult ?? 'win' });
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
            this.recorder.record('send', type, message);
            return origSend(type, message);
        };
        (client.send as any).__replayWrapped = true;
    }

    async onLeave(client: Client, code: number) {
        console.log(`[FightRoom] onLeave  sid=${client.sessionId} code=${code} roomId=${this.roomId}`);
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

            if (this.clock.elapsedTime > 65000 && !this.state.endBurnTimer) {
                this.startEndBurnTimer();
            }

            if (
                (this.state.player.hp <= 0 && !this.state.player.invincible) ||
                (this.state.enemy.hp <= 0 && !this.state.enemy.invincible)
            ) {
                //set state and clear intervals
                this.state.battleStarted = false;
                this.state.player.clearAllAttackTimers();
                this.state.enemy.clearAllAttackTimers();
                this.state.player.poisonTimer?.clear();
                this.state.enemy.poisonTimer?.clear();
                this.state.endBurnTimer?.clear();
                this.state.skillsTimers.forEach((timer) => timer.clear());
                this.state.player.regenTimer?.clear();
                this.state.enemy.regenTimer?.clear();
                this.logCombat('broadcast', { text: 'The battle has ended!', kind: 'fight_end' });
                this.handleFightEnd();
            }
        }
    }

    startEndBurnTimer() {
        if (this.state.endBurnTimer) return;
        this.state.endBurnTimer = this.clock.setInterval(() => {
            const burnDamage = this.state.endBurnDamage++;
            this.state.player.hp -= burnDamage;
            this.state.enemy.hp -= burnDamage;
            this.logCombat('broadcast', { text: `The battle is dragging on! Both players burned for ${burnDamage} damage!`, kind: 'end_burn', damage: burnDamage, attackerId: this.state.player.playerId, defenderId: this.state.enemy.playerId });
            this.broadcast('damage', {
                playerId: this.state.player.playerId,
                damage: burnDamage,
            });
            this.broadcast('damage', {
                playerId: this.state.enemy.playerId,
                damage: burnDamage,
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

    startRegenTimer(player: Player) {
        if (player.hpRegen) {
            player.regenTimer = this.clock.setInterval(() => {
                player.hp += player.hpRegen;
                const isMinusRegen = player.hpRegen < 0;
                this.logCombat(this.state.playerClient, { text: `${player.name} regenerates ${fmt(player.hpRegen)} hp!`, kind: 'regen', attackerId: player.playerId, healing: player.hpRegen });
                this.state.playerClient.send(isMinusRegen ? 'damage' : 'healing', {
                    playerId: player.playerId,
                    healing: player.hpRegen,
                    damage: player.hpRegen * -1,
                });
            }, 1000);
        }
    }

    checkPoison(attacker: Player, defender: Player) {
        if (defender.poisonStack <= 0) return;
        const poisonTalent = attacker.talents.find((talent) => talent.talentId === TalentType.POISON);
        const poisonTalents = attacker.talents.filter(t =>
            t.talentId === TalentType.POISON || t.talentId === TalentType.ROGUE_3
        );

        const activationRate = poisonTalent ? poisonTalent.activationRate : 0.015;
        if (!defender.poisonTimer) {
            defender.poisonTimer = this.clock.setInterval(() => {
                const poisonDamage = defender.poisonStack * (activationRate * defender.maxHp + activationRate * 100) * 0.1;

                this.dispatcher.dispatch(new OnDamageTriggerCommand(), {
                    defender: defender,
                    damage: poisonDamage,
                    attacker: this.state.player,
                });

                defender.takeDamage(poisonDamage, this.state.playerClient);
                poisonTalents.forEach(t => track(t, 0, poisonDamage));
                this.logCombat(this.state.playerClient, { text: `${defender.name} takes ${fmt(poisonDamage)} poison damage!`, kind: 'poison_tick', defenderId: defender.playerId, damage: poisonDamage, poisonStacks: defender.poisonStack });
            }, 1000);
        }
    }

    tryWeaponAttack(attacker: Player, defender: Player, weapon: Item, slot: string) {
        const minDmg = weapon.baseMinDamage + attacker.accuracy;
        const strengthMultiplier = weapon.strengthScaling;
        const maxDmg = weapon.baseMaxDamage + attacker.strength * strengthMultiplier;
        const attackRoll = Math.random() * (maxDmg - minDmg) + minDmg;

        const damage = defender.getDamageAfterDefense(attackRoll);

        if (defender.dodgeRate > 0) {
            const dodgeChance = 1 - 100 / (100 + defender.dodgeRate);

            if (Math.random() < dodgeChance) {
                this.logCombat(this.state.playerClient, { text: `${defender.name} dodged ${attacker.name}'s ${weapon.name}!`, kind: 'dodge', attackerId: attacker.playerId, defenderId: defender.playerId, weaponItemId: weapon.itemId });
                this.dispatcher.dispatch(new OnDodgeTriggerCommand(), {
                    attacker: attacker,
                    defender: defender,
                });
                return;
            }
        }

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
        this.recorder.start({
            player: snapshotPlayer(this.state.player),
            enemy: snapshotPlayer(this.state.enemy),
            round: this.state.player.round,
            gameVersion: GAME_VERSION,
        });

        this.state.player.talents.forEach(t => t.resetCombatStats());
        this.state.enemy.talents.forEach(t => t.resetCombatStats());

        //start attack timers
        this.startWeaponAttackTimers(this.state.player, this.state.enemy);
        this.startWeaponAttackTimers(this.state.enemy, this.state.player);
        this.startRegenTimer(this.state.player);
        this.startRegenTimer(this.state.enemy);

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
        if (!this.state.fightResult) {
            if (this.state.player.hp <= 0 && this.state.enemy.hp <= 0) {
                this.state.fightResult = FightResultType.DRAW;
            } else if (this.state.player.hp <= 0) {
                this.state.fightResult = FightResultType.LOSE;
            } else {
                this.state.fightResult = FightResultType.WIN;
            }
        }

        switch (this.state.fightResult) {
            case FightResultType.WIN:
                await this.handleWin();
                break;
            case FightResultType.LOSE:
                this.handleLoose();
                break;
            case FightResultType.DRAW:
                this.handleDraw();
                break;
        }

        const goldToGet = this.state.player.income;
        this.state.player.baseStats.income += 1;

        this.state.player.gold += goldToGet;
        this.state.player.xp += this.state.player.round * 2;

        this.logCombat('broadcast', { text: `You gained ${goldToGet} gold! (Income grows to ${goldToGet + 1} next fight)`, kind: 'reward', goldDelta: goldToGet });
        this.logCombat('broadcast', { text: `You gained ${this.state.player.round * 2} xp!`, kind: 'reward' });

        //trigger fight-end effects
        this.dispatcher.dispatch(new FightEndTriggerCommand());

        this.recorder.finalize();
        if (this.recorder.initialState) {
            saveReplay({
                replayId: randomUUID(),
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
            }).catch(err => console.error('[FightRoom] replay save failed:', err));
        }
    }

    private async handleWin() {
        this.logCombat('broadcast', { text: 'You win!', kind: 'result', result: 'win' });
        console.log(`'[FightRoom]' ${this.state.player.name} wins!`);
        this.state.player.wins++;

        const highestWin = await getHighestWin();
        if (this.state.player.wins > highestWin) {
            this.broadcast('game_over', 'YOU ARE THE #1 TOP CHUNGERION! CHUNGRATULATIONS!');
            return;
        }

        if (!this.state.player.hasVersionWin) {
            const highestVersionWin = await getHighestWinByVersion(GAME_VERSION);
            if (this.state.player.wins > highestVersionWin) {
                this.state.player.hasVersionWin = true;
                this.state.versionWinPending = true;
                this.broadcast('version_win', {wins: this.state.player.wins});
                return;
            }
        }

        this.broadcast('end_battle', { result: 'win' });
    }

    private handleLoose() {
        this.logCombat('broadcast', { text: 'You loose!', kind: 'result', result: 'lose' });
        console.log(`[FightRoom]' ${this.state.player.name} looses!`);
        this.state.player.lives--;
        if (this.state.player.lives <= 0) {
            this.broadcast('game_over', 'You have lost the game!');
        } else {
            const lossBonus = this.state.player.lives === 1 ? 30
                            : this.state.player.lives === 2 ? 20
                            : 10;
            this.state.player.gold += lossBonus;
            this.logCombat('broadcast', { text: `You received ${lossBonus} bonus gold for losing!`, kind: 'reward', goldDelta: lossBonus });
            this.broadcast('end_battle', { result: 'lose', lossBonus });
        }
    }

    private handleDraw() {
        console.log('[FightRoom]', 'draw!');
        this.logCombat('broadcast', { text: "It's a draw!", kind: 'result', result: 'draw' });
        this.broadcast('end_battle', { result: 'draw' });
    }
}
