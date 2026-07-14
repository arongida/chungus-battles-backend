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
import {weaponWhispererSnapshots} from "../../talents/behavior/weaponWhispererState";

export class Player extends Schema implements IStats {
    @type('number') playerId: number;
    @type('number') originalPlayerId: number;
    @type('string') name: string;
    @type('number') xp: number;
    @type('string') sessionId: string;
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
    // Hidden shop-roll stat: seeded from level each draft aura tick (DraftAuraTriggerCommand),
    // doubled by Black Market Contact's aura behavior (TalentBehaviors). Read by
    // ShopUpgradeUtils.applyLuckyShopUpgrades. Resets to 0 every draft phase (new Player()).
    luckyFindChance: number = 0;
    // Black Market Contact: true once the current shop's free lucky-find claim has been spent
    // (DraftRoom.buyItem), reset per shop build (DraftRoom.updateShop). Same latch pattern as
    // comradeClaimUsed.
    luckyFindClaimUsed: boolean = false;
    // Unstoppable Force (WARRIOR_3): true for one weapon attack after the talent's ACTIVE tick
    // fires. Consumed in FightRoom.tryWeaponAttack (skips dodge, doubles damage).
    empoweredNextAttack: boolean = false;
    // Comrade: true once the current shop's free-item claim has been spent (DraftRoom.buyItem),
    // reset per shop build (DraftRoom.updateShop). Stops the aura from re-granting a fresh claim
    // every tick after one has been used.
    comradeClaimUsed: boolean = false;
    // Gold Genie: same latch pattern as comradeClaimUsed, but scoped to the first merchant-class
    // item bought each shop.
    goldGenieClaimUsed: boolean = false;
    // Locked-in next-fight opponent (Next-Enemy Preview feature). Server-only: never add to
    // playerToPlainObject/snapshotPlayer (would smear a stale pointer into matchmaking
    // snapshots). Persisted via the targeted setNextFightEnemy() $set instead. Not @type —
    // copyFrom() round-trips toJSON(), so these deliberately do NOT survive into
    // FightRoom.state.player; FightRoom.pickEnemy reads them from the freshly loaded
    // getPlayer() result instead (see FightRoom.onJoin).
    nextFightEnemyId: number;
    nextFightEnemyRound: number;
    // "Runs ended" leaderboard stat. Persisted ONLY via Player.ts's incrementRunsEnded ($inc on
    // the killer's original doc) + read back via the leaderboard's $max aggregation. Deliberately
    // NOT @type and NOT in playerToPlainObject — it must never round-trip through live room state
    // or a live save, or a concurrent updatePlayer() from the killer's own session could clobber it.
    runsEnded: number = 0;
    // This character's nemesis — the enemy that dealt their final game-over hit. Set directly on
    // state.player in FightRoom.handleLoose (not via copyFrom, so @type isn't needed) and
    // persisted once via the normal onLeave -> updatePlayer save.
    killedByPlayerId: number;
    killedByOriginalPlayerId: number;
    killedByName: string;


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
    // Must stay @type (not a plain field) — Player.copyFrom round-trips through
    // toJSON(), so a plain field would not survive the draft/fight room transition.
    @type('number') losses: number = 0;
    // Comrade: true while a free-item claim is available for the current shop (aura-driven; see
    // TalentBehaviors.ts). Synced so the client can present ANY shop item as claimable-free,
    // including ones the player can't otherwise afford.
    @type('boolean') comradeFreeClaim: boolean = false;
    // Gold Genie: same latch as comradeFreeClaim, but the client only honors it on merchant-class
    // shop items (see TalentBehaviors.ts GOLD_GENIE).
    @type('boolean') goldGenieFreeClaim: boolean = false;
    // Black Market Contact: same latch as comradeFreeClaim, but the client only honors it on
    // lucky-find shop items (see TalentBehaviors.ts MERCHANT_5B).
    @type('boolean') luckyFindFreeClaim: boolean = false;
    // Health Flask (itemId 6): hpRegen bonus banked in the draft, consumed by the wearer's very
    // next fight. Folded into hpRegen every tick by statsUtils.recalculatePlayerStats and zeroed
    // out in FightRoom.handleFightEnd once that fight concludes. Must stay @type (not a plain
    // field) — same reasoning as `losses` above: copyFrom() round-trips through toJSON(), so a
    // plain field would silently reset to 0 the moment FightRoom.onJoin loads the player.
    @type('number') pendingRegenBuff: number = 0;

    private _poisonStack: number = 0;

    get poisonStack(): number {
        return this._poisonStack;
    }

    set poisonStack(value: number) {
        if (value < 0) {
            this._poisonStack = 0;
        } else if (value > 1000) {
            this._poisonStack = 1000;
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
        } else if (value > 1000) {
            this._burnStack = 1000;
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
                if (t.talentId === TalentType.POISON || t.talentId === TalentType.POISON_2) {
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
            this.fightStats.damageBlockedByInvincible += damage;
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
        if (initialDamage > 0 && !this.invincible) {
            this.fightStats.damageReducedByDefense += initialDamage - afterPct;
        }
        return afterPct > 0 ? afterPct : 0;
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
            // Routed through setItemUnequipped (not inlined) so displacing an item this way
            // reverts any Weapon Whisperer snapshot the same as an explicit unequip does.
            this.setItemUnequipped(itemToUnequip, slot);
        }

        item.equipped = true;
        this.equippedItems.set(slot, item);
        const invIdx = this.inventory.indexOf(item);
        if (invIdx !== -1) this.inventory.splice(invIdx, 1);

    }

    setItemUnequipped(item: Item, slot: EquipSlot) {
        // Weapon Whisperer's Mythic upgrade only applies while the weapon occupies MAIN_HAND —
        // revert it to its pre-upgrade state the moment it leaves, so cycling weapons through
        // that slot can't permanently bank multiple Mythics.
        const snap = weaponWhispererSnapshots.get(item);
        if (snap) {
            item.rarity = snap.rarity;
            item.affectedStats = snap.affectedStats;
            item.baseMinDamage = snap.baseMinDamage;
            item.baseMaxDamage = snap.baseMaxDamage;
            item.baseAttackSpeed = snap.baseAttackSpeed;
            item.description = snap.description;
            weaponWhispererSnapshots.delete(item);
        }
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
