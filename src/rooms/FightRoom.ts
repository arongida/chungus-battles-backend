import { Room, Client } from "@colyseus/core";
import { FightState } from "./schema/FightState";
import { getPlayer, getSameRoundPlayer, updatePlayer } from "../db/Player";
import { Player } from "./schema/PlayerSchema";
import { Delayed } from "colyseus";
import { delay, FightResultTypes } from "../utils/utils";
import { getTalentsById } from "../db/Talent";
import { Talent } from "./schema/TalentSchema";

export class FightRoom extends Room<FightState> {
  maxClients = 1;
  battleStarted = false;
  activatedTimers: Delayed[] = [];
  playerInitialStats: { hp: number, attack: number, defense: number, attackSpeed: number };
  fightResult: FightResultTypes;

  onCreate(options: any) {
    this.setState(new FightState());

    this.onMessage("chat", (client, message) => {
      this.broadcast("messages", `${client.sessionId}: ${message}`);
    });

    //start clock for timings
    this.clock.start();

    //set simulation interval for room
    this.setSimulationInterval((deltaTime) => this.update(deltaTime));
  }

  async onJoin(client: Client, options: any) {
    console.log(client.sessionId, "joined!");
    console.log("player id", options.playerId);

    // check if player id is provided
    if (!options.playerId) throw new Error("Player ID is required!");

    //get player from db
    await delay(1000, this.clock);
    let player = await getPlayer(options.playerId);
    if (!player) throw new Error("Player not found!");

    //set up player state
    await this.setUpState(player);

    // check if player is already playing
    if (this.state.player.sessionId !== "") throw new Error("Player already playing!");
    if (this.state.player.lives <= 0) throw new Error("Player has no lives left!");
    this.state.player.sessionId = client.sessionId;



    //start battle after 5 seconds
    this.broadcast("combat_log", "The battle will begin in 5 seconds...");
    this.clock.setTimeout(async () => {
      this.broadcast("combat_log", "The battle begins!");
      this.battleStarted = true;
      this.startBattle();
    }, 5000);

  }

  async onLeave(client: Client, consented: boolean) {
    try {
      if (consented) {
        throw new Error("consented leave");
      }

      // allow disconnected client to reconnect into this room until 20 seconds
      await this.allowReconnection(client, 20);
      console.log("client reconnected!");

    } catch (e) {
      //save player state to db
      this.state.player.sessionId = "";
      //set player for next round
      this.state.player.hp = this.playerInitialStats.hp;
      this.state.player.attack = this.playerInitialStats.attack;
      this.state.player.round++;
      console.log("update player object on leave:", this.state.player.talents)
      await updatePlayer(this.state.player);
      console.log(client.sessionId, "left!");
    }
  }

  onDispose() {
    console.log("room", this.roomId, "disposing...");
  }

  async getRandomEnemy() {

  }

  //this is running all the time 
  update(deltaTime: number) {

    //check for battle end
    if (this.battleStarted) {
      if (this.state.player.hp <= 0 || this.state.enemy.hp <= 0) {

        //set state and clear intervals
        this.battleStarted = false;

        this.activatedTimers.forEach(timer => timer.clear());

        this.broadcast("combat_log", "The battle has ended!");
        this.handleFightEnd();

      }
    }
  }

  //start attack/skill loop for player and enemy, they run at different intervals according to their attack speed
  async startBattle() {

    //start player attack loop
    this.activatedTimers.push(this.clock.setInterval(() => {
      this.attack(this.state.player, this.state.enemy);
    }, (1 / this.state.player.attackSpeed) * 1000));

    //start player skills loop
    this.startSkillLoop(this.state.player, this.state.enemy);


    //start enemy attack loop
    this.activatedTimers.push(this.clock.setInterval(() => {
      this.attack(this.state.enemy, this.state.player);
    }, (1 / this.state.enemy.attackSpeed) * 1000));

    //start enemy skills loops
    this.startSkillLoop(this.state.enemy, this.state.player);
  }

  //get player, enemy and talents from db and map them to the room state
  async setUpState(player: Player) {
    const talents = await getTalentsById(player.talents as unknown as number[]) as Talent[];
    const newPlayer = new Player(player);

    this.state.player.assign(newPlayer);

    player.talents.forEach(talentId => {
      const newTalent = new Talent(talents.find(talent => talent.talentId === talentId as unknown as number));
      const findTalent = this.state.player.talents.find(talent => talent.talentId === newTalent.talentId);
      if (findTalent) findTalent.level++;
      else this.state.player.talents.push(newTalent);
    });

    //save original player stats
    this.playerInitialStats = { hp: this.state.player.hp, attack: this.state.player.attack, defense: this.state.player.defense, attackSpeed: this.state.player.attackSpeed };

    //if enemy state is already set, skip it
    if (this.state.enemy.playerId) return;

    let enemy = await getSameRoundPlayer(this.state.player.round, this.state.player.playerId);
    const enemyTalents = await getTalentsById(enemy.talents as unknown as number[]) as Talent[];
    const newEnemyObject = new Player(enemy);
    this.state.enemy.assign(newEnemyObject);
    enemy.talents.forEach(talentId => {
      const newTalent = new Talent(enemyTalents.find(talent => talent.talentId === talentId as unknown as number));
      const findTalent = this.state.enemy.talents.find(talent => talent.talentId === newTalent.talentId);
      if (findTalent) findTalent.level++;
      else this.state.enemy.talents.push(newTalent);
    });
  }

  //start active skill loops for player and enemy
  startSkillLoop(player: Player, enemy: Player) {
    //start player skills loops
    player.talents.forEach(talent => {
      this.activatedTimers.push(this.clock.setInterval(() => {

        //handle Rage skill
        if (talent.talentId === 1) {
          player.hp -= 3;
          player.attack += 1;
          this.broadcast("combat_log", `${player.name} uses Rage! Increased attack by 1!`);
        }

        //handle Greed skill
        if (talent.talentId === 2) {
          player.gold += 1;
          enemy.gold -= 1;
          this.broadcast("combat_log", `${player.name} uses Greed!\nGold: ${player.gold}`);
        }

        //handle arcane missiles skill
        if (talent.talentId === 8) {
          for (let i = 0; i < 3; i++) {
            enemy.hp -= 2;
            this.broadcast("combat_log", `${player.name} shoots an arcane missle for 2 dmg!`);
          }
        }
      }, (1 / talent.activationRate) * 1000));
    });
  }


  private async attack(attacker: Player, defender: Player) {
    let damageReductionPercent = defender.defense >= 70 ? 70 : defender.defense;
    const damage = Math.floor(attacker.attack * (1 - damageReductionPercent / 100));
    if (defender.talents.find(talent => talent.talentId === 9)) {
      const random = Math.random();
      if (random < 0.25) {
         this.broadcast("combat_log", `${defender.name} dodged the attack!`);
         return;
      }
    }
    defender.hp -= damage;
    this.broadcast("combat_log", `${attacker.name} attacks ${defender.name} for ${damage} damage!`);
  }

  private handleFightEnd() {
    if (this.state.player.hp <= 0 && this.state.enemy.hp <= 0) {
      this.broadcast("combat_log", "It's a draw!");
      this.fightResult = FightResultTypes.DRAW;
    } else if (this.state.player.hp <= 0) {
      this.broadcast("combat_log", "YOU loose!");
      this.fightResult = FightResultTypes.LOSE;
    } else {
      this.broadcast("combat_log", "YOU win!");
      this.fightResult = FightResultTypes.WIN;
    }

    switch (this.fightResult) {
      case FightResultTypes.WIN:
        this.handleWin();
        break;
      case FightResultTypes.LOSE:
        this.handleLose();
        break;
      case FightResultTypes.DRAW:
        this.handleDraw();
        break;
    }
  }

  private handleWin() {

    //check if player took risky investment
    if (this.state.player.talents.find(talent => talent.talentId === 3)) {
      this.state.player.gold += 20;
      this.broadcast("combat_log", "You took a risky investment and gained 20 gold!");
      this.state.player.talents = this.state.player.talents.filter(talent => talent.talentId !== 3);
      this.state.player.talents.push(new Talent({ talentId: 7, name: "Broken Risky Investment", description: "Already used", level: 1, class: "Merchant", levelRequirement: 0, activationRate: 0 }));
    }

    this.state.player.gold += this.state.player.round * 4;
    this.state.player.xp += this.state.player.round * 4;
    this.state.player.wins++;
    this.broadcast("end_battle", "The battle has ended!");
    if (this.state.player.wins >= 10) {
      this.broadcast("game_over", "You have won the game!");
    }
  }

  private handleLose() {
    this.state.player.gold += this.state.player.round * 2;
    this.state.player.xp += this.state.player.round * 2;

    //check guardian talents
    if (this.state.player.talents.find(talent => talent.talentId === 4)) {
      this.broadcast("combat_log", "You have been saved by the guardian angel!");
      this.state.player.talents = this.state.player.talents.filter(talent => talent.talentId !== 4);
      this.state.player.talents.push(new Talent(
        { talentId: 6, name: "Broken Guardian Angel", description: "Already used", level: 1, class: "Guardian", levelRequirement: 0, activationRate: 0 }
      ));
    } else {
      this.state.player.lives--;
    }

    //check if player took risky investment
    if (this.state.player.talents.find(talent => talent.talentId === 3)) {
      this.broadcast("combat_log", "Your risky investment did not go well...");
      this.state.player.talents = this.state.player.talents.filter(talent => talent.talentId !== 3);
      this.state.player.talents.push(new Talent(
        { talentId: 7, name: "Broken Risky Investment", description: "Already used", level: 1, class: "Merchant", levelRequirement: 0, activationRate: 0 }
      ));
    }

    if (this.state.player.lives <= 0) {
      this.broadcast("game_over", "You have lost the game!");
    } else {
      this.broadcast("end_battle", "The battle has ended!");
    }
  }

  private handleDraw() {
    this.state.player.gold += this.state.player.round * 2;
    this.state.player.xp += this.state.player.round * 2;
    this.broadcast("end_battle", "The battle has ended!");

    //check if player took risky investment
    if (this.state.player.talents.find(talent => talent.talentId === 3)) {
      this.broadcast("combat_log", "You fought well but money is a btch...");
      this.state.player.talents = this.state.player.talents.filter(talent => talent.talentId !== 3);
      this.state.player.talents.push(new Talent(
        { talentId: 7, name: "Broken Risky Investment", description: "Already used", level: 1, class: "Merchant", levelRequirement: 0, activationRate: 0 }
      ));
    }
  }
}

