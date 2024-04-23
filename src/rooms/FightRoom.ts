import { Room, Client } from "@colyseus/core";
import { FightState } from "./schema/FightState";
import { getPlayer, getSameRoundPlayer, updatePlayer } from "../db/Player";
import { Player } from "./schema/PlayerSchema";
import { Delayed } from "colyseus";

export class FightRoom extends Room<FightState> {
  maxClients = 1;
  battleStarted = false;
  playerAttackInterval: Delayed;
  enemyAttackInterval: Delayed;


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
    const player = await getPlayer(options.playerId);
    if (!player) throw new Error("Player not found!");
    this.state.player.assign(player);

    // check if player is already playing
    if (this.state.player.sessionId !== "") throw new Error("Player already playing!");
    this.state.player.sessionId = client.sessionId;

    //get enemy
    await this.getRandomEnemy();

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
        this.broadcast("combat_log", "The battle has ended!");
        this.broadcast("combat_log", `${this.state.player.hp <= 0 ? this.state.enemy.name : this.state.player.name} wins!`);

        //set state and clear intervals
        this.battleStarted = false;
        this.playerAttackInterval.clear();
        this.enemyAttackInterval.clear();
      }
    }
  }

  //start attack loop for player and enemy, they run at different intervals according to their attack speed
  async startBattle(){
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
}
