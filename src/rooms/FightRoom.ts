import { Room, Client } from '@colyseus/core';
import { FightState } from './schema/FightState';
import {
	getPlayer,
	getSameRoundPlayer,
	updatePlayer,
} from '../players/db/Player';
import { Player } from '../players/schema/PlayerSchema';
import { delay, setStats } from '../common/utils';
import { FightResultType } from '../common/types';
import { getAllTalents, getTalentsById } from '../talents/db/Talent';
import { Talent } from '../talents/schema/TalentSchema';
import { Dispatcher } from '@colyseus/command';
import { ActiveTriggerCommand } from '../commands/triggers/ActiveTriggerCommand';
import { FightStartTriggerCommand } from '../commands/triggers/FightStartTriggerCommand';
import { FightEndTriggerCommand } from '../commands/triggers/FightEndTriggerCommand';
import { OnDamageTriggerCommand } from '../commands/triggers/OnDamageTriggerCommand';
import { OnAttackedTriggerCommand } from '../commands/triggers/OnAttackedTriggerCommand';
import { OnAttackTriggerCommand } from '../commands/triggers/OnAttackTriggerCommand';
import { SetUpInventoryStateCommand } from '../commands/SetUpInventoryStateCommand';

export class FightRoom extends Room<FightState> {
	maxClients = 1;

	dispatcher = new Dispatcher(this);

	onCreate(options: any) {
		this.setState(new FightState());

		this.onMessage('chat', (client, message) => {
			this.broadcast('messages', `${client.sessionId}: ${message}`);
		});

		//start clock for timings
		this.clock.start();

		//set simulation interval for room
		this.setSimulationInterval((deltaTime) => this.update(deltaTime));
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
		setStats(this.state.player.initialStats, this.state.player);
		this.state.player.maxHp = this.state.player.hp;
		this.state.playerClient = client;

		//set up enemy state
		if (!this.state.enemy.playerId) {
			let enemy = await getSameRoundPlayer(
				this.state.player.round,
				this.state.player.playerId
			);
			//set up enemy state
			await this.setUpState(enemy, true);
			setStats(this.state.enemy.initialStats, this.state.enemy);
			this.state.enemy.maxHp = this.state.enemy.hp;
		}

    //load talents from db
    this.state.availableTalents = await getAllTalents() as Talent[];

		// check if player is already playing
		if (this.state.player.sessionId !== '')
			throw new Error('Player already playing!');
		if (this.state.player.lives <= 0)
			throw new Error('Player has no lives left!');
		this.state.player.sessionId = client.sessionId;

		//start battle after 5 seconds
		let countdown = 5;
		const countdownTimer = this.clock.setInterval(() => {
			this.broadcast(
				'combat_log',
				`The battle will begin in ${countdown--} second(s)...`
			);
		}, 1000);

		this.clock.setTimeout(async () => {
			countdownTimer.clear();
			this.broadcast('combat_log', 'The battle begins!');
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
				else if (this.state.player.wins >= 10)
					this.broadcast('game_over', 'You have won the game!');
			}
		} catch (e) {
			//save player state to db
			this.state.player.sessionId = '';
			//set player for next round
			setStats(this.state.player, this.state.player.initialStats);
			this.state.player.resetInventory();
			this.state.player.round++;
			await updatePlayer(this.state.player);
			console.log(client.sessionId, 'left!');
		}
	}

	onDispose() {
		console.log('room', this.roomId, 'disposing...');
	}

	//this is running all the time
	update(deltaTime: number) {
		//check for battle end
		if (this.state.battleStarted) {
			if (this.clock.elapsedTime > 65000 && !this.state.endBurnTimer) {
				this.startEndBurnTimer();
			}
			if (this.state.player.hp <= 0 || this.state.enemy.hp <= 0) {
				//set state and clear intervals
				this.state.battleStarted = false;
				this.state.player.attackTimer.clear();
				this.state.enemy.attackTimer.clear();
				if (this.state.endBurnTimer) this.state.endBurnTimer.clear();
				this.state.skillsTimers.forEach((timer) => timer.clear());
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
			this.broadcast(
				'combat_log',
				`The battle is dragging on! Both players burned for ${burnDamage} damage!`
			);
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

	tryAttack(attacker: Player, defender: Player) {
		const damage = this.calculateOnDamageEffects(attacker.attack, defender);

		if (defender.dodgeRate > 0 && Math.random() < defender.dodgeRate) {
			const dodgeRateCache = defender.dodgeRate;
			defender.dodgeRate = 0;

			this.clock.setTimeout(() => {
				defender.dodgeRate = dodgeRateCache;
			}, 1500);

			this.state.playerClient.send(
				'combat_log',
				`${defender.name} dodged the attack!`
			);
			return;
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

		defender.takeDamage(defender.damageToTake, this.state.playerClient);

		//broadcast attack and damage
		this.state.playerClient.send(
			'combat_log',
			`${attacker.name} attacks ${defender.name} for ${damage} damage!`
		);
		this.state.playerClient.send('attack', attacker.playerId);
	}

	calculateOnDamageEffects(initialDamage: number, defender: Player): number {
		let reducedDamage = defender.getDamageAfterDefense(initialDamage);
		defender.damageToTake = reducedDamage;
		this.dispatcher.dispatch(new OnDamageTriggerCommand(), {
			defender: defender,
			damage: reducedDamage,
		});
		reducedDamage = Math.max(defender.damageToTake, 1);
		return reducedDamage;
	}

	//start attack/skill loop for player and enemy, they run at different intervals according to their attack speed
	async startBattle() {
		//start attack timers
		this.startAttackTimer(this.state.player, this.state.enemy);
		this.startAttackTimer(this.state.enemy, this.state.player);

		//start fight start effects
		this.dispatcher.dispatch(new FightStartTriggerCommand());
  
		//start active skill loops
		this.dispatcher.dispatch(new ActiveTriggerCommand());
	}

	//get player, enemy and talents from db and map them to the room state
	async setUpState(player: Player, isEnemy = false) {
		const newPlayer = new Player(player);
		if (!isEnemy) {
			this.state.player.assign(newPlayer);
		} else {
			this.state.enemy.assign(newPlayer);
		}

		if (player.talents.length > 0) {
			const talents = (await getTalentsById(
				player.talents as unknown as number[]
			)) as Talent[];
			player.talents.forEach((talentId) => {
				const newTalent = new Talent(
					talents.find(
						(talent) => talent.talentId === (talentId as unknown as number)
					)
				);
				if (!isEnemy) {
					this.state.player.talents.push(newTalent);
				} else {
					this.state.enemy.talents.push(newTalent);
				}
			});
		}

		await this.dispatcher.dispatch(new SetUpInventoryStateCommand(), {
      playerObjectFromDb: player,
			isEnemy: isEnemy,
		});
	}

	private handleFightEnd() {
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
				this.handleWin();
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

		this.state.player.gold += this.state.player.rewardRound * 4;
		this.state.player.xp += this.state.player.rewardRound * 2;

		this.broadcast(
			'combat_log',
			`You gained ${this.state.player.rewardRound * 4} gold!`
		);
		this.broadcast(
			'combat_log',
			`You gained ${this.state.player.rewardRound * 2} xp!`
		);
	}

	private handleWin() {
		this.broadcast('combat_log', 'You win!');
		this.state.player.wins++;
		this.broadcast('end_battle', 'The battle has ended!');
		if (this.state.player.wins >= 10) {
			this.broadcast('game_over', 'You have won the game!');
		}
	}

	private handleLoose() {
		this.broadcast('combat_log', 'You loose!');
		this.state.player.lives--;
		if (this.state.player.lives <= 0) {
			this.broadcast('game_over', 'You have lost the game!');
		} else {
			this.broadcast('end_battle', 'The battle has ended!');
		}
	}

	private handleDraw() {
		this.broadcast('combat_log', "It's a draw!");
		this.broadcast('end_battle', 'The battle has ended!');
	}
}
