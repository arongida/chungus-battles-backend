import type { ArraySchema } from '@colyseus/schema';
import type { Talent } from '../schema/TalentSchema';

/** Joker (talentId 41) — reworked Season 24. Every stat the talent can deal, keyed to the same
 *  field it writes on talent.affectedStats. `amount` is the per-level value — identical to the
 *  pre-rework hardcoded numbers, just centralized here so the behavior, the draft-pick UI payload
 *  and the DB card text can't drift apart. */
export type JokerStat = 'maxHp' | 'accuracy' | 'strength' | 'defense' | 'dodgeRate' | 'attackSpeed' | 'income' | 'hpRegen';

export interface JokerCardDef {
    stat: JokerStat;
    label: string;
    amount: (level: number) => number;
}

export const JOKER_CARDS: JokerCardDef[] = [
    { stat: 'maxHp', label: 'hp', amount: (level) => 10 * level },
    { stat: 'accuracy', label: 'accuracy', amount: (level) => level },
    { stat: 'strength', label: 'strength', amount: (level) => 1 + level },
    { stat: 'defense', label: 'defense', amount: (level) => 9 * level },
    { stat: 'dodgeRate', label: 'dodge rate', amount: (level) => 10 * level },
    { stat: 'attackSpeed', label: 'attack speed', amount: (level) => level * 0.05 },
    { stat: 'income', label: 'income', amount: (level) => level },
    { stat: 'hpRegen', label: 'hp regeneration', amount: (level) => level * 0.5 },
];

/** Rounds to 2dp — attackSpeed/hpRegen amounts are fractional; everything else is already an
 *  integer, so this is a no-op for them. Keeps the encoded tag strings short and stable. */
function round2(n: number): number {
    return Math.round(n * 100) / 100;
}

export function jokerCardAmount(card: JokerCardDef, level: number): number {
    return round2(card.amount(level));
}

const CARD_TAG_PREFIX = 'joker-card:';
const TOTAL_TAG_PREFIX = 'joker-total:';

export function encodeJokerCard(stat: JokerStat, amount: number): string {
    return `${CARD_TAG_PREFIX}${stat}:${amount}`;
}

export interface JokerPendingCard {
    stat: JokerStat;
    amount: number;
}

/** The card(s) dealt by a win, waiting for the player to pick one in the draft. Encoded onto
 *  talent.tags (already a persisted, synced ArraySchema<string> — see Shady Shields/Festering
 *  Wounds for the same latch-via-tags idiom) instead of a new schema field, so no frontend
 *  schema mirror change is needed to ship this. */
export function parseJokerPendingCards(tags: ArraySchema<string> | string[] | undefined): JokerPendingCard[] {
    if (!tags) return [];
    const cards: JokerPendingCard[] = [];
    for (const tag of tags) {
        if (!tag.startsWith(CARD_TAG_PREFIX)) continue;
        const [, stat, amountStr] = tag.split(':');
        cards.push({ stat: stat as JokerStat, amount: Number(amountStr) });
    }
    return cards;
}

export function clearJokerPendingCards(tags: ArraySchema<string>): void {
    for (let i = tags.length - 1; i >= 0; i--) {
        if (tags[i].startsWith(CARD_TAG_PREFIX)) tags.splice(i, 1);
    }
}

/** The running total Joker has actually paid out so far, per stat — kept independently of
 *  talent.affectedStats (which gets suspended to 0 while a card is pending, see
 *  rebuildJokerAffectedStats) so the accumulated bonus is never lost, only withheld. */
export function getJokerTotal(tags: ArraySchema<string> | string[] | undefined, stat: JokerStat): number {
    if (!tags) return 0;
    const prefix = `${TOTAL_TAG_PREFIX}${stat}:`;
    for (const tag of tags) {
        if (tag.startsWith(prefix)) return Number(tag.slice(prefix.length));
    }
    return 0;
}

export function addJokerTotal(tags: ArraySchema<string>, stat: JokerStat, amount: number): void {
    const prefix = `${TOTAL_TAG_PREFIX}${stat}:`;
    const next = round2(getJokerTotal(tags, stat) + amount);
    const idx = tags.findIndex((t) => t.startsWith(prefix));
    const encoded = `${prefix}${next}`;
    if (idx !== -1) tags[idx] = encoded;
    else tags.push(encoded);
}

/** Rebuilds talent.affectedStats from the persisted running totals — zeroed out entirely while
 *  any card is pending (parseJokerPendingCards non-empty), which is what makes an undrawn card a
 *  real cost: every stat Joker has ever granted stops applying until the player picks. Call on
 *  every AURA tick (idempotent) and immediately after a pick/auto-apply so the change is visible
 *  without waiting for the next tick. */
export function rebuildJokerAffectedStats(talent: Talent): void {
    const suspended = parseJokerPendingCards(talent.tags).length > 0;
    for (const card of JOKER_CARDS) {
        const total = suspended ? 0 : getJokerTotal(talent.tags, card.stat);
        if (card.stat === 'attackSpeed') {
            talent.affectedStats.attackSpeed = 1 + total;
        } else {
            (talent.affectedStats as any)[card.stat] = total;
        }
    }
}

export const JOKER_BASE_DESCRIPTION =
    "After every fight, win or lose, the Joker deals two cards — pick one in the shop for a permanent stat bonus. Leave a card unpicked and the Joker withholds every bonus it's ever dealt you.";

export const JOKER_SUSPENDED_DESCRIPTION =
    'A card is waiting — pick one to restore everything the Joker has dealt you.';
