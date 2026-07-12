import {Schema} from "mongoose";

export const StatsSchema = new Schema({
    strength: Number,
    accuracy: Number,
    maxHp: Number,
    defense: Number,
    attackSpeed: Number,
    dodgeRate: Number,
    income: Number,
    hpRegen: Number,
});