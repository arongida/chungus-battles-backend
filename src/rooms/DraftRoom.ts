import {Client, Room} from '@colyseus/core';
import {DraftState} from './schema/DraftState';
import { Item} from '../items/schema/ItemSchema';
import {copyPlayer, createNewPlayer, getPlayer, updatePlayer} from '../players/db/Player';
import {getNumberOfItems, getQuestItems} from '../items/db/Item';
import {Player} from '../players/schema/PlayerSchema';
import {delay} from '../common/utils';
import {getRandomTalents} from '../talents/db/Talent';
import {Dispatcher} from '@colyseus/command';
import {ShopStartTriggerCommand} from '../commands/triggers/ShopStartTriggerCommand';
import {LevelUpTriggerCommand} from '../commands/triggers/LevelUpTriggerCommand';
import {AfterShopRefreshTriggerCommand} from '../commands/triggers/AfterShopRefreshTriggerCommand';
import {SetUpQuestItemsCommand} from '../commands/SetUpQuestItemsCommand';
import {DraftAuraTriggerCommand} from '../commands/triggers/DraftAuraTriggerCommand';
import {EquipSlot} from "../items/types/ItemTypes";
import {getAllItemCollections} from "../item-collections/db/ItemCollection";
import {AffectedStats} from "../common/schema/AffectedStatsSchema";
import {UpdateStatsCommand} from "../commands/UpdateStatsCommand";

export class DraftRoom extends Room<DraftState> {
    maxClients = 1;

    dispatcher = new Dispatcher(this);

    async onCreate(options: any) {
        this.setState(new DraftState());

        this.onMessage('buy', async (client, message) => {
            await this.buyItem(message.itemId, client);
        });
        this.onMessage('sell', async (client, message) => {
            await this.sellItem(message.itemId);
        });
        this.onMessage('equip', async (client, message) => {
            await this.equipItem(message.itemId, message.slot);
        });
        this.onMessage('unequip', async (client, message) => {
            await this.unequipItem(message.itemId, message.slot);
        });
        this.onMessage('refresh_shop', (client) => {
            this.refreshShop(client);
        });

        this.onMessage('buy_xp', (client) => {
            this.buyXp(4, 4, client);
        });

        this.onMessage('select_talent', (client, message) => {
            this.selectTalent(message.talentId);
        });

        this.onMessage('refresh_talents', (client) => {
            this.handleRefreshTalentSelection(client);
        });

        //start clock for timings
        this.clock.start();

        this.setSimulationInterval(() => this.update(), 100);
        this.autoDispose = false;
    }

    update() {
        if (this.state.player) {
            this.dispatcher.dispatch(new UpdateStatsCommand());
        }
    }

    async onJoin(client: Client, options: any) {
        console.log(client.sessionId, 'joined!');
        console.log('name: ', options.name);
        console.log('player id: ', options.playerId);

        if (!options.name) throw new Error('Name is required!');
        if (!options.playerId) throw new Error('Player ID is required!');

        await delay(1000, this.clock);
        const foundPlayer = await getPlayer(options.playerId);

        //if player already exists, check if player is already playing
        if (foundPlayer) {
            if (foundPlayer.sessionId !== '') throw new Error('Player already playing!');
            if (foundPlayer.lives <= 0) throw new Error('Player has no lives left!');

            await this.setUpState(foundPlayer, client);

            //check levelup after battle
            await this.checkLevelUp();
        } else {
            const newPlayer = await createNewPlayer(options.playerId, options.name, client.sessionId, options.avatarUrl);
            this.state.remainingTalentPoints = 1;
            await this.setUpState(newPlayer, client);
        }

        //set room state
        if (this.state.player.round === 1) await this.updateTalentSelection();
        if (this.state.shop.length === 0) await this.updateShop(this.state.shopSize);
        this.state.availableItemCollections = await getAllItemCollections();

        //set quest items
        this.dispatcher.dispatch(new SetUpQuestItemsCommand(), {questItemsFromDb: (await getQuestItems()) as Item[]});

        //shop start trigger
        this.dispatcher.dispatch(new ShopStartTriggerCommand());

        //start auras
        this.clock.setInterval(() => {
            this.dispatcher.dispatch(new DraftAuraTriggerCommand());
        }, 1000)

        console.log('set up room finished!');
    }

    async onLeave(client: Client, consented: boolean) {
        try {
            if (consented) {
                throw new Error('consented leave');
            }

            // allow disconnected client to reconnect into this room until 20 seconds
            await this.allowReconnection(client, 20);
            console.log(`${client.sessionId} reconnected!`);
        } catch (e) {
            //save player state to db
            this.state.player.sessionId = '';
            await copyPlayer(this.state.player);
            await updatePlayer(this.state.player);
            console.log(client.sessionId, 'left!');
            this.clock.setTimeout(() => {
                this.disconnect();
            }, 5000);
        }
    }

    onDispose() {
        console.log('room', this.roomId, 'disposing...');
    }

    private async updateShop(newShopSize: number) {
        const itemQueryResults = await getNumberOfItems(newShopSize, this.state.player.level);
        itemQueryResults.forEach((item) => {
            let newItemObject = item as Item;
            const newAffectedStats = new AffectedStats();
            newAffectedStats.assign(newItemObject.affectedStats);
            newItemObject.affectedStats = newAffectedStats;
            const newItem = new Item();
            newItem.assign(newItemObject);
            if (this.state.shop.length < 6) this.state.shop.push(newItem);
        });

        this.dispatcher.dispatch(new AfterShopRefreshTriggerCommand());
    }

    private async handleRefreshTalentSelection(client: Client) {
        const price = this.state.player.level * 2;
        if (this.state.player.gold < price) {
            client.send('error', 'Not enough gold!');
        } else if (this.state.remainingTalentPoints === 0) {
            client.send('error', 'No talent points left!');
        } else {
            this.state.player.gold -= price;
            await this.updateTalentSelection();
        }
    }

    private async updateTalentSelection() {
        const exceptions = this.state.availableTalents.map((talent) => talent.talentId);
        this.state.availableTalents.clear();
        //if player has no talent points, return
        if (this.state.remainingTalentPoints <= 0) return;

        //get next talent level to choose from
        let nextTalentLevel = 1;
        if (this.state.player.talents.length > 0)
            nextTalentLevel = this.state.player.talents.sort((a, b) => b.tier - a.tier)[0].tier + 1;
        //assign talents from db to state
        const talents = await getRandomTalents(2, nextTalentLevel, exceptions);
        talents.forEach((talent) => {
            if (this.state.availableTalents.length < 2) this.state.availableTalents.push(talent);
        });
    }

    //get player, enemy, items and talents from db and map them to the room state
    private async setUpState(player: Player, client: Client) {
        this.state.player.assign(player);

        let highestTalentTier;
        if (this.state.player.talents.length > 0) {
            highestTalentTier = this.state.player.talents.sort((a, b) => b.tier - a.tier)[0].tier;
        } else {
            highestTalentTier = 0;
        }

        this.state.remainingTalentPoints = player.level - highestTalentTier;


        await this.updateTalentSelection();

        this.state.player.sessionId = client.sessionId;
        this.state.playerClient = client;

        this.state.playerClient = client;
    }

    private async buyItem(itemId: number, client: Client) {
        const item = this.state.shop.find((item) => item.itemId === itemId);
        if (this.state.player.gold < item.price || item.sold) {
            client.send('error', 'Not possible to buy item!');
            return;
        }
        if (item) {
            this.state.player.getItem(item);
        }
    }

    private async sellItem(itemId: number) {
        const item = this.state.player.inventory.find((item) => item.itemId === itemId);
        if (!item) return;
        await this.state.player.sellItem(item);
    }

    private async equipItem(itemId: number, slot: EquipSlot) {
        const item = this.state.player.inventory.find((item) => item.itemId === itemId);
        if (!item) return;
        this.state.player.setItemEquipped(item, slot);
    }

    private async unequipItem(itemId: number, slot: EquipSlot) {
        const item = this.state.player.equippedItems.get(slot);
        if (!item || item.itemId !== itemId) return;
        this.state.player.setItemUnequipped(item, slot);
    }

    private async refreshShop(client: Client) {
        if (this.state.player.gold < this.state.player.refreshShopCost) {
            client.send('error', 'Not enough gold!');
            return;
        }
        this.state.player.gold -= this.state.player.refreshShopCost;
        this.state.shop.clear();
        await this.updateShop(this.state.shopSize);
    }

    private async selectTalent(talentId: number) {
        const talent = this.state.availableTalents.find((talent) => talent.talentId === talentId);
        if (talent) {
            this.state.player.talents.push(talent);
            this.state.remainingTalentPoints--;
            await this.updateTalentSelection();
        }
    }

    private buyXp(xp: number, price: number, client: Client) {
        if (this.state.player.gold < price) {
            client.send('error', 'Not enough gold!');
            return;
        }
        this.state.player.gold -= price;
        this.state.player.xp += xp;
        this.checkLevelUp();
    }

    private async checkLevelUp() {
        if (this.state.player.level >= 5) return;
        if (this.state.player.xp >= this.state.player.maxXp) {
            await this.levelUp(this.state.player.xp - this.state.player.maxXp);
            this.state.remainingTalentPoints++;
            await this.updateTalentSelection();
        }
    }

    private async levelUp(leftoverXp: number = 0) {
        this.state.player.level++;
        this.state.player.maxXp += this.state.player.level * 4;
        this.state.player.xp = leftoverXp;
        await this.state.player.updateAvailableItemCollections();

        this.dispatcher.dispatch(new LevelUpTriggerCommand());
    }
}
