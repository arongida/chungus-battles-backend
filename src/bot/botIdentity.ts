/**
 * Mints the identity a bot character joins as — a real {playerId, playerToken} pair (so the
 * character is indistinguishable from a human one at the auth/DB layer — see
 * players/db/PlayerToken.ts's onAuth model) plus a name and avatar for display.
 */
import { getNextPlayerId } from '../players/db/Player';
import { generatePlayerToken, reservePlayerId } from '../players/db/PlayerToken';
import { isNameClean } from '../common/profanity';
import { PlayerAvatar } from '../players/types/PlayerTypes';

// Deliberately plain, readable words — bots are meant to look like ordinary characters on the
// leaderboard (the isBot flag is the discriminator, not the name), and every combination below
// is verified clean against isNameClean in test/botIdentity.test.ts.
const ADJECTIVES = [
    'Bold', 'Brave', 'Clever', 'Cunning', 'Daring', 'Eager', 'Fierce', 'Gritty', 'Hardy', 'Iron',
    'Lucky', 'Mighty', 'Nimble', 'Plucky', 'Quick', 'Rowdy', 'Sturdy', 'Swift', 'Tough', 'Wily',
];
const NOUNS = [
    'Badger', 'Falcon', 'Goblin', 'Hawk', 'Hound', 'Jackal', 'Knight', 'Lynx', 'Otter', 'Panther',
    'Raven', 'Ronin', 'Sparrow', 'Tiger', 'Viper', 'Wolf', 'Wombat', 'Yak', 'Zealot', 'Badgerling',
];

function randomFrom<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
}

/** A short, ordinary-looking display name — capped at 24 chars to match DraftRoom.onJoin's own
 *  truncation (DraftRoom.ts:146), though every generated combination is already well under it. */
export function generateBotName(): string {
    const name = `${randomFrom(ADJECTIVES)} ${randomFrom(NOUNS)} ${Math.floor(Math.random() * 900) + 100}`;
    return name.slice(0, 24);
}

export function pickBotAvatar(): PlayerAvatar {
    const avatars = Object.values(PlayerAvatar);
    return randomFrom(avatars);
}

export interface BotIdentity {
    playerId: number;
    playerToken: string;
    name: string;
    avatarUrl: PlayerAvatar;
}

/** Mints a fresh {playerId, playerToken}, the same way GET /playerid does (see
 *  app.config.ts:188-197 and test/room.test.ts's mintPlayerIdAndToken) — but in-process, since a
 *  headless bot has no reason to round-trip through its own HTTP server. Retries name generation
 *  against isNameClean defensively (every static combination is already pre-verified clean, but
 *  this keeps the contract honest if the word lists ever grow). */
export async function mintBotIdentity(): Promise<BotIdentity> {
    const playerId = await getNextPlayerId();
    const playerToken = generatePlayerToken();
    await reservePlayerId(playerId, playerToken);

    let name = generateBotName();
    for (let attempt = 0; attempt < 5 && !isNameClean(name); attempt++) {
        name = generateBotName();
    }

    return { playerId, playerToken, name, avatarUrl: pickBotAvatar() };
}
