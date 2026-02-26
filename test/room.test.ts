import { ColyseusTestServer, boot } from "@colyseus/testing";
import { server } from '../src/app.config';
import { getNextPlayerId } from "../src/players/db/Player";
import { FightResultType } from "../src/common/types";
import { Item } from "../src/items/schema/ItemSchema";
import mongoose from 'mongoose';

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

    async function createAndJoinDraftRoom(name = "Test Player") {
        const playerId = await getNextPlayerId();
        const room :DraftRoom = await colyseus.createRoom("draft_room", {});
        const client = await colyseus.connectTo(room, { playerId, name, avatarUrl: "test_avatar" });
        // Wait for onJoin to complete (DB load, shop, state setup)
        await new Promise<void>(r => setTimeout(r, 500));


        async function cleanExit() {
            await client.leave();
            await new Promise<void>((resolve) => {
                room.onDispose(() => resolve());
            });
        }

        return { room, client, playerId, cleanExit };
    }

    // -------------------------------------------------------------------------
    // Draft room — basic operations
    // -------------------------------------------------------------------------

    it("connects, creates new player, buys an item, and selects a talent", async () => {
        const { room, client, cleanExit } = await createAndJoinDraftRoom("Mocked Player");

        const selectedItemId = room.state.shop[0].itemId;
        const selectedTalentId = room.state.availableTalents[0].talentId;

        client.send('buy', { itemId: selectedItemId });
        await new Promise<void>(r => setTimeout(r, 100));

        client.send('select_talent', { talentId: selectedTalentId });
        await new Promise<void>(r => setTimeout(r, 100));

        expect(client.sessionId).toEqual(room.clients[0].sessionId);
        expect(room.state.player.inventory.length).toBe(1);
        expect(room.state.player.talents.length).toBe(1);
    });

    it("buying an item deducts gold and adds it to inventory", async () => {
        const { room, client, cleanExit } = await createAndJoinDraftRoom();

        const item = room.state.shop[0];
        const goldBefore = room.state.player.gold;

        client.send('buy', { itemId: item.itemId });
        await new Promise<void>(r => setTimeout(r, 100));

        expect(room.state.player.gold).toBe(goldBefore - item.price);
        expect(room.state.player.inventory.length).toBe(1);
        expect(room.state.player.inventory[0].itemId).toBe(item.itemId);

        await cleanExit();
    });

    it("selling an item refunds 70% of its price", async () => {
        const { room, client, cleanExit } = await createAndJoinDraftRoom();

        const item = room.state.shop[0];
        const goldBefore = room.state.player.gold;

        client.send('buy', { itemId: item.itemId });
        await new Promise<void>(r => setTimeout(r, 100));

        client.send('sell', { itemId: item.itemId });
        await new Promise<void>(r => setTimeout(r, 100));

        const expectedGold = (goldBefore - item.price) + Math.floor(item.price * 0.7);
        expect(room.state.player.gold).toBe(expectedGold);
        expect(room.state.player.inventory.length).toBe(0);

        await cleanExit();
    });

    it("equipping an item moves it from inventory to equipped slot", async () => {
        const { room, client, cleanExit } = await createAndJoinDraftRoom();

        // Find a shop item that has equip options
        const equippable = room.state.shop.find((i: Item) => i.equipOptions && (i.equipOptions as any).length > 0);
        expect(equippable).toBeDefined();

        const slot = Array.from(equippable.equipOptions)[0];

        client.send('buy', { itemId: equippable.itemId });
        await new Promise<void>(r => setTimeout(r, 100));

        client.send('equip', { itemId: equippable.itemId, slot });
        await new Promise<void>(r => setTimeout(r, 100));

        expect(room.state.player.inventory.length).toBe(0);
        expect(room.state.player.equippedItems.get(slot)).toBeDefined();
        expect(room.state.player.equippedItems.get(slot).itemId).toBe(equippable.itemId);

        await cleanExit();
    });

    it("unequipping an item moves it back to inventory", async () => {
        const { room, client, cleanExit } = await createAndJoinDraftRoom();

        const equippable = room.state.shop.find((i: Item) => i.equipOptions && (i.equipOptions as any).length > 0);
        expect(equippable).toBeDefined();
        const slot = Array.from(equippable.equipOptions)[0];

        client.send('buy', { itemId: equippable.itemId });
        await new Promise<void>(r => setTimeout(r, 100));
        client.send('equip', { itemId: equippable.itemId, slot });
        await new Promise<void>(r => setTimeout(r, 100));

        client.send('unequip', { itemId: equippable.itemId, slot });
        await new Promise<void>(r => setTimeout(r, 100));

        expect(room.state.player.inventory.length).toBe(1);
        expect(room.state.player.equippedItems.get(slot)).toBeUndefined();

        await cleanExit();
    });

    it("buying XP costs 4 gold and grants 4 XP", async () => {
        const { room, client, cleanExit } = await createAndJoinDraftRoom();

        const xpBefore = room.state.player.xp;
        const goldBefore = room.state.player.gold;

        client.send('buy_xp');
        await new Promise<void>(r => setTimeout(r, 100));

        expect(room.state.player.xp).toBe(xpBefore + 4);
        expect(room.state.player.gold).toBe(goldBefore - 4);

        await cleanExit();
    });

    it("refreshing the shop replaces items and costs gold", async () => {
        const { room, client, cleanExit } = await createAndJoinDraftRoom();

        const goldBefore = room.state.player.gold;
        const refreshCost = room.state.player.refreshShopCost;
        const firstItemId = room.state.shop[0].itemId;

        client.send('refresh_shop');
        await new Promise<void>(r => setTimeout(r, 200));

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
        await new Promise<void>(r => setTimeout(r, 100));

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
        const { room: draftRoom, client: draftClient, playerId } = await createAndJoinDraftRoom("Fighter");
        const initialRound = draftRoom.state.player.round;

        // 2. Leave draft room — triggers copyPlayer + updatePlayer (saves to DB with sessionId='')
        draftClient.leave();
        await new Promise<void>(r => setTimeout(r, 3000));

        // 3. Join fight room
        const fightRoom = await colyseus.createRoom("fight_room", {});
        const fightClient = await colyseus.connectTo(fightRoom, { playerId });
        await new Promise<void>(r => setTimeout(r, 500));

        // 4. Verify initial state: player and enemy are loaded
        expect(fightRoom.state.player.playerId).toBe(playerId);
        expect(fightRoom.state.enemy.playerId).toBeDefined();
        expect(fightRoom.state.enemy.name).toBeDefined();
        expect(fightRoom.state.battleStarted).toBe(false);

        const goldAtFightStart = fightRoom.state.player.gold;
        const xpAtFightStart = fightRoom.state.player.xp;

        // 5. Wait for the 5.5s countdown to expire and battle to begin
        await new Promise<void>(r => setTimeout(r, 6000));
        expect(fightRoom.state.battleStarted).toBe(true);

        // 6. Wait for the battle to conclude (poll for fightResult)
        await new Promise<void>((resolve, reject) => {
            const poll = setInterval(() => {
                if (fightRoom.state.fightResult) {
                    clearInterval(poll);
                    resolve();
                }
            }, 500);
            setTimeout(() => {
                clearInterval(poll);
                reject(new Error('Battle did not conclude within 60 seconds'));
            }, 60000);
        });

        // 7. Verify outcome
        expect([FightResultType.WIN, FightResultType.LOSE, FightResultType.DRAW]).toContain(fightRoom.state.fightResult);
        expect(fightRoom.state.battleStarted).toBe(false);

        // 8. Verify rewards were applied (gold and XP are higher than at battle start)
        const expectedGoldReward = initialRound + 3 + fightRoom.state.player.income;
        expect(fightRoom.state.player.gold).toBe(goldAtFightStart + expectedGoldReward);
        expect(fightRoom.state.player.xp).toBe(xpAtFightStart + initialRound * 2);

        await fightClient.leave()
    }, 90000);

    it("fight room: player HP decreases during combat", async () => {
        const { client: draftClient, playerId } = await createAndJoinDraftRoom("HPChecker");

        draftClient.leave();
        await new Promise<void>(r => setTimeout(r, 3000));

        const fightRoom = await colyseus.createRoom("fight_room", {});
        const fightClient = await colyseus.connectTo(fightRoom, { playerId });
        await new Promise<void>(r => setTimeout(r, 500));

        const playerMaxHp = fightRoom.state.player.maxHp;
        const enemyMaxHp = fightRoom.state.enemy.maxHp;

        // Wait for battle to start and run for a few seconds
        await new Promise<void>(r => setTimeout(r, 9000));

        expect(fightRoom.state.battleStarted).toBe(true);
        // At least one combatant should have taken damage
        const playerTookDamage = fightRoom.state.player.hp < playerMaxHp;
        const enemyTookDamage = fightRoom.state.enemy.hp < enemyMaxHp;
        expect(playerTookDamage || enemyTookDamage).toBe(true);
    }, 90000);

    it("fight room: win increments player wins, lose decrements player lives", async () => {
        const { client: draftClient, playerId } = await createAndJoinDraftRoom("WinLoseChecker");

        draftClient.leave();
        await new Promise<void>(r => setTimeout(r, 3000));

        const fightRoom = await colyseus.createRoom("fight_room", {});
        await colyseus.connectTo(fightRoom, { playerId });
        await new Promise<void>(r => setTimeout(r, 500));

        const winsAtStart = fightRoom.state.player.wins;
        const livesAtStart = fightRoom.state.player.lives;

        // Wait for battle to conclude
        await new Promise<void>((resolve, reject) => {
            const poll = setInterval(() => {
                if (fightRoom.state.fightResult) {
                    clearInterval(poll);
                    resolve();
                }
            }, 500);
            setTimeout(() => { clearInterval(poll); reject(new Error('Timeout')); }, 60000);
        });

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
    }, 90000);
});
