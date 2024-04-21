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

    this.onMessage("buy", (client, message) => {
      this.buyItem(message.itemId, client);
    });

    this.onMessage("buyXp", (client, message) => {
      this.buyXp(4, 4, client);

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

  private buyItem(itemId: number, client: Client) {
    const item = this.state.shop.find((item) => item.itemId === itemId);
    if (this.state.player.gold < item.price) {
      client.send("error", "Not enough gold!");
      return;
    }
    if (item) {
      this.state.player.gold -= item.price;

      (this.state.player as any)[item.affectedStat] += item.affectedValue;
      this.state.shop = this.state.shop.filter((item) => item.itemId !== itemId);
    }
  }

  private buyXp(xp: number, price: number, client: Client) {
    if (this.state.player.gold < price) {
      client.send("error", "Not enough gold!");
      return;
    }
    this.state.player.gold -= price;
    this.state.player.xp += xp;
    console.log("xp: ", this.state.player.xp);
    this.checkLevelUp();
  }

  private checkLevelUp() {
    if (this.state.player.xp >= this.state.player.maxXp) {
      this.levelUp(this.state.player.xp - this.state.player.maxXp);
    }
  }

  private levelUp(leftoverXp: number = 0) {
    this.state.player.level++;
    this.state.player.maxXp += this.state.player.level * 2;
    this.state.player.xp = leftoverXp;

    this.state.player.hp += 10;
    this.state.player.attack += 1;
    this.state.player.defense += 1;
    this.state.player.attackSpeed += 0.1;
    console.log("Level up!");
  }
}
