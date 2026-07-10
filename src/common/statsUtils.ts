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

/**
 * Recalculates a player's synced display/combat stats from scratch: baseStats, then each
 * equipped item's affectedStats, then each talent's affectedStats, then (when an opponent is
 * given) the opponent's enemy-affecting talent/item stats. attackSpeed bonuses accumulate
 * additively on the multiplier (see CLAUDE.md gotcha #2). HP is restored as maxHp minus the
 * damage already taken, so a fresh player (hp = maxHp = 0) comes out at full HP.
 *
 * Extracted from UpdateStatsCommand (which delegates here every room tick) so out-of-room
 * code — e.g. buildJoe()'s draft preview — computes exactly the same final stats a room would.
 */
export function recalculatePlayerStats(player: Player, enemy?: Player): void {
    const previousMaxHp = player.maxHp ?? player.hp;
    const previousHp = player.hp ?? player.maxHp;
    const damageTaken = previousMaxHp - previousHp;

    player.attackSpeedMultiplier = 1;

    setStats(player, player.baseStats);

    player.equippedItems.forEach((value) => {
        increaseStats(player, value.affectedStats);
    });
    player.talents.forEach((talent) => {
        increaseStats(player, talent.affectedStats);
    });
    if (enemy) {
        enemy.talents.forEach((talent) => {
            increaseStats(player, talent.affectedEnemyStats);
        });
        enemy.equippedItems.forEach((item) => {
            if (item.affectedEnemyStats) {
                increaseStats(player, item.affectedEnemyStats);
            }
        });
    }

    player.attackSpeed = player.attackSpeedMultiplier;
    player.hp = player.maxHp - damageTaken;
    player.healingEffectiveness = Math.max(0, 1 - player.poisonStack * 0.01);
}

function increaseStats(player: Player, affectedStats: AffectedStats): void {
    try {
        addStats(player, affectedStats);
        if (affectedStats.attackSpeed !== 0 && affectedStats.attackSpeed !== 1) {
            player.attackSpeedMultiplier += affectedStats.attackSpeed - 1;
        }
    } catch (e) {
        console.error('Failed to increase stats for player: ', player?.name);
        console.error(e);
    }
}

function setStats(player: Player, affectedStats: AffectedStats): void {
    try {
        player.strength = affectedStats.strength;
        player.accuracy = affectedStats.accuracy;
        player.maxHp = affectedStats.maxHp;
        player.defense = affectedStats.defense;
        player.attackSpeed = affectedStats.attackSpeed;
        player.attackSpeedMultiplier = affectedStats.attackSpeed;
        player.dodgeRate = affectedStats.dodgeRate;
        player.flatDmgReduction = affectedStats.flatDmgReduction;
        player.income = affectedStats.income;
        player.hpRegen = affectedStats.hpRegen;
    } catch (e) {
        console.error('Failed to set stats for player: ', player?.name);
        console.error(e);
    }
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
    });
    return snapshot;
}
