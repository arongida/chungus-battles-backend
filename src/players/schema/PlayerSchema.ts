import {ArraySchema, MapSchema, Schema, type} from '@colyseus/schema';
import {Talent} from '../../talents/schema/TalentSchema';
import {Item} from '../../items/schema/ItemSchema';
import {IStats} from '../../common/types';
import {TalentType} from '../../talents/types/TalentTypes';
import { CombatLogMessage, DamageMessage, DamageSource, DamageType, InvulnerableMessage, InvulnerableStateMessage, StunnedStateMessage } from '../../common/MessageTypes';
import {Client, Delayed, Clock as ClockTimer} from '@colyseus/core';
import {EquipSlot, ItemRarity} from "../../items/types/ItemTypes";
import {ItemSkillType} from "../../items/types/ItemSkillTypes";
import {ITEM_SKILLS, skillValues} from "../../items/behavior/itemSkillBalance";
import {AffectedStats} from "../../common/schema/AffectedStatsSchema";
import {BURN_DURATION_MS, selfBurnStacks} from "../../items/behavior/uniqueItemBalance";
import {POISON_DURATION_MS, POISON_TICK_INTERVAL_MS} from "../../common/poisonBalance";
import {FightStats} from "./FightStats";
import {weaponWhispererSnapshots} from "../../talents/behavior/weaponWhispererState";
import {addDotSource, creditHealingPrevented, DotSourceLedger, removeDotSource} from "../../common/dotSources";

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
    // Shield Bash (item skill): every currently-scheduled ACTIVE-trigger timer for this player
    // (talents and items alike), populated/rotated by ActiveTriggerCommand.scheduleActive as each
    // one reschedules itself. Kept per-player (not just the shared FightState.skillsTimers list,
    // which mixes both players and is only ever used for a blanket fight-end clear) so setStunned
    // can pause/resume exactly this player's active skills without touching the enemy's.
    activeSkillTimers: Set<Delayed> = new Set();
    stunTimer: Delayed;
    poisonTimer: Delayed;
    // Server-only — how far apart the current poisonTimer's ticks are (Festering Wounds can
    // halve this once the defender is at/above its stack threshold). Not @type-decorated,
    // same as poisonTimer/poisonStack.
    poisonTickIntervalMs: number = POISON_TICK_INTERVAL_MS;
    burnTimer: Delayed;
    // Which Talent applied each currently-live poison/burn stack, and how many — used to split a
    // DoT tick's damage proportionally by source instead of crediting it to a hard-coded talentId.
    // Stacks applied by items have no entry (their share simply goes uncredited). See dotSources.ts.
    poisonSources: DotSourceLedger = new Map();
    burnSources: DotSourceLedger = new Map();
    regenTimer: Delayed;
    invincibleTimer: Delayed;
    talentsOnCooldown: TalentType[] = [];
    attackSpeedMultiplier: number = 1;
    // VIP Pass (talent 202): reroll-cost surcharge accumulates directly into refreshShopCost
    // (like Comrade's +income), but the lucky-find bonus needs its own multiplier slot — mirrors
    // the seed-then-apply-last idiom Black Market Contact's x2 uses so it composes on top of VIP
    // Pass's flat +10% regardless of talent pick order. Re-seeded to 1 and applied last (after the
    // flat bonus) each draft aura tick — DraftAuraTriggerCommand only; both talents guard on `shop`
    // being present, so neither ever runs during FightAuraTriggerCommand.
    luckyFindChanceMultiplier: number = 1;
    // Bulk Discount (item skill): percent-off-price-per-percent-lucky-find rate, accumulated by
    // the item's AURA behavior (ItemSkillBehaviors.ts) during the same equipped-item pass that
    // Insider Trading writes luckyFindChance — equippedItems iteration order is arbitrary, so the
    // actual shop repricing can't happen inline in that same behavior. DraftAuraTriggerCommand
    // applies it afterward, once luckyFindChance has its final value for the tick (capped at
    // BULK_DISCOUNT_MAX_DISCOUNT_FRACTION). Re-seeded to 0 each tick.
    bulkDiscountPercentPerLuckPercent: number = 0;
    healingEffectiveness: number = 1;
    // Black Market Contact: true once the current shop's free lucky-find claim has been spent
    // (DraftRoom.buyItem), reset once per shop phase (DraftRoom.onJoin) — same reset timing as
    // misconductClaimUsed, not per shop build like comradeClaimUsed.
    luckyFindClaimUsed: boolean = false;
    // Unstoppable Force (WARRIOR_3) and Crushing Blow (item skill): the Talent or Item that
    // charged the owner's next weapon attack, for one weapon attack after the charge fires.
    // Consumed in FightRoom.tryWeaponAttack (skips dodge, applies the empowered bonus) and used
    // there to credit the bonus damage to its source — branches on `instanceof Item` there.
    empoweredAttackSource: Talent | Item = null;
    // Brace (shield skill): the Item that fully blocks the next incoming weapon hit, set during
    // that hit's ON_ATTACKED pass. Consumed in FightRoom.tryWeaponAttack — same one-shot-flag idiom
    // as empoweredAttackSource above, so it can't accumulate the way a duration-based invulnerability
    // window would at high attack speed. Cleared per-fight in FightRoom.startBattle.
    pendingBlockSource: Item = null;
    // Zealot (talent 28, reworked): set true by Zealot's aura behavior every ~1s it's owned
    // (talents are never un-picked, so this never needs to reset back to false). Clamped in
    // recalculatePlayerStats (statsUtils.ts), which zeroes dodgeRate after computing it whenever
    // this is set — after every equipped item/talent has already contributed to the snapshot.
    dodgeDisabled: boolean = false;
    // Smoke Bomb (item skill): while true, this player's own attacks deal no damage (see
    // FightRoom.tryWeaponAttack). Not synced — the effect is visible through the paired dodgeRate
    // spike (item.skillAffectedStats) and combat log lines instead.
    damageDisabled: boolean = false;
    vanishTimer: Delayed;
    // Comrade: true once the current shop's free-item claim has been spent (DraftRoom.buyItem),
    // reset per shop build (DraftRoom.updateShop). Stops the aura from re-granting a fresh claim
    // every tick after one has been used.
    comradeClaimUsed: boolean = false;
    // Gold Genie: reset once per shop phase (DraftRoom.onJoin) — same reset timing as
    // misconductClaimUsed, scoped to the first merchant-class item bought each round.
    goldGenieClaimUsed: boolean = false;
    // Misconduct: unlike comradeClaimUsed, reset once per shop phase (DraftRoom.onJoin) rather
    // than per shop build, so the claim doesn't refresh on manual shop refresh. The free item
    // claimed this way also gets the rarity-upgrade steal treatment (see ShopUpgradeUtils.
    // stealShopItem / DraftRoom.buyItem).
    misconductClaimUsed: boolean = false;
    // Store Credit (item skill): one free item per shop PHASE, not per shop build — same
    // per-phase reset reasoning as freeRerollChargesUsed below (DraftRoom.onJoin), unlike
    // comradeClaimUsed which refreshes on every reroll.
    storeCreditClaimUsed: boolean = false;
    // Free shop rerolls (Haggler item skill + Bargain Hunter talent): how many of this shop-phase's
    // free rerolls have already been spent (DraftRoom.refreshShop). Reset once per shop PHASE
    // (DraftRoom.onJoin), not per shop build — a paid/free reroll rebuilds the shop itself, so
    // resetting it there would refund the reroll that just consumed it. Same reasoning as
    // misconductClaimUsed.
    freeRerollChargesUsed: number = 0;
    // Free shop rerolls: accumulator for the current tick's grant, summed across every source
    // (Bargain Hunter's talent aura, the Haggler item skill) before freeRerollCharges is derived
    // from it in DraftAuraTriggerCommand's post-pass — same "seed, accumulate, finalize" idiom as
    // refreshShopCostMultiplier used to be. Re-seeded to 0 each aura tick.
    freeRerollGrant: number = 0;
    // Locked-in next-fight opponent (Next-Enemy Preview feature). Server-only: never add to
    // playerToPlainObject/snapshotPlayer (would smear a stale pointer into matchmaking
    // snapshots). Persisted via the targeted setNextFightEnemy() $set instead. Not @type —
    // copyFrom() round-trips toJSON(), so these deliberately do NOT survive into
    // FightRoom.state.player; FightRoom.pickEnemy reads them from the freshly loaded
    // getPlayer() result instead (see FightRoom.onJoin).
    nextFightEnemyId: number;
    nextFightEnemyRound: number;
    // Recently fought opponents (originalPlayerIds, oldest → newest, capped at
    // RECENT_OPPONENT_MEMORY) — used by getSameRoundPlayer to avoid repeat matchmaking. Same
    // server-only treatment as nextFightEnemyId/Round above: not @type, not in
    // playerToPlainObject/snapshotPlayer, persisted via setNextFightEnemy's targeted $push/$slice.
    recentOpponentIds: number[];
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
    // lucky-find shop items (see TalentBehaviors.ts BLACK MARKET CONTRACT).
    @type('boolean') luckyFindFreeClaim: boolean = false;
    // Misconduct: same latch as comradeFreeClaim (any unsold shop item), but only one claim per
    // shop phase — see misconductClaimUsed. The claimed item also gets a rarity upgrade +
    // full-price sell value (see TalentBehaviors.ts MISCONDUCT).
    @type('boolean') misconductFreeClaim: boolean = false;
    // Deprecated — Health Flask brews now bank into pendingPotionEffects (see below), which
    // replaces this single hard-coded regen buff with any of several rolled effects. Kept
    // declared (unread, unwritten) purely so every @type field after it keeps its existing
    // Colyseus index — the frontend schema mirror relies on matching declaration order.
    @type('number') pendingRegenBuff: number = 0;
    // Hidden shop-roll stat: seeded from level every aura tick in both the draft
    // (DraftAuraTriggerCommand) and the fight (FightAuraTriggerCommand), doubled by Black Market
    // Contact's aura behavior (TalentBehaviors, same tick as the seed so it composes instead of
    // getting clobbered). Read by ShopUpgradeUtils.applyLuckyShopUpgrades. Synced (unlike most
    // other hidden stats) so the client can display it next to gold/income.
    // Declared here (end of the @type block) so existing field indices stay stable.
    @type('number') luckyFindChance: number = 0;
    // Permanent snowball bonus to luckyFindChance: +ShopUpgradeUtils.LUCKY_FIND_MYTHIC_BONUS
    // every time the player buys an item
    // (or an upgrade-preview buy) that lands on ItemRarity.MYTHIC (DraftRoom.buyItem). Folded
    // into the luckyFindChance seed every aura tick (DraftAuraTriggerCommand/FightAuraTriggerCommand)
    // and at draft setup (DraftRoom.setUpState) so it survives — unlike luckyFindChance itself,
    // which is a hidden derived stat re-seeded from scratch each tick, this persists for the
    // whole run (see Player Copy Mechanism in CLAUDE.md — mirrors pendingRegenBuff's pattern).
    @type('number') luckyFindMythicBonus: number = 0;
    // Store Credit (item skill): same latch as comradeFreeClaim, but the client only honors it on
    // shop items priced at or below storeCreditFreeClaimCap (see ItemSkillBehaviors.ts
    // STORE_CREDIT). Declared here (end of the @type block) so existing field indices stay stable.
    @type('boolean') storeCreditFreeClaim: boolean = false;
    @type('number') storeCreditFreeClaimCap: number = 0;
    // Free shop rerolls (Haggler item skill + Bargain Hunter talent): remaining free rerolls for
    // the current shop phase — derived as max(0, freeRerollGrant - freeRerollChargesUsed) each aura
    // tick, after every grant source has run (see DraftAuraTriggerCommand). Consumed in
    // DraftRoom.refreshShop.
    @type('number') freeRerollCharges: number = 0;
    // Fortune's Fool (talent 403): how many times the shop has been rerolled this shop phase.
    // Synced so the client can preview the HP penalty; reset per shop phase (DraftRoom.onJoin),
    // incremented in DraftRoom.refreshShop, read at FIGHT_START to size the HP loss.
    @type('number') rerollsThisRound: number = 0;
    // Fortune's Fool (talent 403, aura): true while owned — makes DraftRoom.refreshShop free
    // (no gold cost, doesn't consume a free-reroll charge). Re-seeded to false each aura tick
    // (see DraftAuraTriggerCommand) so it can't survive dropping/replacing the talent.
    @type('boolean') freeRerolls: boolean = false;
    // Cooldown reduction: shortens active-skill intervals (see common/cooldown.ts and
    // commands/triggers/ActiveTriggerCommand.ts). Recomputed from scratch every tick by
    // statsUtils.recalculatePlayerStats, same as every other synced derived stat. Declared here
    // (end of the @type block) so existing field indices stay stable — see the comment at the
    // top of this @type block.
    @type('number') cooldownReduction: number = 0;
    // Shield Bash (item skill): true while stunned — see setStunned. Synced so the client can
    // render a stun aura (mirrors `invincible` above). Declared here (end of the @type block) so
    // existing field indices stay stable.
    @type('boolean') stunned: boolean = false;
    // Health Flask brews (see items/skills/itemSkillRoller.ts's ensurePotionEffect and
    // items/types/ItemSkillTypes.ts's REGENERATION..SALVE range) banked in the draft by
    // DraftRoom.drinkItem, one skillId per flask drunk — capped at potionCapacity entries (see
    // below). Stat brews (Regeneration/Evasion/Stoneskin/Fortitude) fold into hpRegen/dodgeRate/
    // defense/maxHp every tick in statsUtils.recalculatePlayerStats, same as pendingRegenBuff used
    // to; Antidote/Salve are read by getPoisonDamageMultiplier/getBurnDamageMultiplier below;
    // Liquid Courage is applied directly in FightRoom.startBattle. Cleared (win, lose or draw) in
    // FightRoom.handleFightEnd — same "spent the moment this fight concludes" contract
    // pendingRegenBuff had. Must stay @type (not a plain field) — same reasoning as `losses`
    // above: copyFrom() round-trips through toJSON().
    @type(['number']) pendingPotionEffects: ArraySchema<number> = new ArraySchema<number>();
    // Comma-joined brew names for pendingPotionEffects, rebuilt by DraftRoom.drinkItem every time
    // the array changes — cheap to keep the frontend from needing the item-skill name table just
    // to render "Brewing: Antidote, Stoneskin".
    @type('string') pendingPotionSummary: string = '';
    // How many potions pendingPotionEffects may hold at once — enforced in DraftRoom.drinkItem.
    // Hidden/derived stat, same treatment as luckyFindChance/refreshShopCost: NOT persisted to
    // Mongo, re-seeded to BASE_POTION_CAPACITY every draft aura tick before aura talents run
    // (DraftAuraTriggerCommand), then Flash Sale (MERCHANT_1) adds to it while owned.
    @type('number') potionCapacity: number = 1;

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

    /** Soulstealer's Scythe: shatters an active invulnerability window outright (however it was
     *  raised — Aegis, Band of Vigor, Guardian Angel, ...) instead of letting takeDamage's
     *  `this.invincible` check silently absorb the hit. No-op when not currently invincible. */
    breakInvincibility(playerClient?: Client) {
        if (!this.invincible) return;
        this.invincible = false;
        this.invincibleTimer?.clear();
        this.invincibleTimer = null;
        playerClient?.send('invulnerable_state', { playerId: this.playerId, invincible: false } as InvulnerableStateMessage);
    }

    /** Smoke Bomb (item skill): mirrors setInvincible above — re-calling extends the window
     *  rather than stacking, so two Smoke Bomb sources (e.g. rolled on both armor and helmet)
     *  triggering in the same aura tick don't fight over which one clears damageDisabled first. */
    setVanished(clock: ClockTimer, durationMs: number) {
        this.damageDisabled = true;
        const endVanish = () => {
            this.damageDisabled = false;
            this.vanishTimer = null;
        };
        if (this.vanishTimer) {
            const timeLeft = this.vanishTimer.time - this.vanishTimer.elapsedTime;
            this.vanishTimer.clear();
            this.vanishTimer = clock.setTimeout(endVanish, timeLeft + durationMs);
            return;
        }
        this.vanishTimer = clock.setTimeout(endVanish, durationMs);
    }

    /** Shield Bash (item skill): pauses this player's attack timers, regen timer, and active-skill
     *  timers, and forces dodgeRate to 0 (see statsUtils.recalculatePlayerStats) for the duration.
     *  A paused weapon-attack timer never fires and never reschedules — FightRoom.startSingleWeaponTimer
     *  clears+recreates its timer after every swing, so pausing simply holds the countdown in place
     *  rather than losing progress toward the next swing. Mirrors setInvincible: re-calling extends
     *  the window rather than restacking a fresh pause on top of an already-paused timer. */
    setStunned(clock: ClockTimer, durationMs: number, playerClient?: Client) {
        if (!this.stunned) {
            this.attackTimers.forEach((timer) => timer.pause());
            this.regenTimer?.pause();
            this.activeSkillTimers.forEach((timer) => timer.pause());
            playerClient?.send('stunned_state', { playerId: this.playerId, stunned: true } as StunnedStateMessage);
        }
        this.stunned = true;
        const endStun = () => {
            this.stunned = false;
            this.stunTimer = null;
            this.attackTimers.forEach((timer) => timer.resume());
            this.regenTimer?.resume();
            this.activeSkillTimers.forEach((timer) => timer.resume());
            playerClient?.send('stunned_state', { playerId: this.playerId, stunned: false } as StunnedStateMessage);
        };
        if (this.stunTimer) {
            const timeLeft = this.stunTimer.time - this.stunTimer.elapsedTime;
            this.stunTimer.clear();
            this.stunTimer = clock.setTimeout(endStun, timeLeft + durationMs);
            return;
        }
        this.stunTimer = clock.setTimeout(endStun, durationMs);
    }

    /** Consumes and returns the pending Brace block, if any. One-shot: the weapon swing that reads
     *  it also clears it, so a proc can never outlive the single hit it was meant to negate. */
    consumePendingBlock(): Item | null {
        const source = this.pendingBlockSource;
        this.pendingBlockSource = null;
        return source;
    }

    heal(amount: number): number {
        if (amount <= 0) {
            this.hp += amount;
            return amount;
        }
        const healed = amount * this.healingEffectiveness;
        const hpBefore = this.hp;
        this.hp += healed;
        const prevented = amount - healed;
        // Credited against THIS player's own poison stacks (whatever reduced healingEffectiveness),
        // split proportionally across whichever talents applied them. See dotSources.ts.
        if (prevented > 0) creditHealingPrevented(this.poisonSources, this.poisonStack, prevented);
        // Actual HP gained — the hp setter clamps at maxHp, so overheal must not
        // be reported as healing (it inflates healing stats and replay HP tracking).
        const gained = this.hp - hpBefore;
        if (gained > 0) this.fightStats.healingReceived += gained;
        return gained;
    }

    takeDamage(damage: number, playerClient: Client, damageType: DamageType = 'normal', source: DamageSource = 'weapon') {
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
        // damageType drives client-facing rendering; source is attribution-only and only
        // matters when damageType is 'normal' (poison/burn ticks are never a 'skill'/'self').
        const bucket = damageType === 'normal' ? source : damageType;
        this.fightStats.damageTaken[bucket] += damage;
        playerClient.send('damage', {
            playerId: this.playerId,
            damage: damage,
            type: damageType,
        } as DamageMessage);
    }

    // defenseMultiplier scales the effective defense used for this hit only — e.g. Stab passes
    // 0.5 to ignore half the defender's defense. Defaults to 1 (no change) for every other caller.
    getDamageAfterDefense(initialDamage: number, defenseMultiplier: number = 1): number {
        const effectiveDefense = this.defense * defenseMultiplier;
        const afterPct = initialDamage * (100 / (100 + effectiveDefense));
        if (initialDamage > 0 && !this.invincible) {
            this.fightStats.damageReducedByDefense += initialDamage - afterPct;
        }
        return afterPct > 0 ? afterPct : 0;
    }

    /** Chance this player dodges an incoming weapon attack. */
    getDodgeChance(): number {
        return 1 - 100 / (100 + this.dodgeRate);
    }

    /** Antidote (Health Flask brew): fraction by which this player's poison tick damage is
     *  multiplied while banked this draft phase, spent by the wearer's next fight (see
     *  pendingPotionEffects above). A reduction, not an immunity — stacks still apply normally
     *  (addPoisonStacks below is untouched); only the tick damage computed in FightRoom.ts's
     *  startPoisonTimer reads this. */
    getPoisonDamageMultiplier(): number {
        if (!this.pendingPotionEffects.includes(ItemSkillType.ANTIDOTE)) return 1;
        return 1 - skillValues(ITEM_SKILLS[ItemSkillType.ANTIDOTE], ItemRarity.COMMON).resistFraction;
    }

    /** Salve (Health Flask brew): same shape as getPoisonDamageMultiplier above, for burn tick
     *  damage (FightRoom.ts's checkBurn). Also softens this player's own self-burn tax
     *  (igniteEnemy), since that's just another addBurnStacks call on the same player. */
    getBurnDamageMultiplier(): number {
        if (!this.pendingPotionEffects.includes(ItemSkillType.SALVE)) return 1;
        return 1 - skillValues(ITEM_SKILLS[ItemSkillType.SALVE], ItemRarity.COMMON).resistFraction;
    }

    addPoisonStacks(clock: ClockTimer, playerClient: Client, stack: number = 1, source?: Talent) {
        this.poisonStack += stack;
        addDotSource(this.poisonSources, source, stack);
        playerClient.send('combat_log', { text: `${this.name} is poisoned! ${this.poisonStack} stacks!`, kind: 'poison_apply', defenderId: this.playerId, poisonStacks: this.poisonStack } as CombatLogMessage);

        clock.setTimeout(() => {
            this.poisonStack -= stack;
            removeDotSource(this.poisonSources, source, stack);
            if (this.poisonStack === 0 && this.poisonTimer) {
                this.poisonTimer.clear();
                this.poisonTimer = null;
                this.poisonTickIntervalMs = POISON_TICK_INTERVAL_MS;
            }
        }, POISON_DURATION_MS);
    }

    addBurnStacks(clock: ClockTimer, playerClient: Client, stack: number = 1, source?: Talent) {
        this.burnStack += stack;
        addDotSource(this.burnSources, source, stack);
        playerClient.send('combat_log', { text: `${this.name} is burning! ${this.burnStack} stacks!`, kind: 'burn_apply', defenderId: this.playerId, burnStacks: this.burnStack } as CombatLogMessage);

        clock.setTimeout(() => {
            // Fire with Fire (31) may have already consumed some of this fight's burn stacks
            // via consumeBurnStacks() before this timeout fires. burnConsumedDebt tracks how
            // many stacks were consumed "early" so this removal absorbs from that debt first,
            // instead of decrementing stacks that were applied (and are still owed their full
            // duration) after the consume happened.
            const absorbed = Math.min(this.burnConsumedDebt, stack);
            this.burnConsumedDebt -= absorbed;
            this.burnStack -= (stack - absorbed);
            removeDotSource(this.burnSources, source, stack);
            if (this.burnStack === 0 && this.burnTimer) {
                this.burnTimer.clear();
                this.burnTimer = null;
            }
        }, BURN_DURATION_MS);
    }

    /** Stacks already removed by consumeBurnStacks() whose originating addBurnStacks() expiry
     *  timeout is still pending. See addBurnStacks' timeout body for how it's absorbed. */
    private burnConsumedDebt: number = 0;

    /** Applies burn to `target` and singes the applier (`this`) for the systemic self-burn tax
     *  (selfBurnStacks, a third as many rounded up) — the burn line's downside. Every burn source should go through here;
     *  the sole exception is Hidden Vials (24), the tier-5 dodge payoff, which calls
     *  addBurnStacks directly and stays clean. Self-burn is applied with no source Talent: it
     *  must not be credited to the applier's own statDamageDealt (that stat means damage dealt
     *  to the enemy), so it goes uncredited via the dotSources ledger by design. */
    igniteEnemy(clock: ClockTimer, playerClient: Client, target: Player, stacks: number, source?: Talent) {
        if (stacks <= 0) return;
        target.addBurnStacks(clock, playerClient, stacks, source);
        this.addBurnStacks(clock, playerClient, selfBurnStacks(stacks));
    }

    /** Removes up to `max` live burn stacks and returns how many were actually removed.
     *  Used by Fire with Fire (31) to convert accumulated burn into healing. See
     *  burnConsumedDebt for how this interacts with the pending expiry timeouts. */
    consumeBurnStacks(max: number): number {
        const consumed = Math.min(max, this.burnStack);
        if (consumed <= 0) return 0;
        this.burnStack -= consumed;
        this.burnConsumedDebt += consumed;
        // burnSources is deliberately NOT reduced here: the pending timeouts still remove
        // exactly what they added, keeping the ledger self-consistent. dotSources.denom()
        // already tolerates a ledger total exceeding the live stack count.
        if (this.burnStack === 0) {
            this.burnTimer?.clear();
            this.burnTimer = null;
        }
        return consumed;
    }

    /** Resets the consumption-debt counter between fights (see burnConsumedDebt above). Call
     *  alongside the other burn/poison per-fight resets in FightRoom. */
    resetBurnConsumedDebt() {
        this.burnConsumedDebt = 0;
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
     *  already-equipped item. Returns true if it was equipped. Public so talent behaviors that
     *  grant items outside the normal buy flow (e.g. Martial Artist's free weapon) can reuse it. */
    tryAutoEquipIntoEmptySlot(item: Item): boolean {
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
            if (item.itemId === itemId && item.rarity < ItemRarity.MYTHIC && !item.tags?.includes('dual_wield_copy')) candidates.push(item);
        });
        this.inventory.forEach((item) => {
            if (item.itemId === itemId && item.rarity < ItemRarity.MYTHIC) candidates.push(item);
        });
        if (candidates.length === 0) return null;
        candidates.sort((a, b) => b.rarity - a.rarity);
        return candidates[0];
    }

    /** Returns true if the item was actually sold (false for equipped/quest items, which no-op). */
    async sellItem(item: Item): Promise<boolean> {
        if (item.equipped) return false;
        if (item.tags?.includes('quest')) return false;
        this.gold += item.sellPrice;
        const indexOfDeletedItem = this.inventory.indexOf(item);
        this.inventory.splice(indexOfDeletedItem, 1);
        return true;
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
            // Revert a skill this weapon only gained via the forced Mythic upgrade — snap was
            // cloned before applyRarityUpgrade's skill-grant hook ran, so it correctly holds
            // whatever skillId (possibly none) the weapon had beforehand.
            item.skillId = snap.skillId;
            item.skillName = snap.skillName;
            item.skillDescription = snap.skillDescription;
            // Second skill slot — only ever granted by Weapon Whisperer itself, so it reverts
            // right alongside the Mythic upgrade and slot 1.
            item.skillId2 = snap.skillId2;
            item.skillName2 = snap.skillName2;
            item.skillDescription2 = snap.skillDescription2;
            weaponWhispererSnapshots.delete(item);
        }
        item.equipped = false;
        // Live skill status line (itemSkillStatus.ts) only ever describes an EQUIPPED item — clear
        // it immediately so the inventory card doesn't keep showing the last fight's/tick's number
        // until the next UpdateStatsCommand tick catches up.
        item.skillStatus = '';
        item.skillStatus2 = '';
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
