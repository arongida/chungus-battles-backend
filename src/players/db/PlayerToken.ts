import mongoose, { Schema } from 'mongoose';
import { randomBytes, createHash, timingSafeEqual } from 'crypto';
import { playerModel } from './Player';

// Separate from the `players` collection on purpose: a playerId is reserved here (by /playerid)
// *before* any player document exists for it — DraftRoom.onJoin only creates the real player doc
// lazily, the first time someone actually joins with that id. Only the hash is stored, never the
// token itself.
const PlayerTokenSchema = new Schema({
    playerId: { type: Number, unique: true },
    tokenHash: String,
}, { timestamps: true });

const playerTokenModel = mongoose.model('PlayerToken', PlayerTokenSchema);

export function generatePlayerToken(): string {
    return randomBytes(32).toString('hex');
}

function hashPlayerToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}

/** Called once, by /playerid, right after a playerId is minted — records who's allowed to claim
 *  it later (see authenticatePlayerId). */
export async function reservePlayerId(playerId: number, token: string): Promise<void> {
    await playerTokenModel.updateOne(
        { playerId },
        { $set: { tokenHash: hashPlayerToken(token) } },
        { upsert: true },
    );
}

/** Validates a join's {playerId, playerToken}. Throws (rejecting the join, via onAuth on
 *  DraftRoom/FightRoom) rather than returning false, so the thrown message reaches the client.
 *
 *  Three cases:
 *   1. A token was reserved for this id (minted via /playerid, post-auth-rollout) — the provided
 *      token must match its hash.
 *   2. No token was ever reserved, but a real player document already exists for this id — a
 *      character from before token auth existed. Grandfathered through: allowed without a token.
 *      Self-expiring, since every character is tied to a season and new characters always get a
 *      token going forward — once the current season rolls over this branch stops being reachable.
 *   3. No token, no existing document — nobody ever reserved this id. Rejected. This is what
 *      closes the "getNextPlayerId poisoning" hole: previously a client could join with an
 *      arbitrary huge integer as playerId and DraftRoom.onJoin would happily create a new
 *      character at that id, permanently corrupting the sequential id space every future
 *      /playerid call depends on. Now DraftRoom.onJoin's create-new-player branch is only ever
 *      reachable for an id this function has already validated was actually reserved. */
export async function authenticatePlayerId(playerId: unknown, providedToken: unknown): Promise<number> {
    const id = Number(playerId);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid player ID');

    const tokenRecord = await playerTokenModel.findOne({ playerId: id }).lean();
    if (tokenRecord) {
        const expectedBuf = Buffer.from(tokenRecord.tokenHash, 'hex');
        const providedBuf = Buffer.from(hashPlayerToken(String(providedToken ?? '')), 'hex');
        if (expectedBuf.length !== providedBuf.length || !timingSafeEqual(expectedBuf, providedBuf)) {
            throw new Error('Invalid player token');
        }
        return id;
    }

    const hasExistingPlayer = await playerModel.exists({ playerId: id });
    if (hasExistingPlayer) return id; // LEGACY — see case 2 above

    throw new Error('Invalid player ID'); // case 3 above
}
