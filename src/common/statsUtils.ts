import {Player} from '../players/schema/PlayerSchema';
import {AffectedStats} from './schema/AffectedStatsSchema';
import {POISON_HEALING_EFFECTIVENESS} from './poisonBalance';

export interface StatsSnapshot {
    strength: number;
    accuracy: number;
    defense: number;
    maxHp: number;
    dodgeRate: number;
    hpRegen: number;
    income: number;
    cooldownReduction: number;
}

export function addStats(target: StatsSnapshot, source: AffectedStats): void {
    target.strength += source.strength;
    target.accuracy += source.accuracy;
    target.defense += source.defense;
    target.maxHp += source.maxHp;
    target.dodgeRate += source.dodgeRate;
    target.hpRegen += source.hpRegen;
    target.income += source.income;
    target.cooldownReduction += source.cooldownReduction;
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
 *
 * Stats are accumulated into a plain (unclamped) StatsSnapshot rather than written
 * incrementally onto the player. Player.strength/accuracy setters cross-clamp to enforce
 * accuracy <= strength; assigning through them on every single item/talent (in an order that
 * depends on iteration order and the previous tick's residual values) let an accuracy bonus
 * ratchet strength upward tick after tick. Accumulating on a plain object first and assigning
 * once at the end applies that clamp exactly once, deterministically.
 */
export function recalculatePlayerStats(player: Player, enemy?: Player): void {
    const previousMaxHp = player.maxHp ?? player.hp;
    const previousHp = player.hp ?? player.maxHp;
    const damageTaken = previousMaxHp - previousHp;

    const snapshot: StatsSnapshot = {
        strength: player.baseStats.strength,
        accuracy: player.baseStats.accuracy,
        defense: player.baseStats.defense,
        maxHp: player.baseStats.maxHp,
        dodgeRate: player.baseStats.dodgeRate,
        hpRegen: player.baseStats.hpRegen,
        income: player.baseStats.income,
        cooldownReduction: player.baseStats.cooldownReduction,
    };
    let attackSpeedMultiplier = player.baseStats.attackSpeed;

    const accumulate = (affectedStats: AffectedStats) => {
        try {
            addStats(snapshot, affectedStats);
            if (affectedStats.attackSpeed !== 0 && affectedStats.attackSpeed !== 1) {
                attackSpeedMultiplier += affectedStats.attackSpeed - 1;
            }
        } catch (e) {
            console.error('Failed to accumulate stats for player: ', player?.name);
            console.error(e);
        }
    };

    player.equippedItems.forEach((value) => {
        accumulate(value.affectedStats);
        // Class-item skill output (items/skills/itemSkillRoller.ts) — kept separate from the
        // item's own rolled affectedStats, see ItemSchema.ts's skillAffectedStats comment.
        if (value.skillAffectedStats) {
            accumulate(value.skillAffectedStats);
        }
    });
    player.talents.forEach((talent) => {
        accumulate(talent.affectedStats);
    });
    if (enemy) {
        enemy.talents.forEach((talent) => {
            accumulate(talent.affectedEnemyStats);
        });
        enemy.equippedItems.forEach((item) => {
            if (item.affectedEnemyStats) {
                accumulate(item.affectedEnemyStats);
            }
            if (item.skillAffectedEnemyStats) {
                accumulate(item.skillAffectedEnemyStats);
            }
        });
    }

    // Assign once: neutralize accuracy first so the strength setter can't clamp up to a
    // stale value, then strength, then accuracy (its setter clamps to min(accuracy, strength)).
    player.accuracy = 1;
    player.strength = snapshot.strength;
    player.accuracy = snapshot.accuracy;
    player.maxHp = snapshot.maxHp;
    player.defense = snapshot.defense;
    // Zealot: zeroes dodge after every item/talent has contributed, so no other dodge source
    // (items, other talents) can bring it back up while Zealot is owned.
    player.dodgeRate = player.dodgeDisabled ? 0 : snapshot.dodgeRate;
    player.income = snapshot.income;
    player.hpRegen = snapshot.hpRegen;
    player.cooldownReduction = snapshot.cooldownReduction;

    player.attackSpeedMultiplier = attackSpeedMultiplier;
    player.attackSpeed = player.attackSpeedMultiplier;
    // Health Flask: a banked one-fight regen buff (see PlayerSchema.pendingRegenBuff) folds
    // straight into the recomputed hpRegen, so it shows up immediately in the draft UI and
    // drives FightRoom.startRegenTimer during the player's next fight with no separate field.
    player.hpRegen += player.pendingRegenBuff || 0;
    player.hp = player.maxHp - damageTaken;
    // Flat 50% cut while poisoned at all — does not scale with stack count. Stacking poison
    // now only increases DoT damage, not the healing penalty (see poisonBalance.ts).
    player.healingEffectiveness = player.poisonStack > 0 ? POISON_HEALING_EFFECTIVENESS : 1;
}

export function buildBaseAndItemsSnapshot(player: Player): StatsSnapshot {
    const snapshot: StatsSnapshot = {
        strength: player.baseStats.strength,
        accuracy: player.baseStats.accuracy,
        defense: player.baseStats.defense,
        maxHp: player.baseStats.maxHp,
        dodgeRate: player.baseStats.dodgeRate,
        hpRegen: player.baseStats.hpRegen,
        income: player.baseStats.income,
        cooldownReduction: player.baseStats.cooldownReduction,
    };
    player.equippedItems.forEach((item) => {
        addStats(snapshot, item.affectedStats);
    });
    return snapshot;
}
