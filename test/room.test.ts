import { ColyseusTestServer, boot } from "@colyseus/testing";
// import your "app.config.ts" file here.
import appConfig from "../src/app.config";
import { createNewPlayer} from "../src/players/db/Player";
import { Client } from 'colyseus';
import { ArraySchema, MapSchema } from "@colyseus/schema";
import { AffectedStats } from "../src/common/schema/AffectedStatsSchema";

jest.mock('../src/players/db/Player', () => ({
    getPlayer: jest.fn().mockResolvedValue(null),
    createNewPlayer: jest.fn()
}));

describe("testing your Colyseus app", () => {
    let colyseus: ColyseusTestServer;

    beforeAll(async () => colyseus = await boot(appConfig));

    afterAll(async () => {
        await colyseus.shutdown()
        jest.clearAllMocks();
    });

    beforeEach(async () => {
        await colyseus.cleanup();
    });

    it("connecting into a room", async () => {

        const mockOptions = {
            playerId: 123, // Example player ID
            name: "Mocked Player", // Example player name
            avatarUrl: "mocked_avatar_url", // Optional avatar URL
        };

        const talentsArray = new ArraySchema();

        (createNewPlayer as jest.Mock).mockResolvedValue({
            playerId: 123,
            originalPlayerId: 123,
            name: "Mocked Player",
            sessionId: "mocked_session_id",
            talents: talentsArray,  // Use real ArraySchema here
            inventory: new ArraySchema(), // Real ArraySchema for inventory
            lockedShop: new ArraySchema(),
            equippedItems: new MapSchema(), // Real MapSchema for equippedItems
            dodgeRate: 0,
            refreshShopCost: 2,
            maxHp: 100,
            _hp: 100,
            baseStats: new AffectedStats ({
                strength: 3,
                accuracy: 1,
                maxHp: 100,
                defense: 0,
                attackSpeed: 0.8,
                flatDmgReduction: 0,
                dodgeRate: 0,
                income: 0,
                hpRegen: 0,
            }),
            damage: 0,
            attackTimer: {},
            poisonTimer: {},
            regenTimer: {},
            invincibleTimer: {},
            talentsOnCooldown: [],
            invincible: false,
            rewardRound: 1,
        });

        // Use `createRoom` to simulate creating a room instance on the server
        const room = await colyseus.createRoom("draft_room", {}); // createRoom("draft_room", {}) creates a new DraftRoom

        room.state.remainingTalentPoints = 1;
        // Simulate client joining the room with `onJoin` method
        const mockClient = { sessionId: "mocked_session_id" } as Client;  // Mock client with a sessionId

        if (room.onJoin) {
            await room.onJoin(mockClient, mockOptions); // Call onJoin with the mocked client and options
        } else {
            throw new Error("onJoin method is not defined in the room");
        }

        // You can check that the room state is set up correctly after onJoin is triggered
        expect(createNewPlayer).toHaveBeenCalledWith(mockOptions.playerId, mockOptions.name, mockClient.sessionId, mockOptions.avatarUrl);
        expect(room.state.player).toBeDefined();
        expect(room.state.remainingTalentPoints).toEqual(1); // Assuming your room initializes talent points
    });
});