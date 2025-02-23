import {Schema, type} from "@colyseus/schema";

export class AffectedStats extends Schema {
    @type('number') strength: number = 0;
    @type('number') accuracy: number = 0;
    @type('number') attackSpeed: number = 1;
    @type('number') maxHp: number = 0;
    @type('number') defense: number = 0;
    @type('number') dodgeRate: number = 0;
    @type('number') flatDmgReduction: number = 0;
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
        this.flatDmgReduction += affectedStatsToMerge.flatDmgReduction;

        let attackSpeedToMerge = affectedStatsToMerge.attackSpeed ?? 1;
        if (attackSpeedToMerge === 0) attackSpeedToMerge = 1;

        if (!this.attackSpeed) this.attackSpeed = 1;
        this.attackSpeed += attackSpeedToMerge - 1;

    }
}