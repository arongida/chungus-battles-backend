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
  playerAttackInterval: Delayed;
  enemyAttackInterval: Delayed;
  playerMaxHp: number;
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
    const player = await getPlayer(options.playerId);
    if (!player) throw new Error("Player not found!");
    // this.state.player.assign(player);
    // console.log("player", this.state.player.toJSON());

    //get player talent info
    // const talents = await getTalentsById(player.talents);
    // console.log("talents: ", talents);
    // talents.forEach((talent) => {
    //   const newTalent = new Talent();
    //   newTalent.assign(talent);
    //   this.state.player.talents.push(newTalent);
    // });

    // check if player is already playing
    if (this.state.player.sessionId !== "") throw new Error("Player already playing!");
    if (this.state.player.lives <= 0) throw new Error("Player has no lives left!");
    this.state.player.sessionId = client.sessionId;

    //get enemy
    await this.getRandomEnemy();

    //save original player hp
    this.playerMaxHp = this.state.player.hp;

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
      this.state.player.hp = this.playerMaxHp;
      this.state.player.round++;
      const updatedPlayer = await updatePlayer(this.state.player);
      console.log(client.sessionId, "left!");
    }
  }

  onDispose() {
    console.log("room", this.roomId, "disposing...");
  }

  async getRandomEnemy() {
    if (this.state.enemy.playerId) return;
    const enemy = await getSameRoundPlayer(this.state.player.round);
    this.state.enemy.assign(enemy);
  }

  //this is running all the time 
  update(deltaTime: number) {

    //check for battle end
    if (this.battleStarted) {
      if (this.state.player.hp <= 0 || this.state.enemy.hp <= 0) {

        //set state and clear intervals
        this.battleStarted = false;
        this.playerAttackInterval.clear();
        this.enemyAttackInterval.clear();

        this.broadcast("combat_log", "The battle has ended!");
        this.handleFightEnd();

      }
    }
  }

  //start attack loop for player and enemy, they run at different intervals according to their attack speed
  async startBattle() {
    this.playerAttackInterval = this.clock.setInterval(() => {
      this.attack(this.state.player, this.state.enemy);
    }, (1 / this.state.player.attackSpeed) * 1000);

    this.enemyAttackInterval = this.clock.setInterval(() => {
      this.attack(this.state.enemy, this.state.player);
    }, (1 / this.state.enemy.attackSpeed) * 1000);
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

