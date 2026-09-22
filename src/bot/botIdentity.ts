/**
 * Mints the identity a bot character joins as — a real {playerId, playerToken} pair (so the
 * character is indistinguishable from a human one at the auth/DB layer — see
 * players/db/PlayerToken.ts's onAuth model) plus a name and avatar for display.
 */
import { getNextPlayerId } from '../players/db/Player';
import { generatePlayerToken, reservePlayerId } from '../players/db/PlayerToken';
import { isNameClean } from '../common/profanity';
import { PlayerAvatar } from '../players/types/PlayerTypes';
import { BotClass } from './BotPolicy';

// Deliberately plain, readable words — bots are meant to look like ordinary characters on the
// leaderboard (the isBot flag is the discriminator, not the name), and every combination below
// is verified clean against isNameClean in test/botIdentity.test.ts.
const ADJECTIVES = [
    'Agile', 'Amber', 'Ashen', 'Bold', 'Brave', 'Bright', 'Calm', 'Clever', 'Cunning', 'Daring',
    'Eager', 'Fierce', 'Flint', 'Grand', 'Gritty', 'Hardy', 'Iron', 'Keen', 'Lucky', 'Lunar',
    'Mighty', 'Nimble', 'Noble', 'Plucky', 'Quick', 'Rapid', 'Rowdy', 'Royal', 'Silent', 'Sly',
    'Steel', 'Stormy', 'Sturdy', 'Swift', 'Tough', 'Vivid', 'Wild', 'Wily', 'Wise', 'Zesty',
];
const NOUNS = [
    'Badger', 'Bear', 'Boar', 'Cobra', 'Crow', 'Drake', 'Eagle', 'Falcon', 'Finch', 'Fox',
    'Gecko', 'Goblin', 'Hawk', 'Heron', 'Hound', 'Ibex', 'Jackal', 'Knight', 'Koala', 'Lion',
    'Lynx', 'Mantis', 'Mole', 'Moose', 'Newt', 'Otter', 'Owl', 'Panther', 'Puma', 'Raven',
    'Ronin', 'Shark', 'Sparrow', 'Stag', 'Stoat', 'Tiger', 'Toad', 'Viper', 'Weasel', 'Wolf',
    'Wombat', 'Yak', 'Zealot', 'Badgerling',
];

/** Plain suffixes keep the archetype recognizable while reading like a character title. */
const ARCHETYPE_NAME_SUFFIXES: Record<string, string> = {
    balanced: 'Balanced',
    'dodge-rogue': 'Rogue',
    'bruiser-warrior': 'Bruiser',
    'tank-paladin': 'Paladin',
    'economy-merchant': 'Merchant',
    'active-caster': 'Caster',
    highroller: 'Highroller',
};

const candidateCache = new Map<string, string[]>();

function randomFrom<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
}

/** Every possible name for an archetype, pre-filtered against the public name rules. Exported so
 * tests can prove the full generator space rather than relying on random samples. */
export function listBotNameCandidates(archetypeId?: string): string[] {
    const key = archetypeId ?? '';
    const cached = candidateCache.get(key);
    if (cached) return cached;

    const suffix = archetypeId ? ARCHETYPE_NAME_SUFFIXES[archetypeId] : undefined;
    const candidates = ADJECTIVES.flatMap(adjective => NOUNS.map(noun =>
        [adjective, noun, suffix].filter(Boolean).join(' '),
    )).filter(name => name.length <= 24 && isNameClean(name));
    if (candidates.length === 0) throw new Error(`No valid bot names for archetype '${archetypeId}'.`);
    candidateCache.set(key, candidates);
    return candidates;
}

/** A readable character name with enough combinations to avoid the old numbered-name feel. */
export function generateBotName(archetypeId?: string): string {
    return randomFrom(listBotNameCandidates(archetypeId));
}

const CLASS_AVATAR: Record<BotClass, PlayerAvatar> = {
    rogue: PlayerAvatar.THIEF,
    warrior: PlayerAvatar.WARRIOR,
    merchant: PlayerAvatar.MERCHANT,
};

export function classToAvatar(cls: BotClass): PlayerAvatar {
    return CLASS_AVATAR[cls];
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
export async function mintBotIdentity(archetypeId?: string, avatarClass?: BotClass): Promise<BotIdentity> {
    const playerId = await getNextPlayerId();
    const playerToken = generatePlayerToken();
    await reservePlayerId(playerId, playerToken);

    let name = generateBotName(archetypeId);
    for (let attempt = 0; attempt < 5 && !isNameClean(name); attempt++) {
        name = generateBotName(archetypeId);
    }

    // A class-playing policy gets its own class; one without (v1) keeps a random avatar.
    const avatarUrl = avatarClass ? classToAvatar(avatarClass) : pickBotAvatar();
    return { playerId, playerToken, name, avatarUrl };
}
