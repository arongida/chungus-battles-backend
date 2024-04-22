import { Room, Client } from "@colyseus/core";
import { FightState } from "./schema/FightState";
import { Player } from "./schema/PlayerSchema";
import { MongoClient, ServerApiVersion } from 'mongodb';

export class FightRoom extends Room<FightState> {
  maxClients = 1;
  player: Player;
  players: Player[];
  //mongoClient: MongoClient;


  onCreate (options: any) {
    this.setState(new FightState());

    this.onMessage("chat", (client, message) => {
      this.broadcast("messages", `${ client.sessionId }: ${ message }`);
    });

    //this.setSimulationInterval((deltaTime) => this.update(deltaTime));
  }

  onJoin (client: Client, options: any) {
    console.log(client.sessionId, "joined!");
    console.log("player id", options.playerId);

    if (!options.playerId) throw new Error("Player ID is required!");

    //TODO: read players from json and find player by playerId
    //read players from json and find player by playerId
    //this.players = playersJson as Player[];
    this.player = this.players.find((player) => player.playerId === options.playerId);

    //if player already exists, check if player is already playing
    if (this.player) {

      if (this.player.sessionId !== "") throw new Error("Player already playing!");
      this.player.sessionId = client.sessionId;

    } else {

      
    }

    //set room state from joined player
    this.state.player.assign(this.player);


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
      console.log(client.sessionId, "left!");
    }
  }

  onDispose() {
    console.log("room", this.roomId, "disposing...");
  }

  // update(deltaTime) {
    
  // }
}
