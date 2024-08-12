import { Room, Client } from '@colyseus/core';
import { DraftState } from './schema/DraftState';
import { AffectedStats, Item } from '../items/schema/ItemSchema';
import { Talent } from '../talents/schema/TalentSchema';
import {
	copyPlayer,
	getPlayer,
	updatePlayer,
	createNewPlayer,
} from '../players/db/Player';
import { getNumberOfItems, getItemsById } from '../items/db/Item';
import { Player } from '../players/schema/PlayerSchema';
import { delay, increaseStats } from '../common/utils';
import { getRandomTalents, getTalentsById } from '../talents/db/Talent';
import { Dispatcher } from '@colyseus/command';
import { ShopStartTriggerCommand } from '../commands/ShopStartTriggerCommand';
import { LevelUpTriggerCommand } from '../commands/LevelUpTriggerCommand';
import { getItemCollectionsById } from '../item-collections/db/ItemCollection';
import { ItemCollection } from '../item-collections/schema/ItemCollectionSchema';

export class DraftRoom extends Room<DraftState> {
	maxClients = 1;

	dispatcher = new Dispatcher(this);

	async onCreate(options: any) {
		this.setState(new DraftState());

		this.onMessage('buy', (client, message) => {
			this.buyItem(message.itemId, client);
		});

		this.onMessage('refresh_shop', (client, message) => {
			this.refreshShop(client);
		});

		this.onMessage('buy_xp', (client, message) => {
			this.buyXp(4, 4, client);
		});

		this.onMessage('select_talent', (client, message) => {
			this.selectTalent(message.talentId);
		});

		this.onMessage('refresh_talents', (client, message) => {
			this.handleRefreshTalentSelection(client);
		});

		//this.setSimulationInterval((deltaTime) => this.update(deltaTime));
	}

	async onJoin(client: Client, options: any) {
		console.log(client.sessionId, 'joined!');
		console.log('name: ', options.name);
		console.log('player id: ', options.playerId);

		if (!options.name) throw new Error('Name is required!');
		if (!options.playerId) throw new Error('Player ID is required!');
		if (!options.playerId) throw new Error('Avatar is required!');

		await delay(1000, this.clock);
		const foundPlayer = await getPlayer(options.playerId);

		//if player already exists, check if player is already playing
		if (foundPlayer) {
			if (foundPlayer.sessionId !== '')
				throw new Error('Player already playing!');
			if (foundPlayer.lives <= 0) throw new Error('Player has no lives left!');

			await this.setUpState(foundPlayer);
			this.state.player.sessionId = client.sessionId;

			//check levelup after battle
			this.checkLevelUp();
		} else {
			const newPlayer = await createNewPlayer(
				options.playerId,
				options.name,
				client.sessionId,
				options.avatarUrl
			);
			this.state.player.assign(newPlayer);
			this.state.remainingTalentPoints = 1;
		}

		//set room state
		if (this.state.player.round === 1) await this.updateTalentSelection();
		if (this.state.shop.length === 0)
			await this.updateShop(this.state.shopSize);

		//this.state.availableItemCollections.push(...allItemCollections);

		//robbery command
		this.dispatcher.dispatch(new ShopStartTriggerCommand(), {
			playerClient: client,
		});
	}

	async onLeave(client: Client, consented: boolean) {
		try {
			if (consented) {
				throw new Error('consented leave');
			}

			// allow disconnected client to reconnect into this room until 20 seconds
			await this.allowReconnection(client, 20);
			console.log('client reconnected!');
		} catch (e) {
			//save player state to db
			this.state.player.sessionId = '';
			const copiedPlayer = await copyPlayer(this.state.player);
			const updatedPlayer = await updatePlayer(this.state.player);
			console.log(client.sessionId, 'left!');
		}
	}

	onDispose() {
		console.log('room', this.roomId, 'disposing...');
	}

	private async updateShop(newShopSize: number) {
		const itemQueryResults = await getNumberOfItems(
			newShopSize,
			this.state.player.level
		);
		const items = itemQueryResults;
		items.forEach((item) => {
			let newItemObject = item as Item;
			let affectedStats = newItemObject.affectedStats;
			newItemObject.affectedStats = new AffectedStats(affectedStats);
			const newItem = new Item();
			newItem.assign(newItemObject);
			this.state.shop.push(newItem);
		});
		await this.updateAvailableItemCollections();
	}



	private async updateAvailableItemCollections() {
		const neededCollectionIds = Array.from(
			new Set(
				this.state.shop
					.map((item) =>
						item.itemCollections.map((collectionId) => collectionId)
					)
					.flat()
			)
		);

		console.log('neededCollectionIds', neededCollectionIds);
		const availableItemCollections = (await getItemCollectionsById(
			neededCollectionIds
		)) as ItemCollection[];

    this.state.player.availableItemCollections.clear();

		availableItemCollections.forEach((itemCollection) => {
			const newItemCollection = new ItemCollection();
			newItemCollection.assign(itemCollection);
			this.state.player.availableItemCollections.push(newItemCollection);
		});


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
		const exceptions = this.state.availableTalents.map(
			(talent) => talent.talentId
		);
		this.state.availableTalents.clear();
		//if player has no talent points, return
		if (this.state.remainingTalentPoints <= 0) return;

		//get next talent level to choose from
		let nextTalentLevel = 1;
		if (this.state.player.talents.length > 0)
			nextTalentLevel =
				this.state.player.talents.sort((a, b) => b.tier - a.tier)[0].tier + 1;
		//assign talents from db to state
		const talents = await getRandomTalents(2, nextTalentLevel, exceptions);
		talents.forEach((talent) => {
			const newTalent = new Talent();
			newTalent.assign(talent);
			this.state.availableTalents.push(newTalent);
		});
	}

	//get player, enemy, items and talents from db and map them to the room state
	private async setUpState(player: Player) {
		//get player item, talent info
		const talents = (await getTalentsById(
			player.talents as unknown as number[]
		)) as Talent[];
		const itemDataFromDb = (await getItemsById(
			player.inventory as unknown as number[]
		)) as Item[];

		const newPlayer = new Player(player);
		this.state.player.assign(newPlayer);

		this.state.remainingTalentPoints = player.level - player.talents.length;
		player.talents.forEach((talentId) => {
			const newTalent = new Talent(
				talents.find(
					(talent) => talent.talentId === (talentId as unknown as number)
				)
			);
			this.state.player.talents.push(newTalent);
		});

		player.inventory.forEach((itemId) => {
			let newItem = new Item(
				itemDataFromDb.find(
					(item) => item.itemId === (itemId as unknown as number)
				)
			);
			newItem.affectedStats = new AffectedStats(newItem.affectedStats);
			this.state.player.inventory.push(newItem);
		});

		await this.updateTalentSelection();
	}

	private buyItem(itemId: number, client: Client) {
		const item = this.state.shop.find((item) => item.itemId === itemId);
		if (this.state.player.gold < item.price || item.sold) {
			client.send('error', 'Not possible to buy item!');
			return;
		}
		if (item) {
			this.state.player.getItem(item);
		}
	}

	private async refreshShop(client: Client) {
		if (this.state.player.gold < 2) {
			client.send('error', 'Not enough gold!');
			return;
		}
		this.state.player.gold -= 2;
		this.state.shop.clear();
		await this.updateShop(this.state.shopSize);
	}

	private async selectTalent(talentId: number) {
		const talent = this.state.availableTalents.find(
			(talent) => talent.talentId === talentId
		);
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
			this.levelUp(this.state.player.xp - this.state.player.maxXp);
			this.state.remainingTalentPoints++;
			await this.updateTalentSelection();
		}
	}

	private levelUp(leftoverXp: number = 0) {
		this.state.player.level++;
		this.state.player.maxXp += this.state.player.level * 4;
		this.state.player.xp = leftoverXp;

		this.dispatcher.dispatch(new LevelUpTriggerCommand(), {
			playerClient: this.clients[0],
		});
	}
}
