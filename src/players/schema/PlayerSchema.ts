import {ArraySchema, MapSchema, Schema, type} from '@colyseus/schema';
import {Talent} from '../../talents/schema/TalentSchema';
import {Item} from '../../items/schema/ItemSchema';
import {IStats} from '../../common/types';
import {TalentType} from '../../talents/types/TalentTypes';
import { CombatLogMessage, DamageMessage, DamageType, InvulnerableMessage, InvulnerableStateMessage } from '../../common/MessageTypes';
import {Client, Delayed, Clock as ClockTimer} from '@colyseus/core';
import {EquipSlot, ItemRarity} from "../../items/types/ItemTypes";
import {AffectedStats} from "../../common/schema/AffectedStatsSchema";
import {BURN_DURATION_MS} from "../../items/behavior/uniqueItemBalance";
import {FightStats} from "./FightStats";

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
    @type('number') gameVersion: number;
    @type('number') income: number = 0;
    @type('number') hpRegen: number = 0;
    @type([Talent]) talents: ArraySchema<Talent> = new ArraySchema<Talent>();
    @type([Item]) inventory: ArraySchema<Item> = new ArraySchema<Item>();
    @type([Item]) lockedShop: ArraySchema<Item> = new ArraySchema<Item>();
    @type({map: Item}) equippedItems = new MapSchema<Item>();
    @type('number') dodgeRate: number = 0;
    @type('number') refreshShopCost: number = 2;
    @type('number') maxHp: number = 0;
    @type('number') private _hp: number = 0;
    @type(AffectedStats) baseStats: AffectedStats = new AffectedStats();
    damage: number = 0;
    fightStats: FightStats = new FightStats();
    attackTimers: Map<string, Delayed> = new Map();
    poisonTimer: Delayed;
    burnTimer: Delayed;
    regenTimer: Delayed;
    invincibleTimer: Delayed;
    talentsOnCooldown: TalentType[] = [];
    attackSpeedMultiplier: number = 1;
    healingEffectiveness: number = 1;
    hasVersionWin: boolean = false;
    // Hidden shop-roll stat: seeded from level each draft aura tick (DraftAuraTriggerCommand),
    // doubled by Black Market Contact's aura behavior (TalentBehaviors). Read by
    // ShopUpgradeUtils.applyLuckyShopUpgrades. Resets to 0 every draft phase (new Player()).
    luckyFindChance: number = 0;
    // Hidden per-draft-phase flag: true once a lucky-find item has been claimed for free via
    // Black Market Contact (TalentBehaviors.markFreeLuckyFindConsumed).
    usedFreeLuckyFind: boolean = false;


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
        this._level = value < 1 ? 1 : value;
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

    // Declared after all other @type fields so existing field indices stay stable
    // (the frontend schema mirror relies on matching declaration order).
    @type('boolean') invincible: boolean = false;

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

    private _burnStack: number = 0;

    get burnStack(): number {
        return this._burnStack;
    }

    set burnStack(value: number) {
        if (value < 0) {
            this._burnStack = 0;
        } else if (value > 100) {
            this._burnStack = 100;
        } else {
            this._burnStack = value;
        }
    }

    clearAllAttackTimers() {
        this.attackTimers.forEach((timer) => timer.clear());
        this.attackTimers.clear();
    }

    setInvincible(clock: ClockTimer, invincibleLenghtMS: number, playerClient?: Client) {
        // State messages exist for the replay player, which has no schema sync.
        if (!this.invincible) {
            playerClient?.send('invulnerable_state', { playerId: this.playerId, invincible: true } as InvulnerableStateMessage);
        }
        this.invincible = true;
        const endInvincibility = () => {
            this.invincible = false;
            this.invincibleTimer = null;
            playerClient?.send('invulnerable_state', { playerId: this.playerId, invincible: false } as InvulnerableStateMessage);
        };
        if (this.invincibleTimer) {
            const timeLeft = this.invincibleTimer.time - this.invincibleTimer.elapsedTime;
            this.invincibleTimer.clear();
            this.invincibleTimer = clock.setTimeout(endInvincibility, timeLeft + invincibleLenghtMS);
            return;
        }
        this.invincibleTimer = clock.setTimeout(endInvincibility, invincibleLenghtMS);
    }

    heal(amount: number, poisonSource?: Player): number {
        if (amount <= 0) {
            this.hp += amount;
            return amount;
        }
        const healed = amount * this.healingEffectiveness;
        const hpBefore = this.hp;
        this.hp += healed;
        const prevented = amount - healed;
        if (prevented > 0 && poisonSource) {
            poisonSource.talents.forEach((t) => {
                if (t.talentId === TalentType.POISON || t.talentId === TalentType.ROGUE_3) {
                    t.statHealingPrevented += prevented;
                    t.totalHealingPrevented += prevented;
                }
            });
        }
        // Actual HP gained — the hp setter clamps at maxHp, so overheal must not
        // be reported as healing (it inflates healing stats and replay HP tracking).
        const gained = this.hp - hpBefore;
        if (gained > 0) this.fightStats.healingReceived += gained;
        return gained;
    }

    takeDamage(damage: number, playerClient: Client, damageType: DamageType = 'normal') {
        if (this.hp <= 0) return;
        if (damage <= 0) return;
        if (this.invincible) {
            playerClient.send('invulnerable', {
                playerId: this.playerId,
                damage: damage,
            } as InvulnerableMessage);
            playerClient.send('combat_log', { text: `${this.name} is invulnerable and takes no damage!`, kind: 'invulnerable', defenderId: this.playerId, damage: damage } as CombatLogMessage);
            return;
        }
        this.hp -= damage;
        this.fightStats.damageTaken[damageType] += damage;
        playerClient.send('damage', {
            playerId: this.playerId,
            damage: damage,
            type: damageType,
        } as DamageMessage);
    }

    getDamageAfterDefense(initialDamage: number): number {
        const afterPct = initialDamage * (100 / (100 + this.defense));
        const damage = afterPct - this.flatDmgReduction;
        if (initialDamage > 0 && !this.invincible) {
            this.fightStats.damageReducedByDefense += initialDamage - afterPct;
            this.fightStats.damageReducedByFlat += Math.min(this.flatDmgReduction, Math.max(afterPct, 0));
        }
        return damage > 0 ? damage : 0;
    }

    addPoisonStacks(clock: ClockTimer, playerClient: Client, stack: number = 1) {
        this.poisonStack += stack;
        playerClient.send('combat_log', { text: `${this.name} is poisoned! ${this.poisonStack} stacks!`, kind: 'poison_apply', defenderId: this.playerId, poisonStacks: this.poisonStack } as CombatLogMessage);

        clock.setTimeout(() => {
            this.poisonStack -= stack;
            if (this.poisonStack === 0 && this.poisonTimer) {
                this.poisonTimer.clear();
                this.poisonTimer = null;
            }
        }, 6000);
    }

    addBurnStacks(clock: ClockTimer, playerClient: Client, stack: number = 1) {
        this.burnStack += stack;
        playerClient.send('combat_log', { text: `${this.name} is burning! ${this.burnStack} stacks!`, kind: 'burn_apply', defenderId: this.playerId, burnStacks: this.burnStack } as CombatLogMessage);

        clock.setTimeout(() => {
            this.burnStack -= stack;
            if (this.burnStack === 0 && this.burnTimer) {
                this.burnTimer.clear();
                this.burnTimer = null;
            }
        }, BURN_DURATION_MS);
    }

    getItem(item: Item) {
        this.gold -= item.price;
        item.sold = true;
        const lockedIdx = this.lockedShop.indexOf(item);
        if (lockedIdx !== -1) this.lockedShop.splice(lockedIdx, 1);

        const ownedTarget = this.findUpgradeTarget(item.itemId);
        const isUpgrade = item.upgradePreview && ownedTarget && item.rarity > ownedTarget.rarity;
        item.upgradePreview = false;
        if (isUpgrade) {
            let equippedSlot: EquipSlot | null = null;
            this.equippedItems.forEach((value, key) => {
                if (value === ownedTarget) equippedSlot = key as EquipSlot;
            });
            if (equippedSlot !== null) {
                item.equipped = true;
                this.equippedItems.set(equippedSlot, item);
            } else {
                const invIdx = this.inventory.indexOf(ownedTarget);
                if (invIdx !== -1) this.inventory.splice(invIdx, 1);
                if (!this.tryAutoEquipIntoEmptySlot(item)) this.inventory.push(item);
            }
        } else {
            if (!this.tryAutoEquipIntoEmptySlot(item)) this.inventory.push(item);
        }
    }

    /** Auto-equip a freshly acquired piece of gear into the first EMPTY valid slot.
     *  Skips potions (the 'drink' pseudo-slot), and never displaces an
     *  already-equipped item. Returns true if it was equipped. */
    private tryAutoEquipIntoEmptySlot(item: Item): boolean {
        if (!item.equipOptions) return false;
        for (const slot of item.equipOptions) {
            if (slot === 'drink') continue;
            if (!this.equippedItems.get(slot as EquipSlot)) {
                this.setItemEquipped(item, slot as EquipSlot);
                return true;
            }
        }
        return false;
    }

    private findUpgradeTarget(itemId: number): Item | null {
        const candidates: Item[] = [];
        this.equippedItems.forEach((item) => {
            if (item.itemId === itemId && item.rarity < ItemRarity.MYTHIC) candidates.push(item);
        });
        this.inventory.forEach((item) => {
            if (item.itemId === itemId && item.rarity < ItemRarity.MYTHIC) candidates.push(item);
        });
        if (candidates.length === 0) return null;
        candidates.sort((a, b) => b.rarity - a.rarity);
        return candidates[0];
    }

    async sellItem(item: Item) {
        if (item.equipped) return;
        if (item.tags?.includes('quest')) return;
        this.gold += item.sellPrice;
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
        const invIdx = this.inventory.indexOf(item);
        if (invIdx !== -1) this.inventory.splice(invIdx, 1);

    }

    setItemUnequipped(item: Item, slot: EquipSlot) {
        item.equipped = false;
        this.inventory.push(item);
        this.equippedItems.delete(slot);
    }

    setLockedShop(itemArraySchema: ArraySchema<Item>) {
        this.lockedShop.clear();
        itemArraySchema.forEach(item => {
            if (!item.sold) this.lockedShop.push(item);
        });
    }

    unlockShop() {
        this.lockedShop.clear();
    }

    /**
     * Copy all fields from source into this player WITHOUT replacing ArraySchema/MapSchema instances.
     * Use this instead of assign(source) to avoid breaking client-side refId tracking.
     */
    copyFrom(source: Player) {
        // Primitive and nested Schema fields (safe to assign directly)
        const { inventory, talents, lockedShop, equippedItems, baseStats, ...primitives } = source.toJSON() as any;
        this.assign(primitives);
        this.baseStats.assign(baseStats || {});

        // In-place copy for collection fields
        this.inventory.clear();
        source.inventory.forEach(item => this.inventory.push(item));

        this.talents.clear();
        source.talents.forEach(t => this.talents.push(t));

        this.lockedShop.clear();
        source.lockedShop.forEach(item => this.lockedShop.push(item));

        this.equippedItems.clear();
        source.equippedItems.forEach((item, key) => this.equippedItems.set(key, item));
    }
}
