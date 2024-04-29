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
      const updatedPlayer = await updatePlayer(this.state.player);
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

  //start attack loop for player and enemy, they run at different intervals according to their attack speed
  async startBattle() {

    //start player attack loop
    this.activatedTimers.push(this.clock.setInterval(() => {
      this.attack(this.state.player, this.state.enemy);
    }, (1 / this.state.player.attackSpeed) * 1000));

    //start player skills loops
    this.state.player.talents.forEach(talent => {
      this.activatedTimers.push(this.clock.setInterval(() => {
        if (talent.talentId === 1) {
          this.state.player.hp -= 3 * talent.level;
          this.state.player.attack += 1 * talent.level;
          this.broadcast("combat_log", `${this.state.player.name} uses Rage (lv ${talent.level})!`);
        } else if (talent.talentId === 2) {
          this.state.player.gold += 1 * talent.level;
          this.broadcast("combat_log", `${this.state.player.name} uses Greed (lv ${talent.level})!\nGold: ${this.state.player.gold}`);
        }
      }, (1 / talent.activationRate) * 1000));
    });


    //start enemy attack loop
    this.activatedTimers.push(this.clock.setInterval(() => {
      this.attack(this.state.enemy, this.state.player);
    }, (1 / this.state.enemy.attackSpeed) * 1000));

    //start enemy skills loops
    this.state.enemy.talents.forEach(talent => {
      this.activatedTimers.push(this.clock.setInterval(() => {
        if (talent.talentId === 1) {
          this.state.enemy.hp -= 3 * talent.level;
          this.state.enemy.attack += 1 * talent.level;
          this.broadcast("combat_log", `${this.state.enemy.name} uses Rage (lv ${talent.level})!`);
        } else if (talent.talentId === 2) {
          this.state.player.gold -= 1 * talent.level;
          this.broadcast("combat_log", `${this.state.enemy.name} uses Greed (lv ${talent.level}) (enemies decrease your gold)\nGold: ${this.state.player.gold}`);
        }
      }, (1 / talent.activationRate) * 1000));
    });
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

    let enemy = await getSameRoundPlayer(this.state.player.round);
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


  async attack(attacker: Player, defender: Player) {
    const damage = attacker.attack - defender.defense;
    defender.hp -= damage;
    this.broadcast("combat_log", `${attacker.name} attacks ${defender.name} for ${damage} damage!`);
  }

  handleFightEnd() {
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

  handleWin() {
    this.state.player.gold += this.state.player.round * 4;
    this.state.player.xp += this.state.player.round * 4;
    this.state.player.wins++;
    this.broadcast("end_battle", "The battle has ended!");
    if (this.state.player.wins >= 10) {
      this.broadcast("game_over", "You have won the game!");
    }
  }

  handleLose() {
    this.state.player.gold += this.state.player.round * 2;
    this.state.player.xp += this.state.player.round * 2;
    this.state.player.lives--;
    if (this.state.player.lives <= 0) {
      this.broadcast("game_over", "You have lost the game!");
    } else {
      this.broadcast("end_battle", "The battle has ended!");
    }
  }

  handleDraw() {
    this.state.player.gold += this.state.player.round * 2;
    this.state.player.xp += this.state.player.round * 2;
    this.broadcast("end_battle", "The battle has ended!");

  }

}

