import { ColyseusTestServer, boot } from "@colyseus/testing";
// import your "app.config.ts" file here.
import appConfig from "../src/app.config";
import {getNextPlayerId } from "../src/players/db/Player";
import mongoose from 'mongoose';

/*jest.mock('../src/players/db/Player', () => ({
    getPlayer: jest.fn().mockResolvedValue(null),
    createNewPlayer: jest.fn()
}));*/

describe("testing your Colyseus app", () => {
    let colyseus: ColyseusTestServer;

    beforeAll(async () => {
        console.log(process.env.DB_CONNECTION_STRING);
        await mongoose.connect(process.env.DB_CONNECTION_STRING!, {
            autoIndex: true,
        });

        colyseus = await boot(appConfig)
    });

    afterAll(async () => {
        await colyseus.shutdown();
        mongoose.disconnect();
    });

    beforeEach(async () => {
        await colyseus.cleanup();
    });

    it("connecting into a room and creating a new player", async () => {

        const mockOptions = {
            playerId: await getNextPlayerId(), // Example player ID
            name: "Mocked Player", // Example player name
            avatarUrl: "mocked_avatar_url", // Optional avatar URL
        };

        // Use `createRoom` to simulate creating a room instance on the server
        const room = await colyseus.createRoom("draft_room", {}); // createRoom("draft_room", {}) creates a new DraftRoom

        // Simulate client joining the room with `onJoin` method
        const client1 = await colyseus.connectTo(room, mockOptions);
        expect(client1.sessionId).toEqual(room.clients[0].sessionId);
        // You can check that the room state is set up correctly after onJoin is triggered
        //expect(createNewPlayer).toHaveBeenCalledWith(mockOptions.playerId, mockOptions.name, mockClient.sessionId, mockOptions.avatarUrl);
        //expect(room.state.player).toBeDefined();
        //expect(room.state.remainingTalentPoints).toEqual(1); // Assuming your room initializes talent points
    });
});
