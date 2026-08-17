import { Client, Room } from '@colyseus/core';
import { DraftState } from './schema/DraftState';
import { buildJoe, copyPlayer, createNewPlayer, getPlayer, getSameRoundPlayer, JOE_PLAYER_ID, setNextFightEnemy, updatePlayer } from '../players/db/Player';
import { buildEnemyPreview, EnemyRevealLevel, extractItemClasses, extractTalentClasses } from '../players/EnemyPreview';
import { getNumberOfItems, getQuestItems, getItemById, cloneItem } from '../items/db/Item';
import { rollItemStats } from '../items/stats/itemStatRoller';
import { applyExtraRaritySteps, applyLuckyShopUpgrades, applyRarityUpgrade, baseLuckyFindChance, BASE_REFRESH_SHOP_COST, findOwnedUpgradeTarget, getOwnedUpgradeableItemIds, grantLuckyFindMythicBonus, hasVipPass, LUCKY_FIND_MYTHIC_BONUS_PERCENT, stealShopItem } from '../commands/ShopUpgradeUtils';
import { ensureShieldSkill, refreshFutureItemSkill } from '../items/skills/itemSkillRoller';
import { Player } from '../players/schema/PlayerSchema';
import { Item } from '../items/schema/ItemSchema';
import { delay } from '../common/utils';
import { getRandomTalents } from '../talents/db/Talent';
import { Dispatcher } from '@colyseus/command';
import { ShopStartTriggerCommand } from '../commands/triggers/ShopStartTriggerCommand';
import { LevelUpTriggerCommand } from '../commands/triggers/LevelUpTriggerCommand';
import { AfterShopRefreshTriggerCommand } from '../commands/triggers/AfterShopRefreshTriggerCommand';
import { DraftAuraTriggerCommand } from '../commands/triggers/DraftAuraTriggerCommand';
import { OnSellTriggerCommand } from '../commands/triggers/OnSellTriggerCommand';
import { EquipSlot, ItemClass, ItemRarity } from "../items/types/ItemTypes";
import { UpdateStatsCommand } from "../commands/UpdateStatsCommand";
import { PlayerAvatar } from '../players/types/PlayerTypes';
import { RewardGainMessage } from '../common/MessageTypes';
import { HEALTH_FLASK_REGEN_PER_SECOND } from '../items/behavior/uniqueItemBalance';
import { TalentType } from '../talents/types/TalentTypes';
import { track } from '../talents/behavior/TalentBehaviors';
import { merchantDiscounts } from '../talents/behavior/merchantDiscountState';
import { addJokerTotal, clearJokerPendingCards, parseJokerPendingCards, rebuildJokerAffectedStats } from '../talents/behavior/jokerState';

export class DraftRoom extends Room {
    declare state: DraftState;
    maxClients = 1;

    dispatcher = new Dispatcher(this);
    private talentSelectionGeneration: number = 0;
    // Every talent ever offered in the current talent-selection generation — the 3 initially
    // shown plus any rerolled away since. Rerolls exclude this whole set (not just the 3
    // currently visible) so repeated/cross-slot rerolls can't bring back a talent already seen.
    // Reset whenever updateTalentSelection regenerates a fresh batch (level-up/select).
    private talentSelectionSeen: Set<number> = new Set();
    // Stack of recently-sold items, kept around so accidental sales can be undone in
    // reverse order. Cleared by any gold-spending action (see invalidateUndoSell).
    private soldItemStack: Item[] = [];
    // Re-entrancy guard for revalidateUpgradePreviews — the draft aura interval calls it
    // without awaiting, so a slow rebuild (DB round-trip) must not overlap with itself.
    private revalidatingUpgradePreviews = false;

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

        this.onMessage('refresh_talent_slot', async (client, message) => {
            await this.handleRefreshTalentSlot(client, message.talentId);
        });
        this.onMessage('joker_pick', (client, message) => {
            this.handleJokerPick(client, message.stat);
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
        let loadedPlayer: Player;

        //if player already exists, check if player is already playing
        if (foundPlayer) {
            if (foundPlayer.sessionId !== '') throw new Error('Player already playing!');
            if (foundPlayer.lives <= 0) throw new Error('Player has no lives left!');

            await this.setUpState(foundPlayer, client);
            loadedPlayer = foundPlayer;

            //check levelup after battle
            await this.checkLevelUp();
        } else {
            const newPlayer = await createNewPlayer(options.playerId, options.name, client.sessionId, options.avatarUrl);
            this.state.remainingTalentPoints = options.avatarUrl === PlayerAvatar.THIEF ? 2 : 1;
            await this.setUpState(newPlayer, client);
            loadedPlayer = newPlayer;
        }

        //pre-select and lock in the next fight opponent, sync its redacted preview
        await this.prepareNextEnemyPreview(this.state.player.round, options.playerId, loadedPlayer);

        // Misconduct: exactly one free-item claim per shop phase (round) — reset once here
        // (onJoin fires once per DraftRoom join; reconnects within the window resume the same
        // session via allowReconnection instead of re-running onJoin), unlike Comrade whose claim
        // is meant to refresh on every manual shop refresh too.
        this.state.player.misconductClaimUsed = false;
        // Gold Genie: same per-shop-phase reset reasoning as misconductClaimUsed above — one free
        // merchant item per round, not one per reroll.
        this.state.player.goldGenieClaimUsed = false;
        // Black Market Contact: same per-shop-phase reset reasoning as misconductClaimUsed above —
        // one free lucky-find item per round, not one per reroll.
        this.state.player.luckyFindClaimUsed = false;
        // Store Credit (item skill): same per-shop-phase reset reasoning as misconductClaimUsed
        // above — one free claim per round, not one per reroll.
        this.state.player.storeCreditClaimUsed = false;
        // Haggler: same per-shop-phase reset reasoning as misconductClaimUsed above.
        this.state.player.hagglerRerollsUsed = 0;
        // Fortune's Fool reads this at FIGHT_START to size the HP penalty — per-shop-phase reset,
        // same reasoning as hagglerRerollsUsed above.
        this.state.player.rerollsThisRound = 0;

        //set room state
        if (this.state.player.round === 1) await this.updateTalentSelection();
        if (this.state.shop.length === 0) await this.updateShop(this.state.shopSize);

        //set quest items
        this.state.questItems.clear();
        (await getQuestItems()).forEach(item => this.state.questItems.push(item));



        //start auras
        this.clock.setInterval(() => {
            this.dispatcher.dispatch(new DraftAuraTriggerCommand());
            // Catch-all for anything that changed an owned item's rarity without going through
            // buy/sell/drink (Weapon Whisperer, talent/item-granted duplicates, etc.) — see
            // revalidateUpgradePreviews.
            void this.revalidateUpgradePreviews();
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

    /** Pre-selects the next fight opponent at draft start and locks it in (persisted on the
     *  player doc via setNextFightEnemy), then syncs a server-side-redacted preview on
     *  DraftState. Round 1 is always Joe (deterministic avatar, full reveal); rounds >= 2 get
     *  identity-only redaction. Pure state assignment — the 500ms deferred client.send gotcha
     *  in onJoin doesn't apply here. */
    private async prepareNextEnemyPreview(round: number, playerId: number, loadedPlayer: Player) {
        let enemy: Player = null;
        if (round === 1) {
            enemy = await buildJoe(playerId); // deterministic, nothing to persist
        } else {
            // Rejoin/reconnect after room disposal: reuse the locked-in pick, no re-roll.
            if (loadedPlayer.nextFightEnemyRound === round && loadedPlayer.nextFightEnemyId != null) {
                enemy = loadedPlayer.nextFightEnemyId === JOE_PLAYER_ID
                    ? await buildJoe(playerId)
                    : await getPlayer(loadedPlayer.nextFightEnemyId);
            }
            if (!enemy) {
                enemy = await getSameRoundPlayer(round, playerId); // existing pool + recursive fallback
                await setNextFightEnemy(playerId, enemy?.playerId ?? null, round);
            }
        }
        const revealLevel = round === 1 ? EnemyRevealLevel.FULL : EnemyRevealLevel.IDENTITY;
        this.state.nextEnemy = buildEnemyPreview(enemy, revealLevel);
        this.state.nextEnemyRevealLevel = revealLevel;
        // Talent/item classes are revealed at every level (harmless at FULL, where the
        // concrete talents/items are visible anyway).
        this.state.nextEnemyTalentClasses.clear();
        this.state.nextEnemyItemClasses.clear();
        if (enemy) {
            extractTalentClasses(enemy).forEach(c => this.state.nextEnemyTalentClasses.push(c));
            extractItemClasses(enemy).forEach(c => this.state.nextEnemyItemClasses.push(c));
        }
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
        // Comrade: each newly built shop grants a fresh free-item claim — this is the one claim
        // that deliberately refreshes on every reroll (its reroll cost is inflated by income to
        // pay for it).
        this.state.player.comradeClaimUsed = false;
        // Gold Genie's, Black Market Contact's, Misconduct's and Store Credit's claims are
        // deliberately NOT reset here — each is one free item per shop phase (round), not per
        // shop build, so they survive manual refreshes (see onJoin).
        const excludeTypes: string[] = [];
        const shopFromDb = await getNumberOfItems(newShopSize, this.state.player.level, excludeTypes);
        const lockedShop = this.state.player.lockedShop;
        if (lockedShop.length > 0) {
            this.state.shop.clear();
            lockedShop.forEach(item => this.state.shop.push(item));
            this.state.player.unlockShop();
            // Locked previews were snapshotted against ownership at the time they were built —
            // anything that changed an owned item's rarity since (loss-reward upgrade, Weapon
            // Whisperer, etc.) needs to be reflected before the restored shop is shown.
            await this.revalidateUpgradePreviews();
        } else if (this.state.shop.length < 6) {
            this.state.shop.clear();
            // VIP Pass (talent 202): guarantees at least one slot below resolves to an
            // upgrade-preview by swapping a rolled template for an owned-item template before the
            // loop runs — the loop's own findOwnedUpgradeTarget/preview construction then treats
            // it exactly like any other owned match, lucky-find roll included.
            const vipPassIndex = await this.injectVipPassPick(shopFromDb);
            for (const rolledItem of shopFromDb) {
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
                    preview.previewBaseRarity = ownedTarget.rarity;
                    steps = luckyEligible ? applyLuckyShopUpgrades(preview, rolledItem, this.state.player) : 0;
                    shopItem = preview;
                } else {
                    steps = luckyEligible ? applyLuckyShopUpgrades(rolledItem, rolledItem, this.state.player) : 0;
                    shopItem = rolledItem;
                }
                shopItem.luckyFind = steps > 0;
                shopItem.luckyFindSteps = steps;
                this.announceLuckyUpgrade(shopItem, steps, slot);
                this.state.shop.push(shopItem);
            }
            if (vipPassIndex !== null) {
                const vipItem = this.state.shop[vipPassIndex];
                // announceLuckyUpgrade above may already have floated "Lucky find! Rarity up!" on
                // this same slot if the forced pick also rolled lucky — don't stack a second float.
                if (!vipItem.luckyFind) {
                    this.clients[0]?.send('shop_floating', { slot: vipPassIndex, text: 'VIP pick!', rarity: vipItem.rarity });
                }
                this.clients[0]?.send('trigger_talent', {
                    playerId: this.state.player.playerId,
                    talentId: TalentType.VIP_PASS,
                });
            }
        }

        this.dispatcher.dispatch(new AfterShopRefreshTriggerCommand());
        // Comrade / Gold Genie / Black Market Contact latches were just reset above, but the
        // synced *FreeClaim flags they gate are only (re)computed by DraftAuraTriggerCommand,
        // which otherwise wouldn't run again until the next 1s aura tick. Run it once here so
        // a freshly built shop's free-item claim is immediately claimable instead of racing a
        // ~1s window where the item still looks unaffordable.
        this.dispatcher.dispatch(new DraftAuraTriggerCommand());
    }

    /** VIP Pass (talent 202): guarantees at least one shop slot resolves to an item the player
     *  already owns, by swapping one freshly rolled template in `shopFromDb` for an owned-item
     *  template BEFORE updateShop's preview-construction loop runs — that loop already turns any
     *  rolledItem with a findOwnedUpgradeTarget match into an upgrade preview (lucky-find roll
     *  included), so this only needs to seed the right itemId into the array, not duplicate any
     *  of that construction. Costs nothing when the natural roll already contains an owned item —
     *  the guarantee only spends a slot when it would otherwise have gone to waste. Returns the
     *  index in `shopFromDb` (== the final shop slot, since updateShop pushes in array order) that
     *  was forced, or null when VIP Pass isn't owned, the roll already satisfied the guarantee, or
     *  the player has no upgrade-eligible items (fresh run, or everything already Mythic). */
    private async injectVipPassPick(shopFromDb: Item[]): Promise<number | null> {
        if (!hasVipPass(this.state.player)) return null;
        if (shopFromDb.length === 0) return null;
        if (shopFromDb.some((item) => findOwnedUpgradeTarget(this.state.player, item.itemId))) return null;
        const ownedIds = getOwnedUpgradeableItemIds(this.state.player);
        if (ownedIds.length === 0) return null;
        const pickId = ownedIds[Math.floor(Math.random() * ownedIds.length)];
        const template = await getItemById(pickId);
        if (!template) return null;
        rollItemStats(template);
        const index = Math.floor(Math.random() * shopFromDb.length);
        shopFromDb[index] = template;
        return index;
    }

    private announceLuckyUpgrade(item: { name: string; rarity: number }, steps: number, slot: number, text = 'Lucky find! Rarity up!') {
        if (steps <= 0) return;
        const rarityName = ItemRarity[item.rarity];
        const displayName = rarityName.charAt(0) + rarityName.slice(1).toLowerCase();
        // Floating text over the shop card (see TriggerAnimations.triggerShopFloatingText)
        // instead of a snackbar toast — the toast queued/overlapped awkwardly with other UI.
        this.clients[0]?.send('shop_floating', { slot, text, rarity: item.rarity });
    }

    /** Tier to draw talents from: one past the highest tier the player already owns. */
    private nextTalentLevel(): number {
        if (this.state.player.talents.length === 0) return 1;
        const maxTier = this.state.player.talents.reduce((max, t) => Math.max(max, t.tier), 0);
        return maxTier + 1;
    }

    private async handleRefreshTalentSlot(client: Client, talentId: number) {
        const index = this.state.availableTalents.findIndex((talent) => talent.talentId === talentId);
        if (index === -1) {
            client.send('error', 'Not possible to reroll talent!');
            return;
        }
        if (this.state.talentRerollUsed[index] && process.env.NODE_ENV === 'production') {
            client.send('error', 'Already rerolled!');
            return;
        }

        const generation = this.talentSelectionGeneration;
        // Exclude every talent shown so far this generation (currently visible + previously
        // rerolled away in any slot) so a reroll can never bring back a talent already seen.
        const exceptions = Array.from(this.talentSelectionSeen);
        const [newTalent] = await getRandomTalents(1, this.nextTalentLevel(), exceptions);
        // Bail if a full regen (level-up/select) raced this reroll while we awaited the DB.
        if (generation !== this.talentSelectionGeneration || !newTalent) return;

        // Re-find the slot by id in case the array shifted while we awaited.
        const freshIndex = this.state.availableTalents.findIndex((talent) => talent.talentId === talentId);
        if (freshIndex === -1) return;

        this.state.availableTalents[freshIndex] = newTalent;
        this.state.talentRerollUsed[freshIndex] = true;
        this.talentSelectionSeen.add(newTalent.talentId);
    }

    private async updateTalentSelection() {
        const exceptions = this.state.availableTalents.map((talent) => talent.talentId);
        //if player has no talent points, return
        if (this.state.remainingTalentPoints <= 0) {
            this.state.availableTalents.clear();
            this.state.talentRerollUsed.clear();
            this.talentSelectionSeen.clear();
            return;
        }

        const generation = ++this.talentSelectionGeneration;

        //assign talents from db to state
        const talents = await getRandomTalents(3, this.nextTalentLevel(), exceptions);
        if (generation !== this.talentSelectionGeneration) return;
        // Clear and repopulate back-to-back (no await between them) so clients never observe
        // an empty availableTalents mid-reroll — that transient emptiness was being
        // misread by the frontend as "talent was picked" and closing the modal.
        this.state.availableTalents.clear();
        this.state.talentRerollUsed.clear();
        this.talentSelectionSeen.clear();
        talents.forEach((talent) => {
            if (this.state.availableTalents.length < 3) {
                this.state.availableTalents.push(talent);
                this.state.talentRerollUsed.push(false);
                this.talentSelectionSeen.add(talent.talentId);
            }
        });
    }

    //get player, enemy, items and talents from db and map them to the room state
    private async setUpState(player: Player, client: Client) {
        this.state.player.copyFrom(player);

        const highestTalentTier = this.state.player.talents.length > 0
            ? this.state.player.talents.reduce((max, t) => Math.max(max, t.tier), 0)
            : 0;

        this.state.remainingTalentPoints = player.level - highestTalentTier;
        // Seed the hidden shop-roll stat for the very first shop of this draft phase — the
        // draft aura tick (which keeps it current afterward) hasn't run yet at this point.
        this.state.player.luckyFindChance = baseLuckyFindChance(this.state.player.level) + this.state.player.luckyFindMythicBonus;
        this.state.player.refreshShopCost = BASE_REFRESH_SHOP_COST;
        await this.updateTalentSelection();

        this.state.player.sessionId = client.sessionId;
        this.state.playerClient = client;

    }

    /** Credits gold SAVED (not gained — no wallet change, so no reward_gain floater) to a talent's
     *  statGoldGained/totalGoldGained, e.g. a free-claim's item value or a discount actually used.
     *  No-op if the player doesn't currently have the talent or nothing was actually saved. */
    private creditTalentGold(talentId: TalentType, gold: number) {
        if (gold <= 0) return;
        const talent = this.state.player.talents.find((t) => t.talentId === talentId);
        if (talent) track(talent, 1, 0, 0, gold, 0);
    }

    private async buyItem(itemId: number, client: Client) {
        // Exclude already-sold slots: itemId isn't unique across the shop array (e.g. Second
        // Thoughts carrying an item over into a shop that also independently rolls the same
        // itemId elsewhere) — bought items stay in `shop` with sold=true rather than being
        // removed, so an unguarded find() on a duplicate itemId keeps resolving to the stale
        // sold entry and rejects every later attempt to buy the other (still unsold) copy.
        const item = this.state.shop.find((item) => item.itemId === itemId && !item.sold);
        if (!item) {
            client.send('error', 'Not possible to buy item!');
            return;
        }
        // Free-item claims: make this purchase free regardless of price, then latch the spent
        // claim (DraftRoom.onJoin resets goldGenie/luckyFind/misconduct/storeCredit once per shop
        // phase; DraftRoom.updateShop resets comrade on every shop build). The four sources are
        // mutually exclusive in priority order lucky-find > gold genie > comrade > misconduct —
        // matching the client's freeClaimSource() — so one purchase never burns more than one claim.
        const luckyFree = this.state.player.luckyFindFreeClaim && item.luckyFind && !item.sold;
        const goldGenieFree = !luckyFree && this.state.player.goldGenieFreeClaim && item.class === ItemClass.MERCHANT && !item.sold;
        const storeCreditFree = !luckyFree && !goldGenieFree && this.state.player.storeCreditFreeClaim && !item.sold
            && item.price <= this.state.player.storeCreditFreeClaimCap;
        const comradeFree = !luckyFree && !goldGenieFree && !storeCreditFree && this.state.player.comradeFreeClaim && !item.sold;
        const misconductFree = !luckyFree && !goldGenieFree && !storeCreditFree && !comradeFree && this.state.player.misconductFreeClaim && !item.sold;
        // Snapshot before the free-claim price wipe below, so the value can be credited to
        // whichever talent granted the claim (see creditTalentGold calls further down).
        const originalPrice = item.price;
        if (luckyFree || goldGenieFree || storeCreditFree || comradeFree) {
            item.price = 0;
            item.sellPrice = 0;
        }
        // Misconduct keeps item.price intact (it feeds the rarity-upgrade re-pricing and the
        // full-price sell value below), so it bypasses the affordability check separately.
        if (item.sold || (!misconductFree && this.state.player.gold < item.price)) {
            client.send('error', 'Not possible to buy item!');
            return;
        }
        const slot = this.state.shop.indexOf(item);
        let misconductSteps = 0;
        if (misconductFree) {
            ({ steps: misconductSteps } = stealShopItem(item, this.state.player, true));
        } else {
            this.state.player.getItem(item);
        }
        // Lucky Find mastery: every Mythic acquisition (plain buy, an upgrade-preview buy, or a
        // Misconduct steal-upgrade that lands on Mythic — all flow through here) grants a
        // permanent Lucky Find chance bonus for the rest of the run (see ShopUpgradeUtils.
        // LUCKY_FIND_MYTHIC_BONUS / PlayerSchema.luckyFindMythicBonus). Celebrated on the
        // avatar via reward_gain (not the shop card) — upgrade-preview buys destroy and recreate
        // the item's DOM node, which broke the card-anchored shop_floating version of this celebration.
        if (item.rarity === ItemRarity.MYTHIC) {
            grantLuckyFindMythicBonus(this.state.player);
            client.send('draft_log', `Mythic forged! Permanent +${LUCKY_FIND_MYTHIC_BONUS_PERCENT}% Lucky Find chance!`);
            client.send('reward_gain', { playerId: this.state.player.playerId, luckyFind: true } as RewardGainMessage);
        }
        if (luckyFree) {
            this.state.player.luckyFindClaimUsed = true;
            this.state.player.luckyFindFreeClaim = false;
            this.creditTalentGold(TalentType.BLACK_MARKET_CONTRACT, originalPrice);
        }
        if (goldGenieFree) {
            this.state.player.goldGenieClaimUsed = true;
            this.state.player.goldGenieFreeClaim = false;
            this.creditTalentGold(TalentType.GOLD_GENIE, originalPrice);
        }
        if (storeCreditFree) {
            this.state.player.storeCreditClaimUsed = true;
            this.state.player.storeCreditFreeClaim = false;
        }
        if (comradeFree) {
            this.state.player.comradeClaimUsed = true;
            this.state.player.comradeFreeClaim = false;
            this.creditTalentGold(TalentType.COMRADE, originalPrice);
        }
        if (misconductFree) {
            this.state.player.misconductClaimUsed = true;
            this.state.player.misconductFreeClaim = false;
            this.announceLuckyUpgrade(item, misconductSteps, slot, 'Misconduct! Rarity up!');
            client.send('draft_log', `Misconduct! Took ${item.name}${misconductSteps > 0 ? ' and upgraded it' : ''}!`);
            // item.price reflects the post-upgrade re-pricing applied inside stealShopItem above —
            // that's the value actually taken.
            this.creditTalentGold(TalentType.MISCONDUCT, item.price);
        }
        // Flash Sale (Merchant_1): only on a genuinely paid purchase — a free-claimed item was
        // free regardless of any earlier shop-wide discount, so crediting it there would double up.
        if (!luckyFree && !goldGenieFree && !storeCreditFree && !comradeFree && !misconductFree) {
            this.creditTalentGold(TalentType.MERCHANT_1, merchantDiscounts.get(item) ?? 0);
        }
        this.invalidateUndoSell();
        // Other shop slots for the same item (or previews built off the item just
        // replaced/consumed) need to reflect the new owned rarity immediately.
        await this.revalidateUpgradePreviews();
    }

    private async sellItem(itemId: number) {
        const item = this.state.player.inventory.find((item) => item.itemId === itemId);
        if (!item) return;
        const goldBefore = this.state.player.gold;
        const sold = await this.state.player.sellItem(item);
        if (!sold) return;
        // sellItem() no-ops for equipped/quest items (checked above), so derive the actual
        // delta rather than assuming item.sellPrice was granted.
        const goldGained = this.state.player.gold - goldBefore;
        if (goldGained > 0) {
            this.clients[0]?.send('reward_gain', { playerId: this.state.player.playerId, gold: goldGained } as RewardGainMessage);
        }
        const goldBeforeTrigger = this.state.player.gold;
        const xpBeforeTrigger = this.state.player.xp;
        const levelBeforeTrigger = this.state.player.level;
        this.dispatcher.dispatch(new OnSellTriggerCommand());
        // An ON_SELL bonus (e.g. the Cash Back item skill) pays gold/xp on top of the sell
        // price, but undoSell only ever refunds item.sellPrice. Allowing undo after a bonus
        // payout would let sell->undo be repeated for infinite gold/xp (and, via xp, infinite
        // levels/talent points) with the item unchanged. So a sale that paid out any bonus is
        // not undoable at all. Checks gold, xp AND level: levelUp() resets xp to the leftover
        // amount, so a bonus that pushes a level-up can leave xp lower than before even though
        // a bonus was paid. Assumes ON_SELL behaviors are synchronous (true today) — an async
        // ON_SELL behavior would need this revisited.
        const bonusPaid =
            this.state.player.gold > goldBeforeTrigger ||
            this.state.player.xp > xpBeforeTrigger ||
            this.state.player.level > levelBeforeTrigger;
        if (bonusPaid) {
            this.invalidateUndoSell();
        } else {
            this.soldItemStack.push(item);
            this.state.canUndoSell = true;
        }
        await this.revalidateUpgradePreviews();
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

    /** Does this shop slot no longer match what the player currently owns?
     *  Cheap and synchronous — safe to call on every slot every aura tick. */
    private isPreviewStale(shopItem: Item): boolean {
        if (shopItem.sold) return false;
        const ownedTarget = findOwnedUpgradeTarget(this.state.player, shopItem.itemId);
        if (ownedTarget) {
            // A preview is stale once the owned copy it was built from has moved on
            // (upgraded further, or caught up/passed it some other way) — including the
            // case where this slot isn't a preview yet but now could be.
            return !shopItem.upgradePreview || ownedTarget.rarity !== shopItem.previewBaseRarity;
        }
        // No owned copy (anymore) to upgrade, but the slot still thinks it's a preview
        // (e.g. the owned copy just hit MYTHIC and dropped out of eligibility).
        return shopItem.upgradePreview;
    }

    /** Rebuilds shop slot `index` from scratch against current ownership — same
     *  construction as the roll branch of updateShop, but for exactly one slot, and
     *  preserving whatever lucky-find steps it already had. */
    private async rebuildShopSlot(index: number): Promise<void> {
        const stale = this.state.shop[index];
        if (!stale) return;
        const template = await getItemById(stale.itemId);
        if (!template) return;
        rollItemStats(template);

        const ownedTarget = findOwnedUpgradeTarget(this.state.player, stale.itemId);
        let rebuilt: Item;
        if (ownedTarget) {
            rebuilt = cloneItem(ownedTarget);
            applyRarityUpgrade(rebuilt, template, this.state.player);
            rebuilt.price = template.price;
            rebuilt.sold = false;
            rebuilt.equipped = false;
            rebuilt.upgradePreview = true;
            rebuilt.previewBaseRarity = ownedTarget.rarity;
        } else {
            rebuilt = template;
        }
        applyExtraRaritySteps(rebuilt, template, this.state.player, stale.luckyFindSteps);
        rebuilt.luckyFind = stale.luckyFind;
        rebuilt.luckyFindSteps = stale.luckyFindSteps;
        // Shields roll from Common, not off a rarity upgrade — grant it here so a rebuilt
        // preview slot never briefly shows a shield with no skill row (the DraftAuraTriggerCommand
        // sweep would eventually catch it too, but this keeps the rebuild self-contained).
        ensureShieldSkill(rebuilt, this.state.player);
        // Same self-contained reasoning as ensureShieldSkill above — a rebuilt class-item preview
        // slot shouldn't briefly show a blank/stale futureSkill row either.
        refreshFutureItemSkill(rebuilt, this.state.player);
        this.state.shop.splice(index, 1, rebuilt);
    }

    /** Scans every unsold shop slot and rebuilds any whose upgrade-preview state no
     *  longer matches what the player owns (buy/sell/drink call this directly for an
     *  immediate fix-up; the draft aura interval also calls it each tick as a catch-all
     *  for changes that don't route through those — Weapon Whisperer, granted
     *  duplicates, etc.). Re-entrancy guarded since the interval doesn't await it. */
    private async revalidateUpgradePreviews(): Promise<void> {
        if (this.revalidatingUpgradePreviews) return;
        this.revalidatingUpgradePreviews = true;
        try {
            for (let i = 0; i < this.state.shop.length; i++) {
                if (this.isPreviewStale(this.state.shop[i])) {
                    await this.rebuildShopSlot(i);
                }
            }
        } finally {
            this.revalidatingUpgradePreviews = false;
        }
    }

    private async equipItem(itemId: number, slot: EquipSlot | string, client: Client) {
        if (slot === 'drink') {
            await this.drinkItem(itemId, client);
            return;
        }
        const item = this.state.player.inventory.find((item) => item.itemId === itemId);
        if (!item) return;
        const equipOptions = Array.from(item.equipOptions as any as Iterable<string>);
        if (!equipOptions.includes(slot as string)) return;
        this.state.player.setItemEquipped(item, slot as EquipSlot);
    }

    private async unequipItem(itemId: number, slot: EquipSlot) {
        const item = this.state.player.equippedItems.get(slot);
        if (!item || item.itemId !== itemId) return;
        this.state.player.setItemUnequipped(item, slot);
    }

    /** Forces one free shop rebuild, bypassing the gold cost and the free-reroll charge pools
     *  entirely. Exposed for Grand Robbery (TalentBehaviors.ts) — a talent behavior has no room
     *  handle of its own, so this is threaded through the aura BehaviorContext instead. Arrow
     *  property (not a method) so it stays bound when passed through the context. Deliberately
     *  does NOT increment rerollsThisRound — a forced reroll must not feed Fortune's Fool's
     *  per-round HP penalty. */
    public forceFreeReroll = async (): Promise<void> => {
        this.state.player.unlockShop();
        this.state.shop.clear();
        this.invalidateUndoSell();
        await this.updateShop(this.state.shopSize);
    };

    private async refreshShop(client: Client) {
        // Fortune's Fool (aura): rerolls are entirely free, checked before Haggler's per-shop
        // charge pool so it doesn't burn Haggler's limited free rerolls either.
        // Haggler (item skill): spend a free reroll before falling back to the gold cost.
        const freeReroll = this.state.player.freeRerolls || this.state.player.hagglerFreeRerolls > 0;
        if (!freeReroll && this.state.player.gold < this.state.player.refreshShopCost) {
            client.send('error', 'Not enough gold!');
            return;
        }
        if (this.state.player.freeRerolls) {
            // no gold cost, no Haggler charge consumed
        } else if (this.state.player.hagglerFreeRerolls > 0) {
            this.state.player.hagglerRerollsUsed++;
            // Decrement the synced counter now rather than waiting for the next 1s aura tick to
            // re-derive it — otherwise repeated refresh_shop messages inside that window all read
            // a stale > 0 and take the free branch. The aura pass remains the source of truth and
            // recomputes the same value.
            this.state.player.hagglerFreeRerolls = Math.max(0, this.state.player.hagglerFreeRerolls - 1);
        } else {
            this.state.player.gold -= this.state.player.refreshShopCost;
            // Bargain Hunter: credit the gold actually saved by the reroll-cost halving on a paid
            // reroll only — free rerolls (Fortune's Fool/Haggler, handled above) save nothing extra.
            this.creditTalentGold(TalentType.BARGAIN_HUNTER, this.state.player.refreshShopCostBeforeDiscount - this.state.player.refreshShopCost);
        }
        this.state.player.rerollsThisRound++;
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
        this.state.player.pendingRegenBuff += HEALTH_FLASK_REGEN_PER_SECOND;
        await this.revalidateUpgradePreviews();
        client.send('draft_log', `You drank the ${item.name} — +${HEALTH_FLASK_REGEN_PER_SECOND} HP regen for your next fight!`);
    }

    private async selectTalent(talentId: number) {
        const talent = this.state.availableTalents.find((talent) => talent.talentId === talentId);
        if (talent) {
            this.state.player.talents.push(talent);
            this.state.remainingTalentPoints--;
            await this.updateTalentSelection();
        }
    }

    /** Joker (talentId 41): every fight (win or lose, same value either way) deals two cards
     *  (TalentBehaviors.ts's FIGHT_END branch), encoded onto talent.tags and left pending until
     *  the player picks one here. Never
     *  trusts the client with the amount — always re-derives it from the matching pending-card
     *  tag, so a tampered payload can't grant an arbitrary bonus. Clears both pending cards (the
     *  one not picked is discarded, not banked) and rebuilds affectedStats immediately so the
     *  un-suspended total is visible without waiting on the next AURA tick. */
    private handleJokerPick(client: Client, stat: string) {
        const talent = this.state.player.talents.find((t) => t.talentId === TalentType.JOKER);
        if (!talent) {
            client.send('error', 'No Joker talent found.');
            return;
        }

        const card = parseJokerPendingCards(talent.tags).find((c) => c.stat === stat);
        if (!card) {
            client.send('error', 'That card is not on offer.');
            return;
        }

        addJokerTotal(talent.tags, card.stat, card.amount);
        clearJokerPendingCards(talent.tags);
        rebuildJokerAffectedStats(talent);

        track(talent, 1);
        client.send('draft_log', `You pick +${card.amount} ${card.stat} from the Joker!`);
        client.send('trigger_talent', {
            playerId: this.state.player.playerId,
            talentId: TalentType.JOKER,
        });
    }

    private async buyXp(xp: number, price: number, client: Client) {
        if (this.state.player.gold < price) {
            client.send('error', 'Not enough gold!');
            return;
        }
        this.state.player.gold -= price;
        const xpGained = xp;
        this.state.player.xp += xpGained;
        client.send('reward_gain', { playerId: this.state.player.playerId, xp: xpGained } as RewardGainMessage);
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
            await this.updateTalentSelection();
        }
    }

    private async levelUp(leftoverXp: number = 0) {
        this.state.player.level++;
        // Cubic curve: early levels stay fast, level 5 is a deliberate wall (Season 18)
        this.state.player.maxXp += (this.state.player.level - 1) ** 3 * 5;
        this.state.player.xp = leftoverXp;

        const base = this.state.player.baseStats;

        // Every level grants a flat max HP bonus
        base.maxHp += 10;

        // Class-specific level-up bonuses (Season 18)
        switch (this.state.player.avatarUrl) {
            case PlayerAvatar.WARRIOR:
                base.maxHp += 30;
                base.strength += 6;
                break;
            case PlayerAvatar.THIEF:
                base.attackSpeed += 0.2;
                base.dodgeRate += 10;
                break;
            case PlayerAvatar.MERCHANT:
                base.income += 2;
                base.maxHp += 10;
                break;
        }

        this.dispatcher.dispatch(new LevelUpTriggerCommand());
    }
}
