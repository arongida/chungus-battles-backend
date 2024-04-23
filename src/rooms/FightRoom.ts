import { Room, Client } from "@colyseus/core";
import { FightState } from "./schema/FightState";
import { Player } from "./schema/PlayerSchema";
import { getPlayer, updatePlayer } from "../db/Player";

export class FightRoom extends Room<FightState> {
  maxClients = 1;

  onCreate (options: any) {
    this.setState(new FightState());

    this.onMessage("chat", (client, message) => {
      this.broadcast("messages", `${ client.sessionId }: ${ message }`);
    });

    //this.setSimulationInterval((deltaTime) => this.update(deltaTime));
  }

  async onJoin (client: Client, options: any) {
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
      console.log("updatedPlayer: ", updatedPlayer);
      console.log(client.sessionId, "left!");
    }
  }

  onDispose() {
    console.log("room", this.roomId, "disposing...");
  }

  // update(deltaTime) {
    
  // }
}
