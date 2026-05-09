import { Client, Room } from '@colyseus/core';
import { DraftState } from './schema/DraftState';
import { Item } from '../items/schema/ItemSchema';
import { copyPlayer, createNewPlayer, getPlayer, updatePlayer } from '../players/db/Player';
import { getNumberOfItems, getQuestItems, getItemById } from '../items/db/Item';
import { applyRarityUpgrade, findOwnedUpgradeTarget } from '../commands/ShopUpgradeUtils';
import { Player } from '../players/schema/PlayerSchema';
import { delay } from '../common/utils';
import { getRandomTalents } from '../talents/db/Talent';
import { Dispatcher } from '@colyseus/command';
import { ShopStartTriggerCommand } from '../commands/triggers/ShopStartTriggerCommand';
import { LevelUpTriggerCommand } from '../commands/triggers/LevelUpTriggerCommand';
import { AfterShopRefreshTriggerCommand } from '../commands/triggers/AfterShopRefreshTriggerCommand';
import { DraftAuraTriggerCommand } from '../commands/triggers/DraftAuraTriggerCommand';
import { EquipSlot } from "../items/types/ItemTypes";
import { UpdateStatsCommand } from "../commands/UpdateStatsCommand";
import { UpdateActiveSets } from "../commands/UpdateActiveSets";
import { ArraySchema } from "@colyseus/schema";

export class DraftRoom extends Room {
    declare state: DraftState;
    maxClients = 1;

    dispatcher = new Dispatcher(this);
    private talentSelectionGeneration: number = 0;

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

        this.onMessage('buy_xp', async (client) => {
            await this.buyXp(4, 4, client);
        });

        this.onMessage('select_talent', async (client, message) => {
            await this.selectTalent(message.talentId);
        });

        this.onMessage('refresh_talents', async (client) => {
            await this.handleRefreshTalentSelection(client);
        });
        this.onMessage('lock-shop', (client) => {
            this.handleLockShop(client);
        });
        this.onMessage('unlock-shop', (client) => {
            this.handleUnlockShop(client);
        });

        //start clock for timings
        this.clock.start();

        this.setSimulationInterval(() => this.update(), 500);
        this.autoDispose = false;
    }

    update() {
        if (this.state.player) {
            this.dispatcher.dispatch(new UpdateStatsCommand());
            this.dispatcher.dispatch(new UpdateActiveSets());
        }
    }

    async onJoin(client: Client, options: any) {
        console.log('[DraftRoom]', client.sessionId, 'joined!');
        console.log('[DraftRoom]', 'name: ', options.name);
        console.log('[DraftRoom]', 'player id: ', options.playerId);

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

        //set quest items
        this.state.questItems.clear();
        (await getQuestItems()).forEach(item => this.state.questItems.push(item));


        
        //start auras
        this.clock.setInterval(() => {
            this.dispatcher.dispatch(new DraftAuraTriggerCommand());
        }, 1000)
        
        //shop start trigger - wait a bit for client to load
        await delay(500, this.clock);
        this.dispatcher.dispatch(new ShopStartTriggerCommand());
        await this.checkLevelUp();

    }

    onDrop(client: Client) {
        this.allowReconnection(client, 30)
    }

    async onLeave(client: Client, code: number) {
        console.log(`[DraftRoom] onLeave  sid=${client.sessionId} code=${code} roomId=${this.roomId}`);
        this.state.player.sessionId = '';
        await copyPlayer(this.state.player);
        await updatePlayer(this.state.player);
        console.log(`[DraftRoom] player saved, scheduling disconnect in 5s  roomId=${this.roomId}`);
        this.clock.setTimeout(() => {
            this.disconnect();
        }, 5000);

    }

    onDispose() {
        console.log('[DraftRoom]', 'room', this.roomId, 'disposing...');
    }

    private async updateShop(newShopSize: number) {
        const shopFromDb = await getNumberOfItems(newShopSize, this.state.player.level);
        const lockedShop = this.state.player.lockedShop;
        if (lockedShop.length > 0) {
            this.state.shop.clear();
            lockedShop.forEach(item => this.state.shop.push(item));
            this.state.player.unlockShop();
        } else if (this.state.shop.length < 6) {
            this.state.shop.clear();
            for (const rolledItem of shopFromDb) {
                const ownedTarget = findOwnedUpgradeTarget(this.state.player, rolledItem.itemId);
                if (ownedTarget) {
                    const preview = await getItemById(rolledItem.itemId);
                    if (!preview) {
                        this.state.shop.push(rolledItem);
                        continue;
                    }
                    const source = await getItemById(rolledItem.itemId);
                    if (!source) {
                        this.state.shop.push(rolledItem);
                        continue;
                    }
                    while (preview.rarity < ownedTarget.rarity + 1) {
                        applyRarityUpgrade(preview, source);
                    }
                    preview.price = rolledItem.price;
                    this.state.shop.push(preview);
                } else {
                    this.state.shop.push(rolledItem);
                }
            }
        }

        this.dispatcher.dispatch(new AfterShopRefreshTriggerCommand());
    }

    private async handleRefreshTalentSelection(client: Client) {
        const price = this.state.hasFreeTalentReroll ? 0 : this.state.player.level * 2;
        if (this.state.player.gold < price) {
            client.send('error', 'Not enough gold!');
        } else if (this.state.remainingTalentPoints === 0) {
            client.send('error', 'No talent points left!');
        } else {
            this.state.player.gold -= price;
            this.state.hasFreeTalentReroll = false;
            this.updateTalentRerollCost();
            await this.updateTalentSelection();
        }
    }

    private updateTalentRerollCost() {
        this.state.talentRerollCost = this.state.hasFreeTalentReroll ? 0 : this.state.player.level * 2;
    }

    private async updateTalentSelection() {
        const exceptions = this.state.availableTalents.map((talent) => talent.talentId);
        this.state.availableTalents.clear();
        //if player has no talent points, return
        if (this.state.remainingTalentPoints <= 0) return;

        const generation = ++this.talentSelectionGeneration;

        //get next talent level to choose from
        let nextTalentLevel = 1;
        if (this.state.player.talents.length > 0) {
            const maxTier = this.state.player.talents.reduce((max, t) => Math.max(max, t.tier), 0);
            nextTalentLevel = maxTier + 1;
        }
        //assign talents from db to state
        const talents = await getRandomTalents(2, nextTalentLevel, exceptions);
        if (generation !== this.talentSelectionGeneration) return;
        talents.forEach((talent) => {
            if (this.state.availableTalents.length < 2) this.state.availableTalents.push(talent);
        });
    }

    //get player, enemy, items and talents from db and map them to the room state
    private async setUpState(player: Player, client: Client) {
        this.state.player.copyFrom(player);

        const highestTalentTier = this.state.player.talents.length > 0
            ? this.state.player.talents.reduce((max, t) => Math.max(max, t.tier), 0)
            : 0;

        this.state.remainingTalentPoints = player.level - highestTalentTier;
        this.state.hasFreeTalentReroll = this.state.remainingTalentPoints > 0;
        this.updateTalentRerollCost();
        await this.updateTalentSelection();

        this.state.player.sessionId = client.sessionId;
        this.state.playerClient = client;

    }

    private async buyItem(itemId: number, client: Client) {
        const item = this.state.shop.find((item) => item.itemId === itemId);
        if (!item) {
            client.send('error', 'Not possible to buy item!');
            return;
        }
        if (this.state.player.gold < item.price || item.sold) {
            client.send('error', 'Not possible to buy item!');
            return;
        }
        this.state.player.getItem(item);
    }

    private async sellItem(itemId: number) {
        const item = this.state.player.inventory.find((item) => item.itemId === itemId);
        if (!item) return;
        await this.state.player.sellItem(item);
        await this.resetStaleUpgradePreviews(itemId);
    }

    private async resetStaleUpgradePreviews(soldItemId: number) {
        for (let i = 0; i < this.state.shop.length; i++) {
            const shopItem = this.state.shop[i];
            if (shopItem.itemId !== soldItemId) continue;
            if (!findOwnedUpgradeTarget(this.state.player, soldItemId)) {
                const baseItem = await getItemById(soldItemId);
                if (baseItem) this.state.shop.splice(i, 1, baseItem);
            }
        }
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

    private async handleLockShop(client: Client) {
        const shop = this.state.shop;
        this.state.player.setLockedShop(shop);
        client.send('message', 'shop locked');
    }

    private async handleUnlockShop(client: Client) {
        this.state.player.unlockShop();
        client.send('message', 'shop unlocked');
    }

    private async selectTalent(talentId: number) {
        const talent = this.state.availableTalents.find((talent) => talent.talentId === talentId);
        if (talent) {
            this.state.player.talents.push(talent);
            this.state.remainingTalentPoints--;
            this.state.hasFreeTalentReroll = this.state.remainingTalentPoints > 0;
            this.updateTalentRerollCost();
            await this.updateTalentSelection();
        }
    }

    private async buyXp(xp: number, price: number, client: Client) {
        if (this.state.player.gold < price) {
            client.send('error', 'Not enough gold!');
            return;
        }
        this.state.player.gold -= price;
        this.state.player.xp += xp;
        await this.checkLevelUp();
    }

    public async checkLevelUp() {
        let leveled = false;
        while (this.state.player.level < 5 && this.state.player.xp >= this.state.player.maxXp) {
            await this.levelUp(this.state.player.xp - this.state.player.maxXp);
            this.state.remainingTalentPoints++;
            leveled = true;
        }
        if (leveled) {
            this.state.hasFreeTalentReroll = true;
            this.updateTalentRerollCost();
            await this.updateTalentSelection();
        }
    }

    private async levelUp(leftoverXp: number = 0) {
        this.state.player.level++;
        this.state.player.maxXp += this.state.player.level * 4;
        this.state.player.xp = leftoverXp;

        this.dispatcher.dispatch(new LevelUpTriggerCommand());
    }
}
