import {Client, Room} from '@colyseus/core';
import {FightState} from './schema/FightState';
import {getHighestWin, getPlayer, getSameRoundPlayer, updatePlayer} from '../players/db/Player';
import {Player} from '../players/schema/PlayerSchema';
import {delay} from '../common/utils';
import {FightResultType} from '../common/types';
import {getAllTalents} from '../talents/db/Talent';
import {Talent} from '../talents/schema/TalentSchema';
import {Dispatcher} from '@colyseus/command';
import {ActiveTriggerCommand} from '../commands/triggers/ActiveTriggerCommand';
import {FightStartTriggerCommand} from '../commands/triggers/FightStartTriggerCommand';
import {FightEndTriggerCommand} from '../commands/triggers/FightEndTriggerCommand';
import {OnDamageTriggerCommand} from '../commands/triggers/OnDamageTriggerCommand';
import {OnAttackedTriggerCommand} from '../commands/triggers/OnAttackedTriggerCommand';
import {OnAttackTriggerCommand} from '../commands/triggers/OnAttackTriggerCommand';
import {TalentType} from '../talents/types/TalentTypes';
import {ItemCollectionType} from '../item-collections/types/ItemCollectionTypes';
import {getQuestItems} from '../items/db/Item';
import {Item} from '../items/schema/ItemSchema';
import {SetUpQuestItemsCommand} from '../commands/SetUpQuestItemsCommand';
import {FightAuraTriggerCommand} from '../commands/triggers/FightAuraTriggerCommand';
import {UpdateStatsCommand} from "../commands/UpdateStatsCommand";
import {OnDodgeTriggerCommand} from "../commands/triggers/OnDodgeTriggerCommand";
import {getAllItemCollections} from "../item-collections/db/ItemCollection";

export class FightRoom extends Room<FightState> {
    maxClients = 1;

    dispatcher = new Dispatcher(this);

    onCreate() {
        this.setState(new FightState());

        this.onMessage('chat', (client, message) => {
            this.broadcast('messages', `${client.sessionId}: ${message}`);
        });

        //start clock for timings
        this.clock.start();

        //set simulation interval for room
        this.setSimulationInterval(() => this.update(), 100);

        this.autoDispose = false;
    }

    async onJoin(client: Client, options: any) {
        console.log(client.sessionId, 'joined!');
        console.log('player id', options.playerId);

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
        this.state.player.sessionId = client.sessionId;

        //set up initial room state
        this.state.availableTalents = (await getAllTalents()) as Talent[];
        this.dispatcher.dispatch(new SetUpQuestItemsCommand(), {questItemsFromDb: (await getQuestItems()) as Item[]});
        // this.state.availableItemCollections = await getAllItemCollections();

        //start battle after 5 seconds
        let countdown = 5;
        const countdownTimer = this.clock.setInterval(() => {
            this.broadcast('combat_log', `The battle will begin in ${countdown--} second(s)...`);
        }, 1000);

        this.clock.setTimeout(async () => {
            countdownTimer.clear();
            this.broadcast('combat_log', 'The battle begins!');
            console.log('battle started!');
            console.log('player', this.state.player.name);
            console.log('enemy', this.state.enemy.name);
            this.state.battleStarted = true;
            this.startBattle();
        }, 5500);
    }

    async onLeave(client: Client, consented: boolean) {
        try {
            if (consented) {
                throw new Error('consented leave');
            }

            // allow disconnected client to reconnect into this room until 20 seconds
            await this.allowReconnection(client, 20);
            console.log('client reconnected!');
            if (this.state.fightResult) {
                if (this.state.player.lives > 0 && this.state.player.wins < 10)
                    this.broadcast('end_battle', 'The battle has ended!');
                else if (this.state.player.lives <= 0 && this.state.player.wins < 10)
                    this.broadcast('game_over', 'You have lost the game!');
                else if (this.state.player.wins >= 10) this.broadcast('game_over', 'You have won the game!');
            }
        } catch (e) {
            //save player state to db
            this.state.player.sessionId = '';
            //set player for next round
            this.state.player.round++;
            await updatePlayer(this.state.player);
            console.log(client.sessionId, 'left!');
            this.clock.setTimeout(() => {
                this.disconnect();
            }, 5000);
        }
    }

    onDispose() {
        console.log('room', this.roomId, 'disposing...');
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
                this.state.player.attackTimer.clear();
                this.state.enemy.attackTimer.clear();
                this.state.player.poisonTimer?.clear();
                this.state.enemy.poisonTimer?.clear();
                this.state.endBurnTimer?.clear();
                this.state.skillsTimers.forEach((timer) => timer.clear());
                this.state.player.regenTimer?.clear();
                this.state.enemy.regenTimer?.clear();
                this.broadcast('combat_log', 'The battle has ended!');
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
            this.broadcast('combat_log', `The battle is dragging on! Both players burned for ${burnDamage} damage!`);
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

    startAttackTimer(player: Player, enemy: Player) {
        //start player attack loop
        player.attackTimer = this.clock.setInterval(() => {
            this.tryAttack(player, enemy);
            player.attackTimer.clear();
            this.startAttackTimer(player, enemy);
        }, (1 / player.attackSpeed) * 1000);
    }

    startRegenTimer(player: Player) {
        if (player.hpRegen) {
            player.regenTimer = this.clock.setInterval(() => {
                player.hp += player.hpRegen;
                const isMinusRegen = player.hpRegen < 0;
                this.state.playerClient.send('combat_log', `${player.name} regenerates ${player.hpRegen} hp!`);
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
        const poisonItemCollection = attacker.activeItemCollections.find(
            (itemCollection) => itemCollection.itemCollectionId === ItemCollectionType.ROGUE_3
        );
        const activationRate = poisonTalent
            ? poisonTalent.activationRate
            : poisonItemCollection
                ? poisonItemCollection.base
                : 0.015;
        if (!defender.poisonTimer) {
            defender.poisonTimer = this.clock.setInterval(() => {
                const poisonDamage = defender.poisonStack * (activationRate * defender.maxHp + activationRate * 100) * 0.1;

                this.dispatcher.dispatch(new OnDamageTriggerCommand(), {
                    defender: defender,
                    damage: poisonDamage,
                    attacker: this.state.player,
                });

                defender.takeDamage(poisonDamage, this.state.playerClient);
                this.state.playerClient.send('combat_log', `${defender.name} takes ${poisonDamage} poison damage!`);
            }, 1000);
        }
    }

    tryAttack(attacker: Player, defender: Player) {
        const attackRoll = Math.floor(Math.random() * attacker.strength) + attacker.accuracy;

        const damage = defender.getDamageAfterDefense(attackRoll);

        if (defender.dodgeRate > 0) {
            const dodgeChance = 1 - 100 / (100 + defender.dodgeRate);

            if (Math.random() < dodgeChance) {
                this.state.playerClient.send('combat_log', `${defender.name} dodged the attack!`);
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
        });
        this.dispatcher.dispatch(new OnAttackTriggerCommand(), {
            attacker: attacker,
            defender: defender,
            damage: damage,
        });
        this.dispatcher.dispatch(new OnDamageTriggerCommand(), {
            defender: defender,
            damage: damage,
            attacker: this.state.player,
        });

        defender.takeDamage(damage, this.state.playerClient);

        //broadcast attack and damage
        this.state.playerClient.send('combat_log', `${attacker.name} attacks ${defender.name} for ${damage} damage!`);
        this.state.playerClient.send('attack', attacker.playerId);
    }

    //start attack/skill loop for player and enemy, they run at different intervals according to their attack speed
    startBattle() {
        //start attack timers
        this.startAttackTimer(this.state.player, this.state.enemy);
        this.startAttackTimer(this.state.enemy, this.state.player);
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
            this.state.player.assign(player);
            this.state.player.availableItemCollections = await getAllItemCollections();
        } else {
            this.state.enemy.assign(player);
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

        this.state.player.rewardRound = this.state.player.round;

        //trigger fight-end effects
        this.dispatcher.dispatch(new FightEndTriggerCommand());

        const goldToGet = this.state.player.rewardRound * 2 + this.state.player.income;

        this.state.player.gold += goldToGet;
        this.state.player.xp += this.state.player.rewardRound * 2;

        this.broadcast('combat_log', `You gained ${goldToGet} gold!`);
        this.broadcast('combat_log', `You gained ${this.state.player.rewardRound * 2} xp!`);
    }

    private async handleWin() {
        this.broadcast('combat_log', 'You win!');
        console.log(`${this.state.player.name} wins!`);
        this.state.player.wins++;
        const highestWin = await getHighestWin();
        if (this.state.player.wins > highestWin) {
            this.broadcast('game_over', 'YOU ARE THE #1 TOP CHUNGERION! CHUNGRATULATIONS!');
        } else {
            this.broadcast('end_battle', 'The battle has ended!');
        }
    }

    private handleLoose() {
        this.broadcast('combat_log', 'You loose!');
        console.log(`${this.state.player.name} looses!`);
        this.state.player.lives--;
        if (this.state.player.lives <= 0) {
            this.broadcast('game_over', 'You have lost the game!');
        } else {
            this.broadcast('end_battle', 'The battle has ended!');
        }
    }

    private handleDraw() {
        console.log('draw!');
        this.broadcast('combat_log', "It's a draw!");
        this.broadcast('end_battle', 'The battle has ended!');
    }
}
