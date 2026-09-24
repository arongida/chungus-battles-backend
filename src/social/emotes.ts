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
    greet_hello: { slot: 'greeting', text: 'Greetings, traveler.' },
    greet_dance: { slot: 'greeting', text: "Let's dance!" },
    greet_behold: { slot: 'greeting', text: 'Behold, the mighty Chungus!' },
    greet_luck: { slot: 'greeting', text: "Good luck. You'll need it." },
    greet_lunch: { slot: 'greeting', text: 'Is it lunch yet?' },
    greet_best: { slot: 'greeting', text: 'May the best build win.' },

    // Said by the winner when the fight ends.
    win_gg: { slot: 'victory', text: 'Good game!' },
    win_prevails: { slot: 'victory', text: 'Chungus prevails!' },
    win_gold: { slot: 'victory', text: 'Thanks for the gold!' },
    win_close: { slot: 'victory', text: 'Phew, that was close.' },
    win_stronger: { slot: 'victory', text: 'Come back stronger!' },
    win_all: { slot: 'victory', text: 'Was that all?' },

    // Said by the loser when the fight ends.
    lose_fought: { slot: 'defeat', text: 'Well fought.' },
    lose_remember: { slot: 'defeat', text: "I'll remember this..." },
    lose_lucky: { slot: 'defeat', text: 'Lucky roll!' },
    lose_shop: { slot: 'defeat', text: 'I blame the shop.' },
    lose_ouch: { slot: 'defeat', text: 'Ouch.' },
    lose_next: { slot: 'defeat', text: 'Next time, friend.' },

    // Sent live by the player during/after a fight; delivered to the ghost's owner later.
    react_wp: { slot: 'reaction', text: 'Well played!' },
    react_gg: { slot: 'reaction', text: 'GG' },
    react_wow: { slot: 'reaction', text: 'Wow!' },
    react_thanks: { slot: 'reaction', text: 'Thanks!' },
    react_oops: { slot: 'reaction', text: 'Oops...' },
    react_sorry: { slot: 'reaction', text: 'Sorry!' },
    react_grr: { slot: 'reaction', text: "I'm coming for you!" },
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

// Per-fight limits on live reactions (FightRoom's 'emote' handler). The cap also bounds how much
// a scripted client can add to the recorded replay and to the owner's ghost encounter doc.
export const MAX_REACTIONS_PER_FIGHT = 5;
export const REACTION_COOLDOWN_MS = 2000;
