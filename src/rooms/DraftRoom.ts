import { Room, Client } from "@colyseus/core";
import { DraftState } from "./schema/DraftState";
import players from "../data/players.json";
import defaultPlayer from "../data/default-player.json";
import fs from 'fs';
import path from 'path'
import { Player }  from "./schema/player";

export class DraftRoom extends Room<DraftState> {

  player: Player;
  players: Player[];


  maxClients = 1;

  onCreate(options: any) {
    this.setState(new DraftState());

    this.onMessage("chat", (client, message) => {
      this.broadcast("messages", `${client.sessionId}: ${message}`);
    });

    //this.setSimulationInterval((deltaTime) => this.update(deltaTime));


  }

  onJoin(client: Client, options: any) {
    console.log(client.sessionId, "joined!");
    console.log("name", options.name);
    console.log("player id", options.playerId);

    this.players = players;

    this.player = this.players.find((player) => player.playerId === options.playerId);
    console.log("player", this.player)

    if (this.player) {

      if (this.player.sessionId !== "") throw new Error("Player already playing!");
      this.player.sessionId = client.sessionId;

    } else {

      const newPlayer = defaultPlayer;
      defaultPlayer.playerId = options.playerId;
      defaultPlayer.name = options.name;
      defaultPlayer.sessionId = client.sessionId;
      players.push(newPlayer);
      this.player = newPlayer;
    }

    const dirPath = path.join(__dirname, '../data/players.json');
    fs.writeFileSync(dirPath, JSON.stringify(players));
    
  }

  onLeave(client: Client, consented: boolean) {
    this.player.sessionId = "";
    console.log(client.sessionId, "left!");
    const dirPath = path.join(__dirname, '../data/players.json');
    fs.writeFileSync(dirPath, JSON.stringify(players));
  }

  onDispose() {
    console.log("room", this.roomId, "disposing...");
  }

  // update(deltaTime) {

  // }

}
