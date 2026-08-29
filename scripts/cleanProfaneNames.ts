// One-off cleanup for player names that predate the profanity filter added to DraftRoom.onJoin
// (see src/common/profanity.ts). There is no rename flow in the game, so an offensive name once
// created is permanent until fixed here — and it has already been cloned by copyPlayer() into
// every round's matchmaking snapshot (same originalPlayerId, different playerId), so this renames
// the whole character group, not just the one matched document, and also scrubs the name out of
// replay list fields and the combat_log text embedded in replay events.
//
// Dry run (default) — prints what would change, writes nothing:
//   npx tsx scripts/cleanProfaneNames.ts
// Apply:
//   npx tsx scripts/cleanProfaneNames.ts --apply
import mongoose from 'mongoose';
import { playerModel } from '../src/players/db/Player';
import { replayModel } from '../src/replay/db/Replay';
import { isNameClean } from '../src/common/profanity';

const APPLY = process.argv.includes('--apply');

// Recursively replaces exact occurrences of `oldName` with `newName` inside every string found
// in a Mongoose Mixed value (replay event payloads are arbitrary objects — combat_log entries
// carry the name inside a `text` field, but other event kinds could reference it too).
function replaceNameDeep(value: any, oldName: string, newName: string): { value: any; changed: boolean } {
    if (typeof value === 'string') {
        if (!value.includes(oldName)) return { value, changed: false };
        return { value: value.split(oldName).join(newName), changed: true };
    }
    if (Array.isArray(value)) {
        let changed = false;
        const next = value.map((item) => {
            const result = replaceNameDeep(item, oldName, newName);
            if (result.changed) changed = true;
            return result.value;
        });
        return { value: changed ? next : value, changed };
    }
    if (value && typeof value === 'object') {
        let changed = false;
        const next: any = {};
        for (const [key, item] of Object.entries(value)) {
            const result = replaceNameDeep(item, oldName, newName);
            if (result.changed) changed = true;
            next[key] = result.value;
        }
        return { value: changed ? next : value, changed };
    }
    return { value, changed: false };
}

async function main() {
    const connectionString = process.env.DB_CONNECTION_STRING;
    if (!connectionString) {
        console.error('DB_CONNECTION_STRING env var is required');
        process.exit(1);
    }

    await mongoose.connect(connectionString);
    console.log('Connected to MongoDB');
    console.log(APPLY ? 'Mode: APPLY (writing changes)' : 'Mode: DRY RUN (pass --apply to write)');

    const players = await playerModel
        .find({}, { playerId: 1, originalPlayerId: 1, name: 1 })
        .lean();

    const dirty = players.filter((p) => p.name && !isNameClean(p.name));
    console.log(`Scanned ${players.length} player documents, found ${dirty.length} with a flagged name.`);

    // Group by originalPlayerId so every snapshot of the same character gets the same
    // replacement name, and pick one deterministic replacement name per character.
    const byOriginalId = new Map<number, { originalPlayerId: number; sampleName: string }>();
    for (const p of dirty) {
        const originalPlayerId = p.originalPlayerId ?? p.playerId;
        if (!byOriginalId.has(originalPlayerId)) {
            byOriginalId.set(originalPlayerId, { originalPlayerId, sampleName: p.name });
        }
    }

    for (const { originalPlayerId, sampleName } of byOriginalId.values()) {
        const newName = `Player${originalPlayerId}`;
        console.log(`\noriginalPlayerId=${originalPlayerId}: "${sampleName}" -> "${newName}"`);

        if (!APPLY) continue;

        const playerUpdate = await playerModel.updateMany(
            { originalPlayerId },
            { $set: { name: newName } },
        );
        console.log(`  players: matched ${playerUpdate.matchedCount}, modified ${playerUpdate.modifiedCount}`);

        const replayPlayerNameUpdate = await replayModel.updateMany(
            { originalPlayerId, playerName: sampleName },
            { $set: { playerName: newName } },
        );
        console.log(`  replays.playerName: matched ${replayPlayerNameUpdate.matchedCount}, modified ${replayPlayerNameUpdate.modifiedCount}`);

        // enemyName isn't scoped by originalPlayerId (it's the *other* side of the fight), so
        // match on the name text directly.
        const replayEnemyNameUpdate = await replayModel.updateMany(
            { enemyName: sampleName },
            { $set: { enemyName: newName } },
        );
        console.log(`  replays.enemyName: matched ${replayEnemyNameUpdate.matchedCount}, modified ${replayEnemyNameUpdate.modifiedCount}`);

        // Scrub the name out of combat_log (and any other) text embedded in replay events.
        // Skip pruned replays — their events/initialState were already stripped.
        const affectedReplays = await replayModel.find(
            { $or: [{ playerName: newName }, { enemyName: newName }], pruned: { $ne: true } },
            { events: 1 },
        );
        let eventsTouched = 0;
        for (const replay of affectedReplays) {
            const result = replaceNameDeep(replay.events, sampleName, newName);
            if (result.changed) {
                replay.events = result.value;
                await replay.save();
                eventsTouched++;
            }
        }
        console.log(`  replay event payloads updated: ${eventsTouched}`);
    }

    console.log(`\n${APPLY ? 'Done.' : 'Dry run complete — re-run with --apply to write these changes.'}`);
    await mongoose.disconnect();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
