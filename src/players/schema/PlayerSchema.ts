import {ArraySchema, MapSchema, Schema, type} from '@colyseus/schema';
import {Talent} from '../../talents/schema/TalentSchema';
import {Item} from '../../items/schema/ItemSchema';
import {IStats} from '../../common/types';
import {TalentType} from '../../talents/types/TalentTypes';
import {Client, Delayed} from 'colyseus';
import ClockTimer from '@gamestdio/timer';
import {EquipSlot} from "../../items/types/ItemTypes";
import {AffectedStats} from "../../common/schema/AffectedStatsSchema";

export class Player extends Schema implements IStats {
    @type('number') playerId: number;
    @type('number') originalPlayerId: number;
    @type('string') name: string;
    @type('number') xp: number;
    @type('string') sessionId: string;
    @type('number') flatDmgReduction: number = 0;
    @type('number') maxXp: number;
    @type('number') round: number;
    @type('number') lives: number;
    @type('number') wins: number;
    @type('string') avatarUrl: string;
    @type('number') income: number = 0;
    @type('number') hpRegen: number = 0;
    @type([Talent]) talents: ArraySchema<Talent> = new ArraySchema<Talent>();
    @type([Item]) inventory: ArraySchema<Item> = new ArraySchema<Item>();
    @type({map: Item}) equippedItems = new MapSchema<Item>();
    @type('number') dodgeRate: number = 0;
    @type('number') refreshShopCost: number = 2;
    @type('number') maxHp: number = 0;
    @type('number') private _hp: number = 0;
    @type(AffectedStats) baseStats: AffectedStats = new AffectedStats();
    damage: number = 0;
    attackTimer: Delayed;
    poisonTimer: Delayed;
    regenTimer: Delayed;
    invincibleTimer: Delayed;
    talentsOnCooldown: TalentType[] = [];
    invincible: boolean = false;
    rewardRound: number;


    get hp(): number {
        return this._hp;
    }

    set hp(value: number) {
        this._hp = value > this.maxHp ? this.maxHp : value;
    }

    @type('number') private _accuracy: number = 0;

    get accuracy(): number {
        return this._accuracy;
    }

    set accuracy(value: number) {
        this._accuracy = value < 1 ? 1 : value >= this._strength ? this._strength : value;
    }

    @type('number') private _strength: number = 0;

    get strength(): number {
        return this._strength;
    }

    set strength(value: number) {
        this._strength = value < 1 ? 1 : value <= this._accuracy ? this._accuracy : value;
    }

    @type('number') private _gold: number;

    get gold(): number {
        return this._gold;
    }

    set gold(value: number) {
        this._gold = value < 0 ? 0 : value;
    }

    @type('number') private _level: number;

    get level(): number {
        return this._level;
    }

    set level(value: number) {
        this._level = value > 5 ? 5 : value;
    }

    @type('number') private _defense: number = 0;

    get defense(): number {
        return this._defense;
    }

    set defense(value: number) {
        this._defense = value < 0 ? 0 : value;
    }

    @type('number') private _attackSpeed: number = 0;

    get attackSpeed(): number {
        return this._attackSpeed;
    }

    set attackSpeed(value: number) {
        this._attackSpeed = value < 0.1 ? 0.1 : value;
    }

    private _poisonStack: number = 0;

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
        if (this.hp <= 0) return;
        if (this.hp - damage <= 0) console.log('player died from damage', damage);
        this.hp -= damage;
        playerClient.send('damage', {
            playerId: this.playerId,
            damage: damage,
        });
    }

    getDamageAfterDefense(initialDamage: number): number {
        return (initialDamage * (100 / (100 + this.defense))) - this.flatDmgReduction;
    }

    addPoisonStacks(clock: ClockTimer, playerClient: Client, stack: number = 1) {
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

    getItem(item: Item) {
        this.gold -= item.price;
        item.sold = true;
        this.inventory.push(item);
    }

    async sellItem(item: Item) {
        if (item.equipped) return;
        this.gold += Math.floor(item.price * 0.7);
        const indexOfDeletedItem = this.inventory.indexOf(item);
        this.inventory.splice(indexOfDeletedItem, 1);
    }

    setItemEquipped(item: Item, slot: EquipSlot) {
        const itemToUnequip = this.equippedItems.get(slot);

        if (itemToUnequip) {
            itemToUnequip.equipped = false;
            this.inventory.push(itemToUnequip);
        }

        item.equipped = true;
        this.equippedItems.set(slot, item);
        this.inventory = this.inventory.filter((filterItem) => filterItem !== item)

    }

    setItemUnequipped(item: Item, slot: EquipSlot) {
        item.equipped = false;
        item.setActive = false;
        this.inventory.push(item);
        this.equippedItems.delete(slot);
    }
}
