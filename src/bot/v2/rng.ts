/** Deterministic PRNG for the v2 policy. A bot run must be reproducible from its recorded seed —
 *  Math.random() would make a surprising archetype result impossible to re-examine. */

/** mulberry32 — 32-bit state, good enough distribution for weight jitter and archetype choice. */
export function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** FNV-1a over the joined parts — derives a per-run seed from (batchId, runIndex) so a whole
 *  batch replays from `(batchId, runs, policyId)` alone. */
export function hashSeed(...parts: (string | number)[]): number {
    let h = 0x811c9dc5;
    const s = parts.join(':');
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}
