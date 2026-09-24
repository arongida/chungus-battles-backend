import { ColyseusTestServer, boot } from "@colyseus/testing";
import { server } from '../src/app.config';
import { getNextPlayerId, getPlayer, playerModel } from "../src/players/db/Player";
import { generatePlayerToken, reservePlayerId } from "../src/players/db/PlayerToken";
import { FightResultType } from "../src/common/types";
import { BATTLE_CRY_SLOTS, DEFAULT_BATTLE_CRIES, EMOTES, isValidEmote, MAX_REACTIONS_PER_FIGHT, randomBattleCries, seededBattleCries } from "../src/social/emotes";
import { getPlayerSchemaObject } from "../src/players/db/Player";
import { buildOwnerProfile } from "../src/social/badges";
import { ghostEncounterModel } from "../src/social/db/GhostEncounter";
import mongoose from 'mongoose';
import { waitFor } from './helpers/waitFor';

// Pure catalog/profile logic — no DB needed.
describe("social: emote catalog", () => {
    it("every default and random battle cry is valid for its slot", () => {
        BATTLE_CRY_SLOTS.forEach(slot => expect(isValidEmote(DEFAULT_BATTLE_CRIES[slot], slot)).toBe(true));
        for (let i = 0; i < 50; i++) {
            const cries = randomBattleCries();
            BATTLE_CRY_SLOTS.forEach(slot => expect(isValidEmote(cries[slot], slot)).toBe(true));
        }
    });

    it("seeds stable, valid, varied lines for characters saved before battle cries existed", () => {
        for (let id = 1; id <= 50; id++) {
            const a = seededBattleCries(id);
            expect(seededBattleCries(id)).toEqual(a);
            BATTLE_CRY_SLOTS.forEach(slot => expect(isValidEmote(a[slot], slot)).toBe(true));
        }
        const greetings = new Set(Array.from({ length: 50 }, (_, i) => seededBattleCries(i + 1).greeting));
        expect(greetings.size).toBeGreaterThan(3);

        // A legacy doc (no battleCry* fields) loads with its seeded lines, the same for every
        // snapshot of that character; stored lines always win.
        const legacy = (playerId: number) => getPlayerSchemaObject({ playerId, originalPlayerId: 4242, name: 'Old', talents: [], inventory: [], lockedShop: [], equippedItems: {} });
        const seeded = seededBattleCries(4242);
        [legacy(4242), legacy(5000)].forEach(p => {
            expect(p.battleCryGreeting).toBe(seeded.greeting);
            expect(p.battleCryVictory).toBe(seeded.victory);
            expect(p.battleCryDefeat).toBe(seeded.defeat);
        });
        const chosen = getPlayerSchemaObject({ playerId: 1, originalPlayerId: 1, battleCryGreeting: 'greet_nap', talents: [], inventory: [], lockedShop: [], equippedItems: {} });
        expect(chosen.battleCryGreeting).toBe('greet_nap');
    });

    it("rejects wrong-slot, unknown, prototype and non-string ids", () => {
        expect(isValidEmote('react_wp', 'reaction')).toBe(true);
        expect(isValidEmote('react_wp', 'greeting')).toBe(false);
        expect(isValidEmote('greet_hello', 'reaction')).toBe(false);
        expect(isValidEmote('nope', 'reaction')).toBe(false);
        expect(isValidEmote('__proto__', 'reaction')).toBe(false);
        expect(isValidEmote('toString', 'reaction')).toBe(false);
        expect(isValidEmote(42, 'reaction')).toBe(false);
        expect(isValidEmote({ id: 'react_wp' }, 'reaction')).toBe(false);
    });

    it("has lines for every slot", () => {
        const slots = new Set(Object.values(EMOTES).map(e => e.slot));
        expect([...slots].sort()).toEqual(['defeat', 'greeting', 'reaction', 'victory']);
    });
});

describe("social: owner profile badges", () => {
    it("derives status and the highest run-ender tier", () => {
        expect(buildOwnerProfile({ playerId: 5, wins: 3, lives: 2, runsEnded: 0 })).toMatchObject({ status: 'fighting', badges: [] });
        expect(buildOwnerProfile({ playerId: 5, wins: 3, lives: 0, runsEnded: 1 })).toMatchObject({
            status: 'fallen', badges: [{ id: 'run_ender_1', label: 'Run Ender ×1' }],
        });
        expect(buildOwnerProfile({ playerId: 5, wins: 12, lives: 0, runsEnded: 12 }).badges).toEqual([
            { id: 'champion', label: 'Champion' },
            { id: 'run_ender_10', label: 'Run Ender ×12' },
        ]);
    });
});

// One boot() per file — two boot/shutdown cycles in the same Jest file is flaky (see bot.test.ts).
describe("social: rooms and REST", () => {
    let colyseus: ColyseusTestServer;

    beforeAll(async () => {
        await mongoose.connect(process.env.DB_CONNECTION_STRING!, { autoIndex: true });
        colyseus = await boot(server);
    });

    afterAll(async () => {
        await colyseus.shutdown();
        mongoose.disconnect();
    });

    afterEach(async () => {
        await colyseus.cleanup();
    });

    const SERVER_MESSAGES = [
        'attack', 'damage', 'healing', 'combat_log', 'trigger_talent', 'trigger_item', 'end_battle',
        'game_over', 'game_win', 'draft_log', 'shop_floating', 'reward_gain', 'invulnerable',
        'invulnerable_state', 'stunned_state', 'emote', 'loss_reward_result', 'message',
    ];

    async function mintPlayerIdAndToken() {
        const playerId = await getNextPlayerId();
        const playerToken = generatePlayerToken();
        await reservePlayerId(playerId, playerToken);
        return { playerId, playerToken };
    }

    async function joinDraft(name: string) {
        const { playerId, playerToken } = await mintPlayerIdAndToken();
        const room = await colyseus.createRoom("draft_room", {});
        const client = await colyseus.connectTo(room, { playerId, playerToken, name, avatarUrl: "assets/warrior_01.png" });
        const errors: string[] = [];
        const quips: string[] = [];
        SERVER_MESSAGES.forEach(type => client.onMessage(type, () => {}));
        client.onMessage('error', (msg: string) => errors.push(msg));
        client.onMessage('quip', (msg: { trigger: string }) => quips.push(msg.trigger));
        await waitFor(() => room.state.shop.length > 0, { timeout: 5000, message: 'draft room shop to populate' });
        return { room, client, playerId, playerToken, errors, quips };
    }

    async function joinFight(playerId: number, playerToken: string, enemyPlayerId?: number) {
        await waitFor(async () => {
            const player = await getPlayer(playerId);
            return !player || player.sessionId === '';
        }, { timeout: 15000, interval: 100, message: `player ${playerId}'s session to clear` });
        const fightRoom = await colyseus.createRoom("fight_room", {});
        (fightRoom as any).state.timeScale = 8;
        (fightRoom as any).applySimulationResolution(8);
        const fightClient = await colyseus.connectTo(fightRoom, { playerId, playerToken, enemyPlayerId });
        const errors: string[] = [];
        SERVER_MESSAGES.forEach(type => fightClient.onMessage(type, () => {}));
        fightClient.onMessage('error', (msg: string) => errors.push(msg));
        await waitFor(() => !!fightRoom.state.enemy?.name, { timeout: 8000, message: 'fight room enemy to load' });
        return { fightRoom, fightClient, errors };
    }

    const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

    // waitFor, but hands back the first truthy value (e.g. a doc once it's been written).
    async function waitForValue<T>(fn: () => Promise<T>, opts: { timeout?: number; message?: string }): Promise<T> {
        let value: T;
        await waitFor(async () => !!(value = await fn()), { interval: 100, ...opts });
        return value;
    }

    it("battle cries: rejects invalid picks, persists valid ones onto the matchmaking snapshot, and ghosts speak them in fights", async () => {
        // --- Ghost owner: set a custom greeting, leave -> copyPlayer writes a snapshot. ---
        const owner = await joinDraft("Ghost Owner");
        // New characters start with a random (valid) set of lines.
        const startGreeting = owner.room.state.player.battleCryGreeting;
        expect(isValidEmote(startGreeting, 'greeting')).toBe(true);
        expect(isValidEmote(owner.room.state.player.battleCryDefeat, 'defeat')).toBe(true);

        owner.client.send('set_battle_cry', { slot: 'greeting', emoteId: 'react_wp' }); // reaction id in a cry slot
        owner.client.send('set_battle_cry', { slot: 'reaction', emoteId: 'react_wp' }); // not a cry slot
        await waitFor(() => owner.errors.length === 2, { message: 'both invalid picks to be rejected' });
        expect(owner.room.state.player.battleCryGreeting).toBe(startGreeting);

        owner.client.send('set_battle_cry', { slot: 'greeting', emoteId: 'greet_lunch' });
        owner.client.send('set_battle_cry', { slot: 'defeat', emoteId: 'lose_remember' });
        // Wait on both: the random starting set may already contain either line.
        await waitFor(() => owner.room.state.player.battleCryDefeat === 'lose_remember'
            && owner.room.state.player.battleCryGreeting === 'greet_lunch', { message: 'valid picks to apply' });

        await owner.client.leave(true);
        const snapshot = await waitForValue(async () => playerModel.findOne(
            { originalPlayerId: owner.playerId, playerId: { $ne: owner.playerId } },
        ).lean(), { timeout: 10000, message: 'owner snapshot to be written' }) as any;
        expect(snapshot.battleCryGreeting).toBe('greet_lunch');
        expect(snapshot.battleCryDefeat).toBe('lose_remember');

        // --- Challenger fights that snapshot (dev-only enemy override). ---
        const challenger = await joinDraft("Challenger");
        const challengerCries = {
            greeting: challenger.room.state.player.battleCryGreeting,
            defeat: challenger.room.state.player.battleCryDefeat,
        };
        await challenger.client.leave(true);
        const { fightRoom, fightClient, errors } = await joinFight(challenger.playerId, challenger.playerToken, snapshot.playerId);
        expect(fightRoom.state.enemy.originalPlayerId).toBe(owner.playerId);
        // Owner profile is published for the nameplate.
        expect(JSON.parse(fightRoom.state.enemyOwnerJson)).toMatchObject({ originalPlayerId: owner.playerId, status: 'fighting' });

        await waitFor(() => fightRoom.state.battleStarted, { timeout: 8000, message: 'battle to start' });
        const recorder = (fightRoom as any).recorder;
        expect(recorder.initialState.enemyOwner).toMatchObject({ originalPlayerId: owner.playerId });

        // Reactions: non-reaction id rejected; first valid one broadcast; an immediate second is
        // dropped by the cooldown.
        fightClient.send('emote', { emoteId: 'greet_hello' });
        await waitFor(() => errors.length === 1, { message: 'non-reaction emote to be rejected' });
        fightClient.send('emote', { emoteId: 'react_wp' });
        await waitFor(() => (fightRoom as any).sentReactions.length === 1, { message: 'reaction to be accepted' });
        fightClient.send('emote', { emoteId: 'react_wow' });
        await sleep(300);
        expect((fightRoom as any).sentReactions).toEqual(['react_wp']);

        await waitFor(() => !!fightRoom.state.fightResult, { timeout: 20000, interval: 100, message: 'battle to conclude' });

        // Replay stream carries both greetings, the reaction, and the result lines.
        const emotes = recorder.events.filter((e: any) => e.type === 'emote').map((e: any) => e.payload);
        expect(emotes).toEqual(expect.arrayContaining([
            { playerId: snapshot.playerId, emoteId: 'greet_lunch', kind: 'cry' },
            { playerId: challenger.playerId, emoteId: challengerCries.greeting, kind: 'cry' },
            expect.objectContaining({ playerId: challenger.playerId, emoteId: 'react_wp', kind: 'reaction' }),
        ]));
        const result = fightRoom.state.fightResult;
        // One-bubble-at-a-time on the client relies on the local player's line coming first.
        const cries = emotes.filter((e: any) => e.kind === 'cry');
        expect(cries[0].playerId).toBe(challenger.playerId); // greetings
        if (result !== FightResultType.DRAW) expect(cries[2].playerId).toBe(challenger.playerId); // end lines
        if (result === FightResultType.WIN) {
            expect(emotes).toContainEqual({ playerId: snapshot.playerId, emoteId: 'lose_remember', kind: 'cry' });
        } else if (result === FightResultType.LOSE) {
            expect(emotes).toContainEqual({ playerId: challenger.playerId, emoteId: challengerCries.defeat, kind: 'cry' });
        }

        // Ghost encounter written from the ghost's point of view, carrying the reaction.
        const replayId = (fightRoom as any).replayId;
        const encounter = await waitForValue(async () => ghostEncounterModel.findOne({ replayId }).lean(),
            { timeout: 5000, message: 'ghost encounter to be saved' }) as any;
        expect(encounter.ownerOriginalPlayerId).toBe(owner.playerId);
        expect(encounter.opponentOriginalPlayerId).toBe(challenger.playerId);
        expect(encounter.result).toBe(result === FightResultType.WIN ? 'lose' : result === FightResultType.LOSE ? 'win' : 'draw');
        expect(encounter.endedRun).toBe(false); // first loss can't end a 5-life warrior's run
        expect(encounter.emotes).toEqual(['react_wp']);

        // A post-fight "GG" is appended to the same encounter.
        (fightRoom as any).lastReactionAt = -Infinity;
        fightClient.send('emote', { emoteId: 'react_gg' });
        await waitFor(async () => (await ghostEncounterModel.findOne({ replayId }).lean())?.emotes?.length === 2,
            { timeout: 5000, message: 'post-fight reaction to be appended' });

        // Per-fight cap.
        for (let i = 0; i < MAX_REACTIONS_PER_FIGHT + 2; i++) {
            (fightRoom as any).lastReactionAt = -Infinity;
            fightClient.send('emote', { emoteId: 'react_thanks' });
            await sleep(50);
        }
        await sleep(200);
        expect((fightRoom as any).sentReactions.length).toBe(MAX_REACTIONS_PER_FIGHT);

        // --- REST: the owner reads the report with their token; a wrong token is refused. ---
        const { data: report } = await colyseus.http.post('/ghostReport', {
            body: { playerId: owner.playerId, playerToken: owner.playerToken },
        } as any);
        expect(report.summary.fights).toBe(1);
        expect(report.encounters[0]).toMatchObject({ replayId, opponentName: 'Challenger' });
        expect(report.encounters[0].ownerOriginalPlayerId).toBeUndefined();
        expect(report.summary.emotes.react_wp).toBe(1);

        await expect(colyseus.http.post('/ghostReport', {
            body: { playerId: owner.playerId, playerToken: 'wrong' },
        } as any)).rejects.toMatchObject({ statusCode: 401 });

        const future = new Date(Date.now() + 60_000).toISOString();
        const { data: counts } = await colyseus.http.post('/ghostReportCounts', {
            body: {
                runs: [
                    { playerId: owner.playerId, playerToken: owner.playerToken },
                    { playerId: challenger.playerId, playerToken: challenger.playerToken, since: future },
                    { playerId: owner.playerId, playerToken: 'wrong' },
                ],
            },
        } as any);
        expect(counts).toEqual({ [owner.playerId]: 1, [challenger.playerId]: 0 });

        await fightClient.leave(true);
    }, 60000);

    it("shop quips: a successful buy and a broke reroll each send a quip trigger", async () => {
        const p = await joinDraft("Quipper");
        const item = p.room.state.shop.find((i: any) => i.price <= p.room.state.player.gold);
        p.client.send('buy', { itemId: item.itemId });
        await waitFor(() => p.quips.includes('buy'), { message: 'buy quip' });

        p.room.state.player.gold = 0;
        (p.room.state.player as any).freeRerolls = false;
        p.room.state.player.freeRerollCharges = 0;
        p.client.send('refresh_shop');
        await waitFor(() => p.quips.includes('broke'), { message: 'broke quip' });
        expect(p.quips).not.toContain('reroll');
        await p.client.leave(true);
    });

    it("fighting Joe writes no ghost encounter", async () => {
        const challenger = await joinDraft("Joe Fighter");
        await challenger.client.leave(true);
        const { fightRoom, fightClient } = await joinFight(challenger.playerId, challenger.playerToken);
        expect(fightRoom.state.enemy.name).toBe('Joe');
        expect(fightRoom.state.enemyOwnerJson).toBe('');
        await waitFor(() => !!fightRoom.state.fightResult, { timeout: 25000, interval: 100, message: 'battle to conclude' });
        await sleep(500);
        expect(await ghostEncounterModel.countDocuments({ replayId: (fightRoom as any).replayId })).toBe(0);
        await fightClient.leave(true);
    }, 45000);
});
