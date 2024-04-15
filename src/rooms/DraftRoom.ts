import { Room, Client } from "@colyseus/core";
import { DraftState, Player } from "./schema/DraftState";
import playersJson from "../data/players.json";
import defaultPlayer from "../data/default-player.json";
import fs from 'fs';
import path from 'path'
// import { Player }  from "./schema/player";

export class DraftRoom extends Room<DraftState> {

  player: Player;
  players: Player[];


  maxClients = 1;

  onCreate(options: any) {
    this.setState(new DraftState());

    this.onMessage("die", (client, message) => {
      this.state.player.hp = 0;
      console.log("die", this.state.player.hp);
    });

    this.onMessage("live", (client, message) => {
      this.state.player.hp = 10;
      console.log("live", this.state.player.hp);
    });

    //this.setSimulationInterval((deltaTime) => this.update(deltaTime));


  }

  onJoin(client: Client, options: any) {
    console.log(client.sessionId, "joined!");
    console.log("name", options.name);
    console.log("player id", options.playerId);

    if (!options.name) throw new Error("Name is required!");
    if (!options.playerId) throw new Error("Player ID is required!");

    this.players = playersJson as Player[];
    console.log("players", this.players);

    this.player = this.players.find((player) => player.playerId === options.playerId);

    if (this.player) {

      if (this.player.sessionId !== "") throw new Error("Player already playing!");
      this.player.sessionId = client.sessionId;
      
    } else {

      const newPlayer = defaultPlayer;
      defaultPlayer.playerId = options.playerId;
      defaultPlayer.name = options.name;
      defaultPlayer.sessionId = client.sessionId;
      playersJson.push(newPlayer);
      this.player = newPlayer as Player;
    }

    //set room state from joined player
    this.state.player.assign(this.player);

    //save player to json
    const dirPath = path.join(__dirname, '../data/players.json');
    fs.writeFileSync(dirPath, JSON.stringify(playersJson));
    
  }

  onLeave(client: Client, consented: boolean) {
    this.player.sessionId = "";
    console.log(client.sessionId, "left!");
    const dirPath = path.join(__dirname, '../data/players.json');
    fs.writeFileSync(dirPath, JSON.stringify(playersJson));
  }

  onDispose() {
    console.log("room", this.roomId, "disposing...");
  }

  // update(deltaTime) {

  // }

}
