import { Room, Client } from '@colyseus/core';
import { FightState } from './schema/FightState';
import { getPlayer, getSameRoundPlayer, updatePlayer } from '../db/Player';
import { Player } from './schema/PlayerSchema';
import { Delayed } from 'colyseus';
import { delay, increaseStats, setStats } from '../common/utils';
import { FightResultType } from '../common/types';
import { TalentType } from './schema/talent/TalentTypes';
import { getTalentsById } from '../db/Talent';
import { getItemsById } from '../db/Item';
import { AffectedStats, Item } from './schema/ItemSchema';
import { Talent } from './schema/talent/TalentSchema';
import { TalentBehaviorContext } from './schema/talent/TalentBehaviorContext';

export class FightRoom extends Room<FightState> {
	maxClients = 1;
	battleStarted = false;
	skillsTimers: Delayed[] = [];
	fightResult: FightResultType;
	endBurnTimer: Delayed;
	endBurnDamage: number = 10;
	playerClient: Client;

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
		this.playerClient = client;

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
			this.battleStarted = true;
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
			if (this.fightResult) {
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
		if (this.battleStarted) {
			if (this.clock.elapsedTime > 65000 && !this.endBurnTimer) {
				this.startEndBurnTimer();
			}
			if (this.state.player.hp <= 0 || this.state.enemy.hp <= 0) {
				//set state and clear intervals
				this.battleStarted = false;
				this.state.player.attackTimer.clear();
				this.state.enemy.attackTimer.clear();
				if (this.endBurnTimer) this.endBurnTimer.clear();
				this.skillsTimers.forEach((timer) => timer.clear());
				this.broadcast('combat_log', 'The battle has ended!');
				this.handleFightEnd();
			}
		}
	}

	startEndBurnTimer() {
		if (this.endBurnTimer) return;
		this.endBurnTimer = this.clock.setInterval(() => {
			const burnDamage = this.endBurnDamage++;
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
			player.tryAttack(enemy, this.playerClient, this.clock);
      player.attackTimer.clear();
      this.startAttackTimer(player, enemy);
		}, (1 / player.attackSpeed) * 1000);
	}

	//start attack/skill loop for player and enemy, they run at different intervals according to their attack speed
	async startBattle() {
		//start attack timers
		this.startAttackTimer(this.state.player, this.state.enemy);
		this.startAttackTimer(this.state.enemy, this.state.player);
		//start player skill loop
		this.startSkillLoop(this.state.player, this.state.enemy);
		//start enemy skill loops
		this.startSkillLoop(this.state.enemy, this.state.player);

		//apply fight start effects
		await this.applyFightStartEffects(this.state.player, this.state.enemy);
		await this.applyFightStartEffects(this.state.enemy, this.state.player);
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

		if (player.inventory.length > 0) {
			const itemsDataFromDb = (await getItemsById(
				player.inventory as unknown as number[]
			)) as Item[];
			player.inventory.forEach((itemId) => {
				let newItem = new Item(
					itemsDataFromDb.find(
						(item) => item.itemId === (itemId as unknown as number)
					)
				);
				newItem.affectedStats = new AffectedStats(newItem.affectedStats);
				if (!isEnemy) this.state.player.inventory.push(newItem);
				else this.state.enemy.inventory.push(newItem);

				//save initial inventory
				if (!isEnemy) this.state.player.initialInventory.push(newItem);
				else this.state.enemy.initialInventory.push(newItem);
			});
		}
	}

	//start active skill loops for player and enemy
	startSkillLoop(player: Player, enemy: Player) {
		//start active skills' loops
		const activeTalents: Talent[] = player.talents.filter((talent) =>
			talent.tags.includes('active')
		);
		const activeTalentBehaviorContext: TalentBehaviorContext = {
			client: this.playerClient,
			attacker: player,
			defender: enemy,
		};
		activeTalents.forEach((talent) => {
			this.skillsTimers.push(
				this.clock.setInterval(() => {
					talent.executeBehavior(activeTalentBehaviorContext);
				}, (1 / talent.activationRate) * 1000)
			);
		});
	}


	private handleFightEnd() {
		if (!this.fightResult) {
			if (this.state.player.hp <= 0 && this.state.enemy.hp <= 0) {
				this.fightResult = FightResultType.DRAW;
			} else if (this.state.player.hp <= 0) {
				this.fightResult = FightResultType.LOSE;
			} else {
				this.fightResult = FightResultType.WIN;
			}
		}

		switch (this.fightResult) {
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

		let round = this.state.player.round;

		const futureNowTalent = this.state.player.talents.find(
			(talent) => talent.talentId === TalentType.FutureNow
		);
		if (futureNowTalent) {
			this.broadcast(
				'combat_log',
				'You are in the future now! You gain extra gold and xp!'
			);
			this.broadcast('trigger_talent', {
				playerId: this.state.player.playerId,
				talentId: TalentType.FutureNow,
			});
			round += futureNowTalent.activationRate;
		}

		this.state.player.gold += round * 4;
		this.state.player.xp += round * 2;

		this.broadcast('combat_log', `You gained ${round * 4} gold!`);
		this.broadcast('combat_log', `You gained ${round * 2} xp!`);

		//check for fight end bonuses
		const smartInvestmentTalent = this.state.player.talents.find(
			(talent) => talent.talentId === TalentType.SmartInvestment
		);
		if (smartInvestmentTalent) {
			const goldBonus = Math.max(
				Math.round(
					this.state.player.gold * smartInvestmentTalent.activationRate
				),
				5
			);
			this.state.player.gold += goldBonus;
			this.broadcast(
				'combat_log',
				`You gained ${goldBonus} gold from selling loot!`
			);
			this.broadcast('trigger_talent', {
				playerId: this.state.player.playerId,
				talentId: TalentType.SmartInvestment,
			});
		}
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

		//check guardian talents
		if (
			this.state.player.talents.find(
				(talent) => talent.talentId === TalentType.GuardianAngel
			)
		) {
			this.broadcast(
				'combat_log',
				'You have been saved by the guardian angel!'
			);
			this.broadcast('trigger_talent', {
				playerId: this.state.player.playerId,
				talentId: TalentType.GuardianAngel,
			});
			this.state.player.talents = this.state.player.talents.filter(
				(talent) => talent.talentId !== TalentType.GuardianAngel
			);
			this.state.player.talents.push(
				new Talent({
					talentId: 6,
					name: 'Broken Guardian Angel',
					description: 'Already used',
					tier: 0,
					activationRate: 0,
				})
			);
		} else {
			this.state.player.lives--;
		}

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

	//apply fight start effects for player/enemy
	private async applyFightStartEffects(player: Player, enemy?: Player) {
		if (!this.battleStarted) return;

		//handle on fight start talents
		const onFightStartTalents: Talent[] = player.talents.filter((talent) =>
			talent.tags.includes('fight-start')
		);
		const onFightStartTalentsContext: TalentBehaviorContext = {
			client: this.playerClient,
			attacker: player,
			defender: enemy,
			clock: this.clock,
		};
		onFightStartTalents.forEach((talent) => {
			talent.executeBehavior(onFightStartTalentsContext);
		});
	}
}
