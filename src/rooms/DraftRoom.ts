import { Room, Client } from "@colyseus/core";
import { DraftState, Player, Item } from "./schema/DraftState";
import playersJson from "../data/players.json";
import defaultPlayer from "../data/default-player.json";
import itemsJson from "../data/items.json";
import fs from 'fs';
import path from 'path'
// import { Player }  from "./schema/player";

export class DraftRoom extends Room<DraftState> {

  player: Player;
  players: Player[];
  items: Item[];


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

    this.onMessage("reconnect", (client, message) => {
      this.state.player.hp = 40;
      console.log("live", this.state.player.hp);
    });

    //this.setSimulationInterval((deltaTime) => this.update(deltaTime));


  }

  onJoin(client: Client, options: any) {
    console.log(client.sessionId, "joined!");
    console.log("name: ", options.name);
    console.log("player id: ", options.playerId);

    if (!options.name) throw new Error("Name is required!");
    if (!options.playerId) throw new Error("Player ID is required!");

    //read players from json and find player by playerId
    this.players = playersJson as Player[];
    this.player = this.players.find((player) => player.playerId === options.playerId);

    //if player already exists, check if player is already playing
    if (this.player) {

      if (this.player.sessionId !== "") throw new Error("Player already playing!");
      this.player.sessionId = client.sessionId;

    } else {

      //handle new player
      const newPlayer = defaultPlayer;
      defaultPlayer.playerId = options.playerId;
      defaultPlayer.name = options.name;
      defaultPlayer.sessionId = client.sessionId;
      playersJson.push(newPlayer);
      this.player = newPlayer as Player;
    }

    //set room state from joined player
    this.state.player.assign(this.player);
    this.updateShop(this.state.shopSize);

    //save player to json
    const dirPath = path.join(__dirname, '../data/players.json');
    fs.writeFileSync(dirPath, JSON.stringify(playersJson));

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
      this.player.sessionId = "";
      console.log(client.sessionId, "left!");
      const dirPath = path.join(__dirname, '../data/players.json');
      fs.writeFileSync(dirPath, JSON.stringify(playersJson));
    }
  }

  onDispose() {
    console.log("room", this.roomId, "disposing...");
  }

  // update(deltaTime) {

  // }

  private updateShop(newShopSize: number) {
    this.items = itemsJson as Item[];
    console.log("items: ", this.items);
    for (let i = 0; i < newShopSize; i++) {
      console.log("item: ", this.items[i]);
      this.state.shop.push(new Item(this.items[i]))
    }
  }
}
