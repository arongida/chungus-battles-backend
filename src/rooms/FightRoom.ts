import { Room, Client } from '@colyseus/core';
import { FightState } from './schema/FightState';
import { getPlayer, getSameRoundPlayer, updatePlayer } from '../db/Player';
import { Player } from './schema/PlayerSchema';
import { Delayed } from 'colyseus';
import {
	delay,
	FightResultType,
	TalentType,
	increaseStats,
	setStats,
} from '../utils/utils';
import { getTalentsById } from '../db/Talent';
import { getItemsById } from '../db/Item';
import { AffectedStats, Item } from './schema/ItemSchema';
import { Talent } from './schema/TalentSchema';

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
			this.attack(player, enemy);
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
		this.applyFightStartEffects(this.state.player, this.state.enemy);
		this.applyFightStartEffects(this.state.enemy, this.state.player);
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
				if (!isEnemy) this.state.player.talents.push(newTalent);
				else this.state.enemy.talents.push(newTalent);
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
		//start player skills loops
		player.talents.forEach((talent) => {
			this.skillsTimers.push(
				this.clock.setInterval(() => {
					if (talent.talentId === TalentType.Steal) {
						const stolenItemIndex = Math.floor(
							Math.random() * enemy.inventory.length
						);
						const stolenItem = enemy.inventory[stolenItemIndex];
						if (stolenItem) {
							enemy.inventory.splice(stolenItemIndex, 1);
							this.broadcast(
								'combat_log',
								`${player.name} steals ${stolenItem.name} from ${enemy.name}!`
							);
							player.inventory.push(stolenItem);
							increaseStats(player, stolenItem.affectedStats);
							increaseStats(enemy, stolenItem.affectedStats, -1);
						}
					}

					//handle Greed skill
					if (talent.talentId === TalentType.Pickpocket) {
						player.gold += 1;
						if (enemy.gold > 0) enemy.gold -= 1;
						this.broadcast(
							'combat_log',
							`${player.name} stole 1 gold from ${enemy.name}!`
						);
					}

					//handle scam skill
					if (talent.talentId === TalentType.Scam) {
						const amount = 2 + player.level;
						enemy.hp -= amount;
						player.hp += amount;
						this.broadcast(
							'combat_log',
							`${player.name} scams ${amount} health from ${enemy.name}!`
						);
						this.broadcast('damage', {
							playerId: enemy.playerId,
							damage: amount,
						});
						this.broadcast('healing', {
							playerId: player.playerId,
							healing: amount,
						});
					}

					//handle bandage skill
					if (talent.talentId === TalentType.Bandage) {
						const healing = 5 + player.level;
						player.hp += healing;
						this.broadcast(
							'combat_log',
							`${player.name} restores ${healing} health!`
						);
						this.broadcast('healing', {
							playerId: player.playerId,
							healing: healing,
						});
					}

					//handle throwing money skill
					if (talent.talentId === TalentType.ThrowMoney) {
						//calculate defense
						const damage =
							7 + Math.floor(player.gold * 0.7 * (100 / (100 + enemy.defense)));
						enemy.hp -= damage;
						this.broadcast(
							'combat_log',
							`${player.name} throws money for ${damage} damage!`
						);
						this.broadcast('damage', {
							playerId: enemy.playerId,
							damage: damage,
						});
					}
				}, (1 / talent.activationRate) * 1000)
			);
		});
	}

	private async attack(
		attacker: Player,
		defender: Player,
		recalculateTimer = true
	) {
		//calculate defense
		const damage = Math.floor(
			attacker.attack * (100 / (100 + defender.defense))
		);

		//check if defender dodges the attack
		const evasionTalent = defender.talents.find(
			(talent) => talent.talentId === TalentType.Evasion
		);
		if (evasionTalent) {
			const random = Math.random();
			if (random < evasionTalent.activationRate) {
				this.broadcast('combat_log', `${defender.name} dodged the attack!`);
				return;
			}
		}

		//check for leech talent
		if (
			attacker.talents.find(
				(talent) => talent.talentId === TalentType.Invigorate
			)
		) {
			const leechAmount = Math.floor(damage * 0.15) + 2;
			attacker.hp += leechAmount;
			this.broadcast(
				'combat_log',
				`${attacker.name} leeches ${leechAmount} health!`
			);
			this.broadcast('healing', {
				playerId: attacker.playerId,
				healing: leechAmount,
			});
		}

		//damage
		defender.hp -= damage;

		//handle Rage skill
		const rageTalent = attacker.talents.find(
			(talent) => talent.talentId === TalentType.Rage
		);
		if (rageTalent) {
			attacker.hp -= rageTalent.activationRate;
			attacker.attack += rageTalent.activationRate;
			this.broadcast(
				'combat_log',
				`${attacker.name} rages, increased attack by 1!`
			);
			this.broadcast('damage', {
				playerId: attacker.playerId,
				damage: rageTalent.activationRate,
			});
		}

		//handle poison talent
		const poisonTalent = attacker.talents.find(
			(talent) => talent.talentId === TalentType.Poison
		);
		if (poisonTalent) {
			defender.addPoison(
				this.clock,
				this.playerClient,
				poisonTalent.activationRate
			);
		}

		const assassinAmusementTalent = attacker.talents.find(
			(talent) => talent.talentId === TalentType.AssassinAmusement
		);
		if (assassinAmusementTalent) {
			attacker.attackSpeed += assassinAmusementTalent.activationRate;
		}

		this.broadcast(
			'combat_log',
			`${attacker.name} attacks ${defender.name} for ${damage} damage!`
		);
		this.broadcast('damage', {
			playerId: defender.playerId,
			damage: damage,
		});
		this.broadcast('attack', attacker.playerId);

		//handle thorny fence talent
		const thornyFenceTalent = defender.talents.find(
			(talent) => talent.talentId === TalentType.ThornyFence
		);
		if (thornyFenceTalent) {
			const reflectDamage = Math.round(
				damage *
					(0.2 + defender.defense * thornyFenceTalent.activationRate * 0.01)
			);
			attacker.hp -= reflectDamage;
			this.broadcast(
				'combat_log',
				`${defender.name} reflects ${reflectDamage} damage to ${attacker.name}!`
			);
			this.broadcast('damage', {
				playerId: attacker.playerId,
				damage: reflectDamage,
			});
		}

		//check resilience talent
		const resilienceTalent = defender.talents.find(
			(talent) => talent.talentId === TalentType.Resilience
		);
		if (resilienceTalent) {
			const healingAmount = Math.round(
				1 + resilienceTalent.activationRate * defender.maxHp
			);
			defender.hp += healingAmount;
			this.broadcast(
				'combat_log',
				`${defender.name} recovers ${healingAmount} health!`
			);
			this.broadcast('healing', {
				playerId: defender.playerId,
				healing: healingAmount,
			});
		}

		//handle eye for an eye talent
		const eyeForAnEyeTalent = defender.talents.find(
			(talent) => talent.talentId === TalentType.EyeForAnEye
		);
		if (eyeForAnEyeTalent) {
			const random = Math.random();
			if (random < eyeForAnEyeTalent.activationRate) {
				this.broadcast(
					'combat_log',
					`${defender.name} counters ${attacker.name}!`
				);
				this.attack(defender, attacker, false);
			}
		}

		if (recalculateTimer) {
			//reset attack timers
			attacker.attackTimer.clear();
			this.startAttackTimer(attacker, defender);
		}
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

		//check for fight end bonuses
		const smartInvestmentTalent = this.state.player.talents.find(
			(talent) => talent.talentId === TalentType.SmartInvestment
		);
		if (smartInvestmentTalent) {
			const goldBonus = Math.max(
				Math.floor(
					this.state.player.gold * smartInvestmentTalent.activationRate
				),
				2
			);
			this.state.player.gold += goldBonus;
			this.broadcast(
				'combat_log',
				`You gained ${goldBonus} gold from selling loot!`
			);
		}
	}

	private handleWin() {
		this.broadcast('combat_log', 'You win!');

		//check if player took risky investment
		const riskyInvestmentTalent = this.state.player.talents.find(
			(talent) => talent.talentId === TalentType.RiskyInvestment
		);
		if (riskyInvestmentTalent) {
			this.state.player.gold += riskyInvestmentTalent.activationRate;
			this.broadcast(
				'combat_log',
				`You took a risky investment and gained ${riskyInvestmentTalent.activationRate} gold!`
			);
			this.state.player.talents = this.state.player.talents.filter(
				(talent) => talent.talentId !== TalentType.RiskyInvestment
			);
			this.state.player.talents.push(
				new Talent({
					talentId: 7,
					name: 'Broken Risky Investment',
					description: 'Already used',
					tier: 1,
					activationRate: 0,
				})
			);
		}

		this.state.player.gold += this.state.player.round * 4;
		this.state.player.xp += this.state.player.round * 2;
		this.state.player.wins++;
		this.broadcast('end_battle', 'The battle has ended!');
		if (this.state.player.wins >= 10) {
			this.broadcast('game_over', 'You have won the game!');
		}
	}

	private handleLoose() {
		this.broadcast('combat_log', 'You loose!');

		this.state.player.gold += this.state.player.round * 4;
		this.state.player.xp += this.state.player.round * 2;

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
		this.state.player.gold += this.state.player.round * 4;
		this.state.player.xp += this.state.player.round * 2;
		this.broadcast('end_battle', 'The battle has ended!');
	}

	//apply fight start effects for player/enemy
	applyFightStartEffects(player: Player, enemy?: Player) {
		if (!this.battleStarted) return;

		//handle disarming deal talent
		const disarmingDealTalent = player.talents.find(
			(talent) => talent.talentId === TalentType.DisarmingDeal
		);
		if (disarmingDealTalent) {
			const numberOfEnemyWeapons = enemy.getNumberOfWeapons();
			enemy.attack -= numberOfEnemyWeapons + 5;
			enemy.attackSpeed -=
				numberOfEnemyWeapons * disarmingDealTalent.activationRate;
			this.broadcast(
				'combat_log',
				`${player.name} disarms ${enemy.name}! ${
					enemy.name
				} looses ${numberOfEnemyWeapons} attack and ${
					numberOfEnemyWeapons * disarmingDealTalent.activationRate
				} attack speed!`
			);
		}

		//handle weapon whisperer talent
		const weaponWhispererTalent = player.talents.find(
			(talent) => talent.talentId === TalentType.WeaponWhisperer
		);
		if (weaponWhispererTalent) {
			const numberOfMeleeWeapons = player.getNumberOfMeleeWeapons();
			const attackBonus =
				numberOfMeleeWeapons * weaponWhispererTalent.activationRate;
			player.attack += attackBonus;
			this.broadcast(
				'combat_log',
				`${player.name} gains ${attackBonus} attack from Weapon Whisperer!`
			);
		}

		//handle talent buy effects
		const goldGenieTalent = player.talents.find(
			(talent) => talent.talentId === TalentType.GoldGenie
		);
		if (goldGenieTalent) {
			const defenseBonus = player.gold * 2;
			player.defense += defenseBonus;
			this.broadcast(
				'combat_log',
				`${player.name} gains ${defenseBonus} defense from Gold Genie!`
			);
		}

		//handle strong body talent
		const strongBodyTalent = player.talents.find(
			(talent) => talent.talentId === TalentType.Strong
		);
		if (strongBodyTalent) {
			const hpBonus = Math.ceil(player.hp * strongBodyTalent.activationRate);
			const attackBonus = Math.ceil(
				player.attack * strongBodyTalent.activationRate
			);
			// const defenseBonus = Math.ceil(
			// 	player.defense * strongBodyTalent.activationRate
			// );
			// const factor = 10 ** 2;
			// const attackSpeedBonus =
			// 	Math.round(
			// 		player.attackSpeed * strongBodyTalent.activationRate * factor
			// 	) / factor;
			player.hp += hpBonus;
			player.maxHp = player.hp;
			player.attack += attackBonus;
			// player.defense += defenseBonus;
			// player.attackSpeed += attackSpeedBonus;
			this.broadcast(
				'combat_log',
				`${player.name} is strong hence gets an increase to stats!`
			);
			this.broadcast('combat_log', `${player.name} gains ${hpBonus} hp!`);
			this.broadcast(
				'combat_log',
				`${player.name} gains ${attackBonus} attack!`
			);
			// this.broadcast(
			// 	'combat_log',
			// 	`${player.name} gains ${defenseBonus} defense!`
			// );
			// this.broadcast(
			// 	'combat_log',
			// 	`${player.name} gains ${attackSpeedBonus} attack speed!`
			// );
		}

		//handle upper middle class
		if (
			player.talents.find(
				(talent) => talent.talentId === TalentType.IntimidatingWealth
			)
		) {
			const attackBonus = Math.ceil(
				Math.min(0.1 + player.gold * 0.0025, 0.4) * enemy.attack
			);
			enemy.attack -= attackBonus;
			this.broadcast(
				'combat_log',
				`${player.name} intimidates ${enemy.name} with their wealth!`
			);
			this.broadcast(
				'combat_log',
				`${enemy.name} looses ${attackBonus} attack!`
			);
			// this.broadcast(
			// 	'combat_log',
			// 	`${enemy.name} looses ${attackBonus} attack!`
			// );
			// this.broadcast(
			// 	'combat_log',
			// 	`${enemy.name} looses ${defenseBonus} defense!`
			// );
			// this.broadcast(
			// 	'combat_log',
			// 	`${enemy.name} looses ${attackSpeedBonus} attack speed!`
			// );
		}

		//handle bribe
		// if (player.talents.find((talent) => talent.talentId === TalentType.Bribe)) {
		// 	if (player.gold >= 80) {
		// 		//set state and clear intervals
		// 		this.battleStarted = false;
		// 		this.playerAttackTimer.clear();
		// 		this.enemyAttackTimer.clear();
		// 		this.skillsTimers.forEach((timer) => timer.clear());
		// 		this.broadcast(
		// 			'combat_log',
		// 			`${player.name} bribes ${enemy.name} for ${player.gold} gold!`
		// 		);
		// 		player.gold = 0;
		// 		enemy.gold += player.gold;
		// 		if (player.playerId === this.state.player.playerId) {
		// 			this.fightResult = FightResultType.WIN;
		// 			this.handleFightEnd();
		// 		} else {
		// 			this.fightResult = FightResultType.LOSE;
		// 			this.handleFightEnd();
		// 		}
		// 	}
		// }
	}
}
