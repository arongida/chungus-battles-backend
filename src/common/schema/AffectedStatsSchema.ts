import {Schema, type} from "@colyseus/schema";

export class AffectedStats extends Schema {
    @type('number') strength: number = 0;
    @type('number') accuracy: number = 0;
    @type('number') attackSpeed: number = 1;
    @type('number') maxHp: number = 0;
    @type('number') defense: number = 0;
    @type('number') dodgeRate: number = 0;
    @type('number') income: number = 0;
    @type('number') hpRegen: number = 0;


    mergeInto(affectedStatsToMerge: AffectedStats) {
        this.strength += affectedStatsToMerge.strength;
        this.accuracy += affectedStatsToMerge.accuracy;
        this.maxHp += affectedStatsToMerge.maxHp;
        this.income += affectedStatsToMerge.income;

        this.hpRegen += affectedStatsToMerge.hpRegen;
        this.defense += affectedStatsToMerge.defense;
        this.dodgeRate += affectedStatsToMerge.dodgeRate;

        let attackSpeedToMerge = affectedStatsToMerge.attackSpeed ?? 1;
        if (attackSpeedToMerge === 0) attackSpeedToMerge = 1;

        if (!this.attackSpeed) this.attackSpeed = 1;
        this.attackSpeed += attackSpeedToMerge - 1;

    }
}

/**
 * Builds an AffectedStats from a raw DB object, normalizing attackSpeed to its base-1 baseline.
 * A stored/absent 0 means "no change" for the read-side guard (see statsUtils.recalculatePlayerStats),
 * but leaving it at 0 makes any later additive write (behaviors doing `affectedStats.attackSpeed += x`)
 * collapse a bonus into a ~-95% penalty instead of the intended small boost. Normalizing 0 -> 1 keeps
 * every AffectedStats on the same base-1 scale. Legit enemy slow-debuffs are stored as fractions like
 * 0.7 (not 0), so they are untouched by this normalization.
 */
export function affectedStatsFromRaw(raw: any): AffectedStats {
    const stats = new AffectedStats().assign(raw || {});
    if (!stats.attackSpeed) stats.attackSpeed = 1;
    return stats;
}