import {Player} from '../players/schema/PlayerSchema';
import {AffectedStats} from './schema/AffectedStatsSchema';

export interface StatsSnapshot {
    strength: number;
    accuracy: number;
    defense: number;
    maxHp: number;
    dodgeRate: number;
    hpRegen: number;
    flatDmgReduction: number;
    income: number;
}

export function addStats(target: StatsSnapshot, source: AffectedStats): void {
    target.strength += source.strength;
    target.accuracy += source.accuracy;
    target.defense += source.defense;
    target.maxHp += source.maxHp;
    target.dodgeRate += source.dodgeRate;
    target.hpRegen += source.hpRegen;
    target.flatDmgReduction += source.flatDmgReduction;
    target.income += source.income;
}

export function buildBaseAndItemsSnapshot(player: Player): StatsSnapshot {
    const snapshot: StatsSnapshot = {
        strength: player.baseStats.strength,
        accuracy: player.baseStats.accuracy,
        defense: player.baseStats.defense,
        maxHp: player.baseStats.maxHp,
        dodgeRate: player.baseStats.dodgeRate,
        hpRegen: player.baseStats.hpRegen,
        flatDmgReduction: player.baseStats.flatDmgReduction,
        income: player.baseStats.income,
    };
    player.equippedItems.forEach((item) => {
        addStats(snapshot, item.affectedStats);
        if (item.setActive) addStats(snapshot, item.setBonusStats);
    });
    return snapshot;
}
