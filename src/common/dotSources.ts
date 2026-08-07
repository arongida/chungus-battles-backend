import type {Talent} from '../talents/schema/TalentSchema';

/** Tracks how many of a player's live poison/burn stacks were applied by which Talent, so DoT
 *  tick damage (and healing prevented) can be credited proportionally to the actual source
 *  instead of a hard-coded talentId filter. Held per-player as `poisonSources`/`burnSources`
 *  on PlayerSchema — server-only, never synced. Stacks applied by items (no talent) are simply
 *  never entered into the ledger, so their share of a tick goes uncredited to anyone. */
export type DotSourceLedger = Map<Talent, number>;

/** poisonStack/burnStack setters clamp at 1000 while the ledger has no such clamp (a Talent can
 *  keep pushing entries past that point), so the ledger's own total can exceed the live stack
 *  count. Divide by the larger of the two (and never by less than 1) so per-source shares never
 *  sum above 1 and inflate the credited damage. */
function denom(ledger: DotSourceLedger, liveStacks: number): number {
    let tracked = 0;
    ledger.forEach(v => (tracked += v));
    return Math.max(liveStacks, tracked, 1);
}

export function addDotSource(ledger: DotSourceLedger, source: Talent | undefined, stacks: number) {
    if (!source || stacks <= 0) return;
    ledger.set(source, (ledger.get(source) ?? 0) + stacks);
}

export function removeDotSource(ledger: DotSourceLedger, source: Talent | undefined, stacks: number) {
    if (!source || stacks <= 0) return;
    const remaining = (ledger.get(source) ?? 0) - stacks;
    if (remaining <= 0) {
        ledger.delete(source);
    } else {
        ledger.set(source, remaining);
    }
}

/** Splits a DoT tick's damage across every source proportional to its live stack share, crediting
 *  each source Talent's statDamageDealt/totalDamageDealt directly (mirrors what TalentBehaviors'
 *  `track()` does for those two fields — kept separate here to avoid a PlayerSchema -> TalentBehaviors
 *  -> PlayerSchema import cycle). */
export function creditDotDamage(ledger: DotSourceLedger, liveStacks: number, damage: number) {
    if (damage <= 0 || ledger.size === 0) return;
    const total = denom(ledger, liveStacks);
    ledger.forEach((stacks, talent) => {
        const share = (stacks / total) * damage;
        talent.statDamageDealt += share;
        talent.totalDamageDealt += share;
    });
}

/** Same proportional split as creditDotDamage, but for healing-prevented credit (POISON_2's
 *  statHealingPrevented/totalHealingPrevented). */
export function creditHealingPrevented(ledger: DotSourceLedger, liveStacks: number, prevented: number) {
    if (prevented <= 0 || ledger.size === 0) return;
    const total = denom(ledger, liveStacks);
    ledger.forEach((stacks, talent) => {
        const share = (stacks / total) * prevented;
        talent.statHealingPrevented += share;
        talent.totalHealingPrevented += share;
    });
}
