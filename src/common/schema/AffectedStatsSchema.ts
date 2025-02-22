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
}