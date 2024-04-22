import { Room, Client } from "@colyseus/core";
import { DraftState } from "./schema/DraftState";
import { Item } from "./schema/ItemSchema";
import { createNewPlayer } from "../db/Player";
import { getAllItems } from "../db/Item";
import { getPlayer, updatePlayer } from "../db/Player";

export class DraftRoom extends Room<DraftState> {

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

  async onJoin(client: Client, options: any) {
    console.log(client.sessionId, "joined!");
    console.log("name: ", options.name);
    console.log("player id: ", options.playerId);

    if (!options.name) throw new Error("Name is required!");
    if (!options.playerId) throw new Error("Player ID is required!");


    const findPlayer = await getPlayer(options.playerId);
    console.log("findPlayer: ", findPlayer);

    //if player already exists, check if player is already playing
    if (findPlayer) {

      if (findPlayer.sessionId !== "") throw new Error("Player already playing!");
      this.state.player.assign(findPlayer);
      this.state.player.sessionId = client.sessionId;
    } else {

      const newPlayer = await createNewPlayer(options.playerId, options.name, client.sessionId);
      this.state.player.assign(newPlayer);
    }

    //set room state from joined player
    await this.updateShop(this.state.shopSize);
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

  private async updateShop(newShopSize: number) {
    const itemQueryResults = await getAllItems(newShopSize);
    const items = itemQueryResults;
    items.forEach((item) => {
      const newItem = new Item();
      newItem.assign(item);
      this.state.shop.push(newItem);
    });
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
