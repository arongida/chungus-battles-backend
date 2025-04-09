import { ColyseusTestServer, boot } from "@colyseus/testing";
import appConfig from "../src/app.config";
import { getNextPlayerId } from "../src/players/db/Player";
import mongoose from 'mongoose';

describe("testing your Colyseus app", () => {
    let colyseus: ColyseusTestServer;

    beforeAll(async () => {

        await mongoose.connect(process.env.DB_CONNECTION_STRING!, {
            autoIndex: true,
        });

        colyseus = await boot(appConfig);
    });

    afterAll(async () => {
        await colyseus.shutdown();
        mongoose.disconnect();
    });

    beforeEach(async () => {
        await colyseus.cleanup();
    });

    it("connecting into a room and creating a new player, buy an item and select a talent", async () => {

        const mockOptions = {
            playerId: await getNextPlayerId(), // Example player ID
            name: "Mocked Player", // Example player name
            avatarUrl: "mocked_avatar_url", // Optional avatar URL
        };

        // Use `createRoom` to simulate creating a room instance on the server
        const room = await colyseus.createRoom("draft_room", {}); // createRoom("draft_room", {}) creates a new DraftRoom

        // Simulate client joining the room with `onJoin` method
        const client1 = await colyseus.connectTo(room, mockOptions);

        const selectedItemId = room.state.shop[0].itemId;
        const selectedTalentId = room.state.availableTalents[0].talentId;

        client1.send('buy', {
            itemId: selectedItemId,
        });
        await new Promise<void>((resolve) => setTimeout(resolve, 100));

        client1.send('select_talent', {
            talentId: selectedTalentId
        });
        await new Promise<void>((resolve) => setTimeout(resolve, 100));

        expect(client1.sessionId).toEqual(room.clients[0].sessionId);
        expect(room.state.player.inventory.length).toBe(1);
        expect(room.state.player.talents.length).toBe(1);
    });
});
