import { Room, Client } from "@colyseus/core";
import { FightState } from "./schema/FightState";

export class FightRoom extends Room<FightState> {
  maxClients = 2;

  onCreate (options: any) {
    this.setState(new FightState());

    this.onMessage("chat", (client, message) => {
      this.broadcast("messages", `${ client.sessionId }: ${ message }`);
    });

    //this.setSimulationInterval((deltaTime) => this.update(deltaTime));
  }

  onJoin (client: Client, options: any) {
    console.log(client.sessionId, "joined!");
    console.log("name", options.name);
    console.log("player id", options.playerId);


  }

  onLeave (client: Client, consented: boolean) {
    console.log(client.sessionId, "left!");
  }

  onDispose() {
    console.log("room", this.roomId, "disposing...");
  }

  // update(deltaTime) {
    
  // }
}
