import { Schema, type, ArraySchema } from '@colyseus/schema';
import { Talent } from '../../talents/schema/TalentSchema';
import { Item } from '../../items/schema/ItemSchema';
import { IStats } from '../../common/types';
import { TalentType } from '../../talents/types/TalentTypes';
import { Client, Clock, Delayed } from 'colyseus';
import ClockTimer from '@gamestdio/timer';
import { increaseStats, decreaseStats } from '../../common/utils';
import { ItemCollection } from '../../item-collections/schema/ItemCollectionSchema';
import { getAllItemCollections, getItemCollectionsById } from '../../item-collections/db/ItemCollection';
import { ItemCollectionType } from '../../item-collections/types/ItemCollectionTypes';
import { ItemType } from '../../items/types/ItemTypes';

export class Player extends Schema implements IStats {
	@type('number') playerId: number;
	@type('string') name: string;
	@type('number') private _hp: number;
	@type('number') private _attack: number;
	@type('number') private _gold: number;
	@type('number') xp: number;
	@type('number') private _level: number;
	@type('string') sessionId: string;
	@type('number') private _defense: number;
	@type('number') private _attackSpeed: number;
	@type('number') baseAttackSpeed: number = 0.8;
	@type('number') maxXp: number;
	@type('number') round: number;
	@type('number') lives: number;
	@type('number') wins: number;
	@type('string') avatarUrl: string;
	@type('number') income: number;
	@type('number') hpRegen: number;
	@type([Talent]) talents: ArraySchema<Talent> = new ArraySchema<Talent>();
	@type([Item]) equippedItems: ArraySchema<Item> = new ArraySchema<Item>();
	@type([Item]) inventory: ArraySchema<Item> = new ArraySchema<Item>();
	@type([ItemCollection]) activeItemCollections: ArraySchema<ItemCollection> = new ArraySchema<ItemCollection>();
	@type([ItemCollection])
	availableItemCollections: ArraySchema<ItemCollection> = new ArraySchema<ItemCollection>();
	@type('number') dodgeRate: number = 0;
	@type('number') refreshShopCost: number = 2;
	@type('number') maxHp: number;
	initialStats: IStats = {
		hp: 0,
		attack: 0,
		defense: 0,
		attackSpeed: 0,
		income: 0,
		hpRegen: 0,
	};
	baseStats: IStats = {
		hp: 0,
		attack: 0,
		defense: 0,
		attackSpeed: 0,
		income: 0,
		hpRegen: 0,
	};
	initialInventory: Item[] = [];
	private _poisonStack: number = 0;
	attackTimer: Delayed;
	poisonTimer: Delayed;
	regenTimer: Delayed;
	invincibleTimer: Delayed;
	talentsOnCooldown: TalentType[] = [];
	invincible: boolean = false;
	damageToTake: number;
	rewardRound: number;

	get gold(): number {
		return this._gold;
	}

	set gold(value: number) {
		this._gold = value < 0 ? 0 : value;
	}

	get level(): number {
		return this._level;
	}

	set level(value: number) {
		this._level = value > 5 ? 5 : value;
	}

	get attackSpeed(): number {
		return this._attackSpeed;
	}

	set attackSpeed(value: number) {
		this._attackSpeed = value < 0.1 ? 0.1 : value;
	}

	get hp(): number {
		return this._hp;
	}

	set hp(value: number) {
		this._hp = value > this.maxHp ? this.maxHp : value;
	}

	get attack(): number {
		return this._attack;
	}

	set attack(value: number) {
		this._attack = value < 1 ? 1 : value;
	}

	get poisonStack(): number {
		return this._poisonStack;
	}

	set poisonStack(value: number) {
		if (value < 0) {
			this._poisonStack = 0;
		} else if (value > 100) {
			this._poisonStack = 100;
		} else {
			this._poisonStack = value;
		}
	}

	get defense(): number {
		return this._defense;
	}

	set defense(value: number) {
		this._defense = value < 0 ? 0 : value;
	}

	setInvincible(clock: ClockTimer, invincibleLenghtMS: number) {
		console.log('set invincible');
		this.invincible = true;
		if (this.invincibleTimer) {
			const timeLeft = this.invincibleTimer.time - this.invincibleTimer.elapsedTime;
			this.invincibleTimer.clear();
			this.invincibleTimer = clock.setTimeout(() => {
				this.invincible = false;
			}, timeLeft + invincibleLenghtMS);
		}
		this.invincibleTimer = clock.setTimeout(() => {
			this.invincible = false;
		}, invincibleLenghtMS);
	}

	takeDamage(damage: number, playerClient: Client) {
		if (this.invincible) return;
		this.hp -= damage;
		playerClient.send('damage', {
			playerId: this.playerId,
			damage: damage,
		});
	}

	getDamageAfterDefense(initialDamage: number): number {
		return initialDamage * (100 / (100 + this.defense));
	}

	getNumberOfItemsForTags(tags: string[]): number {
		return this.inventory.reduce((count, item) => {
			if (tags.some((tag) => item.tags.includes(tag))) {
				return count + 1;
			}
			return count;
		}, 0);
	}

	getItemsForTags(tags: string[]): Item[] {
		return this.inventory.filter((item) => tags.some((tag) => item.tags.includes(tag)));
	}

	getItemsForCollection(collectionId: number): Item[] {
		return this.equippedItems.filter((item) => item.itemCollections.includes(collectionId));
	}

	resetInventory() {
		this.inventory.splice(0, this.inventory.length, ...this.initialInventory);
	}

	addPoisonStacks(clock: ClockTimer, playerClient: Client, stack: number = 1, activationRate: number = 0.015) {
		this.poisonStack += stack;
		playerClient.send('combat_log', `${this.name} is poisoned! ${this.poisonStack} stacks!`);

		clock.setTimeout(() => {
			this.poisonStack -= stack;
			if (this.poisonStack === 0 && this.poisonTimer) {
				this.poisonTimer.clear();
				this.poisonTimer = null;
			}
		}, 10000);
	}

	async updateAvailableItemCollections() {
		const availableItemCollectionsFromDb = (await getAllItemCollections()) as ItemCollection[];

		this.availableItemCollections = new ArraySchema<ItemCollection>();

		availableItemCollectionsFromDb.forEach((itemCollection) => {
			const newItemCollection = new ItemCollection();
			newItemCollection.assign(itemCollection);
			this.availableItemCollections.push(newItemCollection);
		});

		//filter out irrelevant shield collections
		const highestShield = [...this.activeItemCollections.map((itemCollection) => itemCollection.itemCollectionId)]
			.filter(
				(collectionId) => collectionId >= ItemCollectionType.SHIELDS_1 && collectionId <= ItemCollectionType.SHIELDS_5
			)
			.sort()
			.pop();
		const shieldsToRemove = Array.from({ length: highestShield - 1 }, (_, i) => i + 1);

		//filter out already acquired item collections
		this.availableItemCollections = this.availableItemCollections.filter((itemCollection) => {
			const activeItemCollectionsIds = [
				...this.activeItemCollections.map((itemCollection) => itemCollection.itemCollectionId),
			];
			return (
				!activeItemCollectionsIds.includes(itemCollection.itemCollectionId) &&
				!shieldsToRemove.includes(itemCollection.itemCollectionId) &&
				itemCollection.tier <= this.level
			);
		});
	}

	getNeededIds(itemSchema: ArraySchema<Item>): number[] {
		return [...new Set(itemSchema?.map((item) => item.itemCollections.filter((collectionId) => collectionId)).flat())];
	}

	async updateActiveItemCollections() {
		const inventoryCollectionIds = this.getNeededIds(this.equippedItems);
		this.activeItemCollections.clear();
		let collectionIdsToActivate: number[] = [];

		inventoryCollectionIds.forEach((collectionId) => {
			if (collectionId >= ItemCollectionType.SHIELDS_1 && collectionId <= ItemCollectionType.SHIELDS_5) {
				const shields: Item[] = this.equippedItems.filter((item) => item.type === ItemType.SHIELD);
        const equippedShieldTier = shields[0]?.tier;
				collectionIdsToActivate.push(equippedShieldTier);
			}

			if (collectionId >= ItemCollectionType.WARRIOR_1) {
				const sameCollectionItems = this.getItemsForCollection(collectionId);
				const uniqueCollectionItems = [...new Set(sameCollectionItems.map((item) => item.itemId))];
				if (uniqueCollectionItems.length === 3) {
					collectionIdsToActivate.push(collectionId);
				}
			}
		});
		collectionIdsToActivate = [...new Set(collectionIdsToActivate)];

		const activeItemCollectionsFromDb = (await getItemCollectionsById(collectionIdsToActivate)) as ItemCollection[];

		this.activeItemCollections = new ArraySchema<ItemCollection>();

		activeItemCollectionsFromDb.forEach((itemCollection) => {
			const newItemCollection = new ItemCollection();
			newItemCollection.assign(itemCollection);
			this.activeItemCollections.push(newItemCollection);
		});

		await this.updateAvailableItemCollections();
	}

	async getItem(item: Item) {
		this.gold -= item.price;
		item.sold = true;
		this.inventory.push(item);
		await this.updateActiveItemCollections();
	}

	async removeItem(item: Item) {
		this.gold += Math.floor(item.price * 0.7);
		const indexOfDeletedItem = this.inventory.indexOf(item);
		this.inventory.splice(indexOfDeletedItem, 1);
		if (item.equipped) {
			const indexOfDeleteEquippedItem = this.equippedItems.indexOf(item);
			this.equippedItems.splice(indexOfDeleteEquippedItem, 1);
			decreaseStats(this, item.affectedStats);
		}

		await this.updateActiveItemCollections();
	}

	async setItemEquiped(item: Item) {
		const unequippedItem = this.equippedItems.find((equippedItem) => equippedItem.type === item.type);
		if (unequippedItem) {
			unequippedItem.equipped = false;
			decreaseStats(this, unequippedItem.affectedStats);
		}
		this.equippedItems = this.equippedItems.filter((equippedItem) => equippedItem.type !== item.type);
		this.equippedItems.push(item);
		item.equipped = true;
		increaseStats(this, item.affectedStats);
		await this.updateActiveItemCollections();
	}

	async setItemUnequiped(item: Item){
		const itemArrayWithoutThisItem = this.equippedItems.filter((equippedItem) => equippedItem.itemId !== item.itemId);
		item.equipped = false;
		this.equippedItems = itemArrayWithoutThisItem;
		decreaseStats(this, item.affectedStats);
		await this.updateActiveItemCollections();
	}
}
