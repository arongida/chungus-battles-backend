import { Client, Room } from '@colyseus/core';
import { DraftState } from './schema/DraftState';
import { copyPlayer, createNewPlayer, getPlayer, updatePlayer } from '../players/db/Player';
import { getNumberOfItems, getQuestItems, getItemById, cloneItem } from '../items/db/Item';
import { rollItemStats } from '../items/stats/itemStatRoller';
import { applyLuckyShopUpgrades, applyRarityUpgrade, baseLuckyFindChance, findOwnedUpgradeTarget } from '../commands/ShopUpgradeUtils';
import { Player } from '../players/schema/PlayerSchema';
import { Item } from '../items/schema/ItemSchema';
import { delay } from '../common/utils';
import { getRandomTalents } from '../talents/db/Talent';
import { Dispatcher } from '@colyseus/command';
import { ShopStartTriggerCommand } from '../commands/triggers/ShopStartTriggerCommand';
import { LevelUpTriggerCommand } from '../commands/triggers/LevelUpTriggerCommand';
import { AfterShopRefreshTriggerCommand } from '../commands/triggers/AfterShopRefreshTriggerCommand';
import { DraftAuraTriggerCommand } from '../commands/triggers/DraftAuraTriggerCommand';
import { EquipSlot, ItemClass, ItemRarity } from "../items/types/ItemTypes";
import { UpdateStatsCommand } from "../commands/UpdateStatsCommand";
import { PlayerAvatar } from '../players/types/PlayerTypes';
import { markFreeLuckyFindConsumed } from '../talents/behavior/TalentBehaviors';
import { RewardGainMessage } from '../common/MessageTypes';

export class DraftRoom extends Room {
    declare state: DraftState;
    maxClients = 1;

    dispatcher = new Dispatcher(this);
    private talentSelectionGeneration: number = 0;
    // Stack of recently-sold items, kept around so accidental sales can be undone in
    // reverse order. Cleared by any gold-spending action (see invalidateUndoSell).
    private soldItemStack: Item[] = [];

    async onCreate(options: any) {
        this.setState(new DraftState());

        this.onMessage('buy', async (client, message) => {
            await this.buyItem(message.itemId, client);
        });
        this.onMessage('sell', async (client, message) => {
            await this.sellItem(message.itemId);
        });
        this.onMessage('undo_sell', (client) => {
            this.undoSell(client);
        });
        this.onMessage('equip', async (client, message) => {
            await this.equipItem(message.itemId, message.slot, client);
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

        this.onMessage('level_up', async (client) => {
            const player = this.state.player;
            const xpNeeded = player.maxXp - player.xp;
            const purchases = Math.ceil(xpNeeded / 4);
            await this.buyXp(purchases * 4, purchases * 4, client);
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

        this.onMessage('abandon_run', async (client) => {
            this.state.player.lives = 0;
            await updatePlayer(this.state.player);
            client.send('game_over', 'You abandoned your run.');
        });

        //start clock for timings
        this.clock.start();

        this.setSimulationInterval(() => this.update(), 500);
        this.autoDispose = false;
    }

    update() {
        if (this.state.player) {
            this.dispatcher.dispatch(new UpdateStatsCommand());
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
            this.state.remainingTalentPoints = options.avatarUrl === PlayerAvatar.THIEF ? 2 : 1;
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

        //shop start trigger - deferred (not awaited) so onJoin returns and the
        //client receives its JOIN_ROOM confirmation before this runs. Any
        //client.send() called from here happens before that handshake — the
        //Colyseus SDK only registers onMessage handlers once JOIN_ROOM is
        //processed, so anything sent earlier is silently dropped. 500ms is
        //comfortably more than enough time for the client to finish joining.
        this.clock.setTimeout(async () => {
            await this.dispatcher.dispatch(new ShopStartTriggerCommand());
            await this.checkLevelUp();
        }, 500);

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
        // Comrade / Gold Genie: each newly built shop grants a fresh free-item claim.
        this.state.player.comradeClaimUsed = false;
        this.state.player.goldGenieClaimUsed = false;
        // Health potions are currently disabled from the shop.
        const excludeTypes = ['potion'];
        const shopFromDb = await getNumberOfItems(newShopSize, this.state.player.level, excludeTypes);
        const lockedShop = this.state.player.lockedShop;
        if (lockedShop.length > 0) {
            this.state.shop.clear();
            lockedShop.forEach(item => this.state.shop.push(item));
            this.state.player.unlockShop();
        } else if (this.state.shop.length < 6) {
            this.state.shop.clear();
            for (const rolledItem of shopFromDb) {
                if (rolledItem.type === 'potion') {
                    rolledItem.price = this.calculatePotionPrice(this.state.player);
                    rolledItem.sellPrice = Math.floor(rolledItem.price * 0.7);
                }
                const slot = this.state.shop.length;
                const ownedTarget = findOwnedUpgradeTarget(this.state.player, rolledItem.itemId);
                // Lucky find is disabled for potions and rings.
                const luckyEligible = rolledItem.type !== 'potion' && !rolledItem.tags?.includes('ring');
                let shopItem: Item;
                let steps: number;
                if (ownedTarget) {
                    // Preview = clone of the owned item (preserving its rolled stats
                    // and rarity) upgraded once with this specific shop roll.
                    const preview = cloneItem(ownedTarget);
                    applyRarityUpgrade(preview, rolledItem, this.state.player);
                    preview.price = rolledItem.price;
                    preview.sold = false;
                    preview.equipped = false;
                    preview.upgradePreview = true;
                    steps = luckyEligible ? applyLuckyShopUpgrades(preview, rolledItem, this.state.player) : 0;
                    shopItem = preview;
                } else {
                    steps = luckyEligible ? applyLuckyShopUpgrades(rolledItem, rolledItem, this.state.player) : 0;
                    shopItem = rolledItem;
                }
                shopItem.luckyFind = steps > 0;
                this.announceLuckyUpgrade(shopItem, steps, slot);
                this.state.shop.push(shopItem);
            }
        }

        this.dispatcher.dispatch(new AfterShopRefreshTriggerCommand());
    }

    private announceLuckyUpgrade(item: { name: string; rarity: number }, steps: number, slot: number) {
        if (steps <= 0) return;
        const rarityName = ItemRarity[item.rarity];
        const displayName = rarityName.charAt(0) + rarityName.slice(1).toLowerCase();
        // Floating text over the shop card (see TriggerAnimations.triggerShopFloatingText)
        // instead of a snackbar toast — the toast queued/overlapped awkwardly with other UI.
        this.clients[0]?.send('shop_floating', { slot, text: `Lucky find! Rarity up!`, rarity: item.rarity });
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
            this.invalidateUndoSell();
            await this.updateTalentSelection();
        }
    }

    private updateTalentRerollCost() {
        this.state.talentRerollCost = this.state.hasFreeTalentReroll ? 0 : this.state.player.level * 2;
    }

    private async updateTalentSelection() {
        const exceptions = this.state.availableTalents.map((talent) => talent.talentId);
        //if player has no talent points, return
        if (this.state.remainingTalentPoints <= 0) {
            this.state.availableTalents.clear();
            return;
        }

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
        // Clear and repopulate back-to-back (no await between them) so clients never observe
        // an empty availableTalents mid-reroll — that transient emptiness was being
        // misread by the frontend as "talent was picked" and closing the modal.
        this.state.availableTalents.clear();
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
        // Seed the hidden shop-roll stat for the very first shop of this draft phase — the
        // draft aura tick (which keeps it current afterward) hasn't run yet at this point.
        this.state.player.luckyFindChance = baseLuckyFindChance(this.state.player.level);
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
        // Comrade: a free-item claim is available for this shop — make this purchase free
        // regardless of price, then latch the claim as spent (DraftRoom.updateShop resets it).
        const comradeFree = this.state.player.comradeFreeClaim && !item.sold;
        // Gold Genie: same idea, scoped to the first merchant-class item bought this shop.
        const goldGenieFree = this.state.player.goldGenieFreeClaim && item.class === ItemClass.MERCHANT && !item.sold;
        if (comradeFree || goldGenieFree) {
            item.price = 0;
            item.sellPrice = 0;
        }
        if (this.state.player.gold < item.price || item.sold) {
            client.send('error', 'Not possible to buy item!');
            return;
        }
        this.state.player.getItem(item);
        if (comradeFree) {
            this.state.player.comradeClaimUsed = true;
            this.state.player.comradeFreeClaim = false;
        }
        if (goldGenieFree) {
            this.state.player.goldGenieClaimUsed = true;
            this.state.player.goldGenieFreeClaim = false;
        }
        markFreeLuckyFindConsumed(this.state.player, item);
        this.invalidateUndoSell();
    }

    private async sellItem(itemId: number) {
        const item = this.state.player.inventory.find((item) => item.itemId === itemId);
        if (!item) return;
        const goldBefore = this.state.player.gold;
        await this.state.player.sellItem(item);
        // sellItem() no-ops for equipped/quest items, so derive the actual delta rather
        // than assuming item.sellPrice was granted.
        const goldGained = this.state.player.gold - goldBefore;
        if (goldGained > 0) {
            this.clients[0]?.send('reward_gain', { playerId: this.state.player.playerId, gold: goldGained } as RewardGainMessage);
        }
        this.soldItemStack.push(item);
        this.state.canUndoSell = true;
        await this.resetStaleUpgradePreviews(itemId);
    }

    private undoSell(client: Client) {
        const item = this.soldItemStack[this.soldItemStack.length - 1];
        if (!item) {
            client.send('error', 'Nothing to undo!');
            return;
        }
        if (this.state.player.gold < item.sellPrice) {
            client.send('error', 'Not enough gold to undo!');
            return;
        }
        this.soldItemStack.pop();
        this.state.canUndoSell = this.soldItemStack.length > 0;
        this.state.player.gold -= item.sellPrice;
        this.state.player.inventory.push(item);
    }

    // Undo is meant for instant regret right after a sale — any other gold-spending
    // action in between (buy, level up, refresh shop/talents) closes the window, so
    // a sale's proceeds can't be spent and then the item recovered for free on top.
    private invalidateUndoSell() {
        this.soldItemStack.length = 0;
        this.state.canUndoSell = false;
    }

    private async resetStaleUpgradePreviews(soldItemId: number) {
        for (let i = 0; i < this.state.shop.length; i++) {
            const shopItem = this.state.shop[i];
            if (shopItem.itemId !== soldItemId || shopItem.sold) continue;
            if (!findOwnedUpgradeTarget(this.state.player, soldItemId)) {
                // Replace the stale upgrade-preview with a freshly rolled normal item.
                const baseItem = await getItemById(soldItemId);
                if (baseItem) {
                    rollItemStats(baseItem);
                    this.state.shop.splice(i, 1, baseItem);
                }
            }
        }
    }

    private async equipItem(itemId: number, slot: EquipSlot | string, client: Client) {
        if (slot === 'drink') {
            await this.drinkItem(itemId, client);
            return;
        }
        const item = this.state.player.inventory.find((item) => item.itemId === itemId);
        if (!item) return;
        this.state.player.setItemEquipped(item, slot as EquipSlot);
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
        this.state.player.unlockShop();
        this.state.shop.clear();
        this.invalidateUndoSell();
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

    private calculatePotionPrice(player: Player): number {
        const base = 8 * player.level;
        const discountFactor = player.lives === 1 ? 0.5 : player.lives === 2 ? 0.75 : 1;
        const goldFactor = 1 + player.gold * 0.01;
        return Math.max(1, Math.round(base * discountFactor * goldFactor));
    }

    private async drinkItem(itemId: number, client: Client) {
        const item = this.state.player.inventory.find((item) => item.itemId === itemId);
        if (!item) {
            return;
        }
        const equipOptions = Array.from(item.equipOptions as any as Iterable<string>);
        if (!equipOptions.includes('drink')) {
            return;
        }
        const idx = this.state.player.inventory.indexOf(item);
        this.state.player.inventory.splice(idx, 1);
        this.state.player.lives += 1 * item.rarity;
        await this.resetStaleUpgradePreviews(itemId);
        client.send('draft_log', `You drank the ${item.name} and regained a life! Lives: ${this.state.player.lives} ❤️`);
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
        client.send('reward_gain', { playerId: this.state.player.playerId, xp } as RewardGainMessage);
        this.invalidateUndoSell();
        await this.checkLevelUp();
    }

    public async checkLevelUp() {
        let leveled = false;
        while (this.state.player.xp >= this.state.player.maxXp) {
            const grantsTalentPoint = this.state.player.level < 5;
            await this.levelUp(this.state.player.xp - this.state.player.maxXp);
            if (grantsTalentPoint) {
                this.state.remainingTalentPoints++;
            }
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
        this.state.player.maxXp += this.state.player.level * 4 + 2;
        this.state.player.xp = leftoverXp;

        // Levels past 5 grant no talent points but give increasingly stronger stat bonuses
        if (this.state.player.level > 5) {
            const bonusRank = this.state.player.level - 5;
            const base = this.state.player.baseStats;
            base.strength += bonusRank * 4;
            base.accuracy += bonusRank * 2;
            base.maxHp += bonusRank * 40;
            base.defense += bonusRank * 4;
            base.attackSpeed += bonusRank * 0.2;
        }

        this.dispatcher.dispatch(new LevelUpTriggerCommand());
    }
}
