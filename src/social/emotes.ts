// Preset social lines — the ONLY text players can send each other. Async play means there's no
// live opponent to chat with, and free text would need moderation this game has no account
// system to back up (no one to ban), so everything is picked from this fixed catalog by id.
//
// Mirrored in ../chungus-battles-frontend/src/app/common/social/emote-catalog.ts — the ids (and
// slots) must match; test/emoteCatalogParity.test.ts enforces it. Ids are persisted on player
// snapshots (battle cries) and ghost encounters (reactions), so never rename or delete one —
// add new ids instead.

export type EmoteSlot = 'greeting' | 'victory' | 'defeat' | 'reaction';

// Battle-cry slots a player sets in the draft; each maps to a Player field of the same shape.
export type BattleCrySlot = Exclude<EmoteSlot, 'reaction'>;
export const BATTLE_CRY_SLOTS: BattleCrySlot[] = ['greeting', 'victory', 'defeat'];

export interface EmoteDef {
    slot: EmoteSlot;
    text: string;
}

export const EMOTES: Record<string, EmoteDef> = {
    // Said by both fighters when the battle starts.
    greet_hello: { slot: 'greeting', text: "Oh good, another victim." },
    greet_dance: { slot: 'greeting', text: "Let's make this quick, I have shopping to do." },
    greet_behold: { slot: 'greeting', text: "Behold! Mediocrity, perfected." },
    greet_luck: { slot: 'greeting', text: "Good luck. You'll need all of it." },
    greet_lunch: { slot: 'greeting', text: "Is it lunch yet?" },
    greet_best: { slot: 'greeting', text: "May the best build win. So, me." },
    greet_ghost: { slot: 'greeting', text: "Relax, I'm only a ghost. A very angry one." },
    greet_nap: { slot: 'greeting', text: "Wake me up when it's over." },
    greet_tooltips: { slot: 'greeting', text: "Did you read the tooltips? I didn't." },

    // Said by the winner when the fight ends.
    win_gg: { slot: 'victory', text: "Good game! Well, for me." },
    win_prevails: { slot: 'victory', text: "Chungus prevails. As foretold." },
    win_gold: { slot: 'victory', text: "Thanks for the donation!" },
    win_close: { slot: 'victory', text: "Phew, that was close. Kidding." },
    win_stronger: { slot: 'victory', text: "Come back when you've read the tooltips." },
    win_all: { slot: 'victory', text: "Was that... all?" },
    win_skill: { slot: 'victory', text: "Skill issue." },
    win_autograph: { slot: 'victory', text: "Please, no autographs." },
    win_nap: { slot: 'victory', text: "I barely woke up for that." },

    // Said by the loser when the fight ends.
    lose_fought: { slot: 'defeat', text: "Well fought. I let you win." },
    lose_remember: { slot: 'defeat', text: "I'll remember this..." },
    lose_lucky: { slot: 'defeat', text: "Lucky roll. Obviously." },
    lose_shop: { slot: 'defeat', text: "The shop hates me. Personally." },
    lose_ouch: { slot: 'defeat', text: "Ouch. Mostly my pride." },
    lose_next: { slot: 'defeat', text: "Enjoy it. My ghost is plotting." },
    lose_lag: { slot: 'defeat', text: "Lag." },
    lose_intended: { slot: 'defeat', text: "Working as intended." },
    lose_warmup: { slot: 'defeat', text: "That was my warm-up." },

    // Sent live by the player during/after a fight; delivered to the ghost's owner later.
    react_wp: { slot: 'reaction', text: "Okay, that was good." },
    react_gg: { slot: 'reaction', text: "GG" },
    react_wow: { slot: 'reaction', text: "Wow. Rude." },
    react_thanks: { slot: 'reaction', text: "Thanks, I guess?" },
    react_oops: { slot: 'reaction', text: "Oops. Totally meant that." },
    react_sorry: { slot: 'reaction', text: "Sorry! (not sorry)" },
    react_grr: { slot: 'reaction', text: "I know where your ghost lives." },
    react_popcorn: { slot: 'reaction', text: "Great show. 10/10." },
    react_rng: { slot: 'reaction', text: "RNG strikes again." },
};

export const DEFAULT_BATTLE_CRIES: Record<BattleCrySlot, string> = {
    greeting: 'greet_hello',
    victory: 'win_gg',
    defeat: 'lose_fought',
};

export function isValidEmote(emoteId: unknown, slot: EmoteSlot): emoteId is string {
    return typeof emoteId === 'string'
        && Object.prototype.hasOwnProperty.call(EMOTES, emoteId)
        && EMOTES[emoteId].slot === slot;
}

export function emoteIdsForSlot(slot: EmoteSlot): string[] {
    return Object.keys(EMOTES).filter(id => EMOTES[id].slot === slot);
}

// Bots pick their lines at random so a bot ghost doesn't read as obviously scripted.
export function randomBattleCries(): Record<BattleCrySlot, string> {
    const pick = (slot: BattleCrySlot) => {
        const ids = emoteIdsForSlot(slot);
        return ids[Math.floor(Math.random() * ids.length)];
    };
    return { greeting: pick('greeting'), victory: pick('victory'), defeat: pick('defeat') };
}

// Deterministic stand-in for characters (and their snapshots) saved before battle cries existed:
// the same seed — the character's originalPlayerId, shared by every snapshot — always yields the
// same lines, so an old ghost doesn't change its voice between rounds, yet different old
// characters still sound different instead of all using DEFAULT_BATTLE_CRIES.
export function seededBattleCries(seed: number): Record<BattleCrySlot, string> {
    const pick = (slot: BattleCrySlot, salt: number) => {
        const ids = emoteIdsForSlot(slot);
        // Small integer hash (xorshift-multiply) — just needs to spread consecutive ids apart.
        let h = (Math.floor(seed) ^ salt) >>> 0;
        h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
        h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
        h = (h ^ (h >>> 16)) >>> 0;
        return ids[h % ids.length];
    };
    return { greeting: pick('greeting', 0x9e37), victory: pick('victory', 0x7f4a), defeat: pick('defeat', 0x2c1b) };
}

// Per-fight limits on live reactions (FightRoom's 'emote' handler). The cap also bounds how much
// a scripted client can add to the recorded replay and to the owner's ghost encounter doc.
export const MAX_REACTIONS_PER_FIGHT = 5;
export const REACTION_COOLDOWN_MS = 2000;
