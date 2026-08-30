import { ColyseusTestServer, boot } from "@colyseus/testing";
import { server } from '../src/app.config';
import { getNextPlayerId, getPlayer } from "../src/players/db/Player";
import { generatePlayerToken, reservePlayerId } from "../src/players/db/PlayerToken";
import { FightResultType } from "../src/common/types";
import { Item } from "../src/items/schema/ItemSchema";
import mongoose from 'mongoose';
import { waitFor } from './helpers/waitFor';

// Same safe speed cap TournamentRunner.DEFAULT_TIME_SCALE uses for headless tournament fights
// (see its comment: "Capped at 8x ... an overloaded event loop would produce oversized deltas").
// FightRoom.tryWeaponAttack et al. are unchanged by this — patchClockTimeScale (FightRoom.ts)
// scales every Delayed timer uniformly, so a fight at 8x plays out identically to 1x, just
// faster; only real-time-gated things (the pre-battle countdown, post-fight delays) are
// unaffected, by design. Applied directly on the room instance rather than via the
// 'set_fight_speed' message so it isn't limited to FightRoom's public ALLOWED_FIGHT_SPEEDS
// ([0.5, 1, 2]), which exists to bound what a real client can request, not what a test can.
const TEST_FIGHT_TIME_SCALE = 8;

describe("testing your Colyseus app", () => {
    let colyseus: ColyseusTestServer;

    beforeAll(async () => {
        await mongoose.connect(process.env.DB_CONNECTION_STRING!, {
            autoIndex: true,
        });
        colyseus = await boot(server);
    });

    afterAll(async () => {
        await colyseus.shutdown();
        mongoose.disconnect();
    });

    afterEach(async () => {
        await colyseus.cleanup();
    });

    const ROOM_SERVER_MESSAGES = [
        'attack', 'damage', 'healing', 'combat_log', 'trigger_talent',
        'trigger_item', 'end_battle', 'game_over', 'draft_log', 'error',
    ];

    // Mirrors what the real /playerid HTTP route does (app.config.ts) — mints a playerId and
    // reserves a matching token, required by onAuth on both rooms (see PlayerToken.ts). Tests
    // connect straight to the Colyseus test server rather than through Express, so there's no
    // HTTP round trip to reuse; this calls the same underlying functions the route does.
    async function mintPlayerIdAndToken() {
        const playerId = await getNextPlayerId();
        const playerToken = generatePlayerToken();
        await reservePlayerId(playerId, playerToken);
        return { playerId, playerToken };
    }

    // DraftRoom.onLeave is not awaited by callers — poll until the player's sessionId is
    // cleared in DB before joining a fight room, otherwise FightRoom.onJoin throws "Player
    // already playing!".
    async function createAndJoinFightRoom(playerId: number, playerToken: string) {
        await waitFor(async () => {
            const player = await getPlayer(playerId);
            return !player || player.sessionId === '';
        }, { timeout: 15000, interval: 100, message: `player ${playerId}'s session to clear` });

        const fightRoom = await colyseus.createRoom("fight_room", {});
        // Inert until state.battleStarted flips (patchClockTimeScale only scales post-battle
        // time), so this only speeds up the fight itself — the pre-battle countdown stays real.
        (fightRoom as any).state.timeScale = TEST_FIGHT_TIME_SCALE;
        (fightRoom as any).applySimulationResolution(TEST_FIGHT_TIME_SCALE);

        const fightClient = await colyseus.connectTo(fightRoom, { playerId, playerToken });
        ROOM_SERVER_MESSAGES.forEach(type => fightClient.onMessage(type, () => {}));
        // Round-1 opponent is deterministically Joe, whose playerId is JOE_PLAYER_ID (0 —
        // falsy), so a truthy-playerId check would never resolve; enemy.name is always populated.
        await waitFor(() => !!fightRoom.state.enemy?.name, { timeout: 8000, message: 'fight room enemy to load' });
        return { fightRoom, fightClient };
    }

    async function createAndJoinDraftRoom(name = "Test Player") {
        const { playerId, playerToken } = await mintPlayerIdAndToken();
        const room = await colyseus.createRoom("draft_room", {});
        const client = await colyseus.connectTo(room, { playerId, playerToken, name, avatarUrl: "test_avatar" });
        ROOM_SERVER_MESSAGES.forEach(type => client.onMessage(type, () => {}));
        // onJoin has a 1000ms clock delay before any DB work, then builds the shop — waiting for
        // a populated shop is the concrete signal setup actually finished, rather than a guess.
        await waitFor(() => room.state.shop.length > 0, { timeout: 5000, message: 'draft room shop to populate' });

        async function cleanExit() {
            await client.leave(true);
        }

        return { room, client, playerId, playerToken, cleanExit };
    }

    // Buying gear now auto-equips it into the first empty valid slot (Player.getItem →
    // tryAutoEquipIntoEmptySlot), so a purchased item may live in equippedItems instead of
    // inventory. "Owning" an item means it's in either place.
    //
    // Keyed by uid (the owned-instance id), not itemId (the catalog id) — every new player is
    // created with a default weapon already equipped (Player.ts's createNewPlayer), so a bought
    // item can easily share its itemId with something else the player already owns. Matching by
    // itemId then finds whichever instance happens to come first, which silently passes/fails
    // against the wrong object. uid is unique per owned instance (see ItemSchema.ts's comment)
    // and is what DraftRoom.unequipItem/equipItem/sellItem actually key their lookups on too —
    // see character-details.component.ts's sendMessage calls for the real wire contract.
    function ownsItem(player: any, uid: number): boolean {
        if (player.inventory.find((i: Item) => i.uid === uid)) return true;
        let equipped = false;
        player.equippedItems.forEach((i: Item) => { if (i.uid === uid) equipped = true; });
        return equipped;
    }

    function inInventory(player: any, uid: number): boolean {
        return !!player.inventory.find((i: Item) => i.uid === uid);
    }

    // Move an item into inventory if it got auto-equipped on buy, so equip/sell flows can be
    // exercised from a known starting point.
    async function ensureInInventory(room: any, client: any, uid: number) {
        let slot: string | undefined;
        room.state.player.equippedItems.forEach((i: Item, s: string) => { if (i.uid === uid) slot = s; });
        if (slot) {
            client.send('unequip', { uid, slot });
            await waitFor(() => inInventory(room.state.player, uid), { timeout: 5000, message: `item uid=${uid} to land in inventory after unequip` });
        }
    }

    // -------------------------------------------------------------------------
    // Draft room — basic operations
    // -------------------------------------------------------------------------

    it("connects, creates new player, buys an item, and selects a talent", async () => {
        const { room, client } = await createAndJoinDraftRoom("Mocked Player");

        const shopItem = room.state.shop[0];
        const selectedItemId = shopItem.itemId;
        const selectedUid = shopItem.uid;
        const selectedTalentId = room.state.availableTalents[0].talentId;

        client.send('buy', { itemId: selectedItemId });
        await waitFor(() => ownsItem(room.state.player, selectedUid), { message: 'bought item to appear on player' });

        client.send('select_talent', { talentId: selectedTalentId });
        await waitFor(() => room.state.player.talents.length === 1, { message: 'talent to be selected' });

        expect(client.sessionId).toEqual(room.clients[0].sessionId);
        expect(room.state.player.talents.length).toBe(1);
        // The bought item is now owned — either in inventory or auto-equipped into an empty slot.
        expect(ownsItem(room.state.player, selectedUid)).toBe(true);
    });

    it("buying an item deducts gold and adds it to inventory", async () => {
        const { room, client, cleanExit } = await createAndJoinDraftRoom();

        const item = room.state.shop[0];
        const goldBefore = room.state.player.gold;

        client.send('buy', { itemId: item.itemId });
        await waitFor(() => ownsItem(room.state.player, item.uid), { message: 'bought item to appear on player' });

        expect(room.state.player.gold).toBe(goldBefore - item.price);
        // Item is owned afterwards (inventory or auto-equipped).
        expect(ownsItem(room.state.player, item.uid)).toBe(true);

        await cleanExit();
    });

    it("selling an item refunds 70% of its price", async () => {
        const { room, client, cleanExit } = await createAndJoinDraftRoom();

        const equippedIds = new Set<number>();
        room.state.player.equippedItems.forEach((i: Item) => equippedIds.add(i.itemId));
        const item = room.state.shop.find((i: Item) => !equippedIds.has(i.itemId));
        const goldBefore = room.state.player.gold;

        client.send('buy', { itemId: item.itemId });
        await waitFor(() => ownsItem(room.state.player, item.uid), { message: 'bought item to appear on player' });

        // Only unequipped items can be sold; move it to inventory if buy auto-equipped it.
        // Unequipping is gold-neutral, so it doesn't affect the refund math below.
        await ensureInInventory(room, client, item.uid);

        client.send('sell', { uid: item.uid });
        await waitFor(() => !ownsItem(room.state.player, item.uid), { message: 'sold item to leave player' });

        const expectedGold = (goldBefore - item.price) + Math.floor(item.price * 0.7);
        expect(room.state.player.gold).toBe(expectedGold);
        expect(ownsItem(room.state.player, item.uid)).toBe(false);

        await cleanExit();
    });

    it("equipping an item moves it from inventory to equipped slot", async () => {
        const { room, client, cleanExit } = await createAndJoinDraftRoom();

        const equippable = room.state.shop.find((i: Item) => {
            const opts = Array.from((i.equipOptions ?? []) as any) as string[];
            return opts.some(o => o !== 'drink');
        });
        expect(equippable).toBeDefined();

        const slot = (Array.from(equippable.equipOptions as any) as string[]).find(o => o !== 'drink');

        client.send('buy', { itemId: equippable.itemId });
        await waitFor(() => ownsItem(room.state.player, equippable.uid), { message: 'bought item to appear on player' });

        // Buy may have auto-equipped it; put it back in inventory so we test the explicit equip.
        await ensureInInventory(room, client, equippable.uid);
        expect(room.state.player.inventory.find((i: Item) => i.uid === equippable.uid)).toBeDefined();

        client.send('equip', { uid: equippable.uid, slot });
        await waitFor(() => room.state.player.equippedItems.get(slot)?.uid === equippable.uid, { message: 'item to land in equipped slot' });

        // Displacing whatever (if anything) already occupied this slot — e.g. the player's
        // default starter weapon — can land a different, same-itemId instance back in
        // inventory, so this must check the specific uid, not just "some item with this itemId".
        expect(room.state.player.inventory.find((i: Item) => i.uid === equippable.uid)).toBeUndefined();
        expect(room.state.player.equippedItems.get(slot)).toBeDefined();
        expect(room.state.player.equippedItems.get(slot).uid).toBe(equippable.uid);

        await cleanExit();
    });

    it("unequipping an item moves it back to inventory", async () => {
        const { room, client, cleanExit } = await createAndJoinDraftRoom();
        const equippable = room.state.shop.find((i: Item) => {
            const opts = Array.from((i.equipOptions ?? []) as any) as string[];
            return opts.some(o => o !== 'drink');
        });
        expect(equippable).toBeDefined();
        const slot = (Array.from(equippable.equipOptions as any) as string[]).find(o => o !== 'drink');

        client.send('buy', { itemId: equippable.itemId });
        await waitFor(() => ownsItem(room.state.player, equippable.uid), { message: 'bought item to appear on player' });

        // Normalize to inventory first so equip lands in the known slot regardless of auto-equip.
        await ensureInInventory(room, client, equippable.uid);

        client.send('equip', { uid: equippable.uid, slot });
        await waitFor(() => room.state.player.equippedItems.get(slot)?.uid === equippable.uid, { message: 'item to land in equipped slot' });

        client.send('unequip', { uid: equippable.uid, slot });
        await waitFor(() => !room.state.player.equippedItems.get(slot), { message: 'item to leave equipped slot' });

        expect(room.state.player.inventory.find((i: Item) => i.uid === equippable.uid)).toBeDefined();
        expect(room.state.player.equippedItems.get(slot)).toBeUndefined();

        await cleanExit();
    });

    it("buying XP costs 4 gold and grants 4 XP", async () => {
        const { room, client, cleanExit } = await createAndJoinDraftRoom();

        const xpBefore = room.state.player.xp;
        const goldBefore = room.state.player.gold;

        client.send('buy_xp');
        await waitFor(() => room.state.player.xp === xpBefore + 4, { message: 'XP to increase by 4' });

        expect(room.state.player.xp).toBe(xpBefore + 4);
        expect(room.state.player.gold).toBe(goldBefore - 4);

        await cleanExit();
    });

    it("refreshing the shop replaces items and costs gold", async () => {
        const { room, client, cleanExit } = await createAndJoinDraftRoom();

        const goldBefore = room.state.player.gold;
        const refreshCost = room.state.player.refreshShopCost;
        client.send('refresh_shop');
        // Gold is deducted synchronously, but the handler then clears the shop and awaits
        // updateShop() to repopulate it — wait for both together, or shop.length can be read
        // mid-rebuild.
        await waitFor(
            () => room.state.player.gold === goldBefore - refreshCost && room.state.shop.length > 0,
            { message: 'shop refresh (gold deducted, shop repopulated)' }
        );

        expect(room.state.player.gold).toBe(goldBefore - refreshCost);
        // Shop should have been replaced (at least one item is different or same length maintained)
        expect(room.state.shop.length).toBeGreaterThan(0);

        await cleanExit();
    });

    it("selecting a talent reduces remainingTalentPoints by 1", async () => {
        const { room, client, cleanExit } = await createAndJoinDraftRoom();

        const pointsBefore = room.state.remainingTalentPoints;
        expect(pointsBefore).toBeGreaterThan(0);

        const talent = room.state.availableTalents[0];
        client.send('select_talent', { talentId: talent.talentId });
        await waitFor(() => room.state.remainingTalentPoints === pointsBefore - 1, { message: 'remainingTalentPoints to decrease' });

        expect(room.state.remainingTalentPoints).toBe(pointsBefore - 1);
        expect(room.state.player.talents.length).toBe(1);
        expect(room.state.player.talents[0].talentId).toBe(talent.talentId);

        await cleanExit();
    });

    // -------------------------------------------------------------------------
    // Fight room — full battle loop
    // -------------------------------------------------------------------------

    it("fight room: player and enemy load, battle starts after countdown, and a fight result is produced", async () => {
        // 1. Create a player through the draft room
        const { room: draftRoom, client: draftClient, playerId, playerToken } = await createAndJoinDraftRoom("Fighter");
        const initialRound = draftRoom.state.player.round;

        // 2. Leave draft room — triggers copyPlayer + updatePlayer (saves to DB with sessionId='')
        draftClient.leave(true);

        //3. Join fight room (already running at TEST_FIGHT_TIME_SCALE once the battle starts)
        const { fightRoom, fightClient } = await createAndJoinFightRoom(playerId, playerToken);

        // 4. Verify initial state: player and enemy are loaded
        expect(fightRoom.state.player.playerId).toBe(playerId);
        expect(fightRoom.state.enemy.playerId).toBeDefined();
        expect(fightRoom.state.enemy.name).toBeDefined();
        expect(fightRoom.state.battleStarted).toBe(false);

        const goldAtFightStart = fightRoom.state.player.gold;
        const xpAtFightStart = fightRoom.state.player.xp;

        // 5. Wait for the (real-time, ~3.5s) countdown to expire and battle to begin
        await waitFor(() => fightRoom.state.battleStarted, { timeout: 8000, message: 'battle to start' });

        // 6. Wait for the battle to conclude AND for rewards to be applied — fightResult and
        // the gold/xp reward are set together, synchronously, in concludeBattle(). At
        // TEST_FIGHT_TIME_SCALE the worst case (the 65s game-time end-burn forced conclusion)
        // resolves in ~8s real time.
        await waitFor(
            () => !!fightRoom.state.fightResult && fightRoom.state.player.gold > goldAtFightStart,
            { timeout: 20000, interval: 100, message: 'battle to conclude and rewards to be applied' }
        );
        // player.income (used just below to recover the exact reward amount) is a derived stat
        // recalculated by UpdateStatsCommand on every simulation tick — polling this fast can
        // catch the tick where gold just changed but income hasn't been recomputed against the
        // post-reward baseStats.income yet. A short settle margin lets it catch up.
        await new Promise<void>(r => setTimeout(r, 300));

        // 7. Verify outcome
        expect([FightResultType.WIN, FightResultType.LOSE, FightResultType.DRAW]).toContain(fightRoom.state.fightResult);
        expect(fightRoom.state.battleStarted).toBe(false);

        // 8. Verify rewards were applied (gold and XP are higher than at battle start)
        // income is incremented by 1 after the reward is paid, so subtract 1 to get what was actually awarded
        const expectedGoldReward = fightRoom.state.player.income - 1;
        expect(fightRoom.state.player.gold).toBe(goldAtFightStart + expectedGoldReward);
        expect(fightRoom.state.player.xp).toBe(xpAtFightStart + initialRound * 2);

        await fightClient.leave(true)
    }, 30000);

    it("fight room: player HP decreases during combat", async () => {
        const { client: draftClient, playerId, playerToken } = await createAndJoinDraftRoom("HPChecker");

        draftClient.leave(true);

        const { fightRoom } = await createAndJoinFightRoom(playerId, playerToken);

        const playerMaxHp = fightRoom.state.player.maxHp;
        const enemyMaxHp = fightRoom.state.enemy.maxHp;

        await waitFor(() => fightRoom.state.battleStarted, { timeout: 8000, message: 'battle to start' });
        // At TEST_FIGHT_TIME_SCALE, the first attack lands well within a couple of game-seconds.
        await waitFor(
            () => fightRoom.state.player.hp < playerMaxHp || fightRoom.state.enemy.hp < enemyMaxHp,
            { timeout: 8000, message: 'either combatant to take damage' }
        );

        expect(fightRoom.state.battleStarted).toBe(true);
        const playerTookDamage = fightRoom.state.player.hp < playerMaxHp;
        const enemyTookDamage = fightRoom.state.enemy.hp < enemyMaxHp;
        expect(playerTookDamage || enemyTookDamage).toBe(true);
    }, 30000);

    it("fight room: win increments player wins, lose decrements player lives", async () => {
        const { client: draftClient, playerId, playerToken } = await createAndJoinDraftRoom("WinLoseChecker");

        draftClient.leave(true);

        const { fightRoom } = await createAndJoinFightRoom(playerId, playerToken);

        const winsAtStart = fightRoom.state.player.wins;
        const livesAtStart = fightRoom.state.player.lives;

        await waitFor(() => !!fightRoom.state.fightResult, { timeout: 20000, interval: 100, message: 'battle to conclude' });

        if (fightRoom.state.fightResult === FightResultType.WIN) {
            expect(fightRoom.state.player.wins).toBe(winsAtStart + 1);
            expect(fightRoom.state.player.lives).toBe(livesAtStart);
        } else if (fightRoom.state.fightResult === FightResultType.LOSE) {
            expect(fightRoom.state.player.lives).toBe(livesAtStart - 1);
            expect(fightRoom.state.player.wins).toBe(winsAtStart);
        } else {
            // Draw: no wins or lives change
            expect(fightRoom.state.player.wins).toBe(winsAtStart);
            expect(fightRoom.state.player.lives).toBe(livesAtStart);
        }
    }, 30000);
});
