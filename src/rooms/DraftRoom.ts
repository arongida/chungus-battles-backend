import { Room, Client } from "@colyseus/core";
import { DraftState } from "./schema/DraftState";
import { AffectedStats, Item } from "./schema/ItemSchema";
import { Talent } from "./schema/TalentSchema";
import { createNewPlayer } from "../db/Player";
import { getNumberOfItems } from "../db/Item";
import { getPlayer, updatePlayer } from "../db/Player";
import { Player } from "./schema/PlayerSchema";
import { delay } from "../utils/utils";
import { getRandomTalents, getTalentsById } from "../db/Talent";

export class DraftRoom extends Room<DraftState> {

  maxClients = 1;

  async onCreate(options: any) {
    this.setState(new DraftState());

    this.onMessage("buy", (client, message) => {
      this.buyItem(message.itemId, client);
    });

    this.onMessage("refresh_shop", (client, message) => {
      this.refreshShop(client);
    });

    this.onMessage("buy_xp", (client, message) => {
      this.buyXp(4, 4, client);

    });

    this.onMessage("select_talent", (client, message) => {
      this.selectTalent(message.talentId);
    });



    //this.setSimulationInterval((deltaTime) => this.update(deltaTime));


  }

  async onJoin(client: Client, options: any) {
    console.log(client.sessionId, "joined!");
    console.log("name: ", options.name);
    console.log("player id: ", options.playerId);

    if (!options.name) throw new Error("Name is required!");
    if (!options.playerId) throw new Error("Player ID is required!");


    await delay(1000, this.clock);
    const foundPlayer = await getPlayer(options.playerId);

    //if player already exists, check if player is already playing
    if (foundPlayer) {

      if (foundPlayer.sessionId !== "") throw new Error("Player already playing!");
      if (foundPlayer.lives <= 0) throw new Error("Player has no lives left!");

      await this.setUpState(foundPlayer);
      this.state.player.sessionId = client.sessionId;

      //check levelup after battle
      this.checkLevelUp();
    } else {

      const newPlayer = await createNewPlayer(options.playerId, options.name, client.sessionId);
      this.state.player.assign(newPlayer);
      this.state.remainingTalentPoints = 1;
    }

    //set room shop and talents
    if (this.state.player.round === 1) await this.updateTalents();
    if (this.state.shop.length === 0) await this.updateShop(this.state.shopSize);
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

  // update(deltaTime) {

  // }

  private async updateShop(newShopSize: number) {
    const itemQueryResults = await getNumberOfItems(newShopSize, this.state.player.level);
    const items = itemQueryResults;
    items.forEach((item) => {
      
      let newItemObject = item as Item;
      let affectedStats = newItemObject.affectedStats;
      newItemObject.affectedStats = new AffectedStats(affectedStats);    
      const newItem = new Item();
      newItem.assign(newItemObject);
      this.state.shop.push(newItem);
    });
  }

  private async updateTalents() {
    this.state.availableTalents.clear();
    
    console.log("remaining talent points: ", this.state.remainingTalentPoints);

    if (this.state.remainingTalentPoints <= 0) return;

    const talents = await getRandomTalents(2, this.state.player.level);
    talents.forEach((talent) => {
      const newTalent = new Talent();
      newTalent.assign(talent);
      this.state.availableTalents.push(newTalent);
    });

  }

  //get player, enemy and talents from db and map them to the room state
  private async setUpState(player: Player) {
    //get player talent info
    const talents = await getTalentsById(player.talents as unknown as number[]) as Talent[];
    const newPlayer = new Player(player);

    this.state.player.assign(newPlayer);
    this.state.remainingTalentPoints = player.level - player.talents.length;
    player.talents.forEach(talentId => {
      const newTalent = new Talent(talents.find(talent => talent.talentId === talentId as unknown as number));
      const findTalent = this.state.player.talents.find(talent => talent.talentId === newTalent.talentId);
      if (findTalent) findTalent.level++;
      else this.state.player.talents.push(newTalent);

    });

    this.updateTalents();

  }

  private buyItem(itemId: number, client: Client) {
    const item = this.state.shop.find((item) => item.itemId === itemId);
    if (this.state.player.gold < item.price) {
      client.send("error", "Not enough gold!");
      return;
    }
    if (item) {
      this.state.player.gold -= item.price;


      console.log("item hp: ", item.affectedStats.hp);
      console.log("palyer hp: ", this.state.player.hp); 
      this.state.player.hp += item.affectedStats.hp;
      this.state.player.attack += item.affectedStats.attack;
      this.state.player.defense += item.affectedStats.defense;
      this.state.player.attackSpeed += item.affectedStats.attackSpeed;
      
      this.state.shop = this.state.shop.filter((item) => item.itemId !== itemId);
    }
  }

  private async refreshShop(client: Client) {
    if (this.state.player.gold < 2) {
      client.send("error", "Not enough gold!");
      return;
    }
    this.state.player.gold -= 2;
    this.state.shop.clear();
    await this.updateShop(this.state.shopSize);
  }

  private selectTalent(talentId: number) {
    const talent = this.state.availableTalents.find((talent) => talent.talentId === talentId);

    if (talent) {
      const foundTalent = this.state.player.talents.find((talent) => talent.talentId === talentId);
      if (foundTalent) foundTalent.level++;
      else this.state.player.talents.push(talent);
      this.state.remainingTalentPoints--;
      this.updateTalents();
    }
  }

  private buyXp(xp: number, price: number, client: Client) {
    if (this.state.player.gold < price) {
      client.send("error", "Not enough gold!");
      return;
    }
    this.state.player.gold -= price;
    this.state.player.xp += xp;
    this.checkLevelUp();
  }

  private checkLevelUp() {
    if (this.state.player.xp >= this.state.player.maxXp) {
      this.levelUp(this.state.player.xp - this.state.player.maxXp);
      this.state.remainingTalentPoints++;
      this.updateTalents();
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

  }
}
