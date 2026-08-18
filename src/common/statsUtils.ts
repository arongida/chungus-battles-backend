import {Player} from '../players/schema/PlayerSchema';
import {AffectedStats} from './schema/AffectedStatsSchema';
import {POISON_HEALING_EFFECTIVENESS} from './poisonBalance';
import {ITEM_SKILLS, skillValues} from '../items/behavior/itemSkillBalance';
import {ItemRarity} from '../items/types/ItemTypes';

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
        // Weapon Whisperer's second skill slot (ItemSchema.ts) — same treatment as slot 1.
        if (value.skillAffectedStats2) {
            accumulate(value.skillAffectedStats2);
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
            if (item.skillAffectedEnemyStats2) {
                accumulate(item.skillAffectedEnemyStats2);
            }
        });
    }

    // Health Flask brews: the stat-granting ones (Regeneration/Evasion/Stoneskin/Fortitude) fold
    // straight into the snapshot alongside every other item/talent source — see
    // PlayerSchema.pendingPotionEffects. Folding into the snapshot (rather than adding to
    // player.hpRegen/dodgeRate/etc. after assignment, as the old single-effect pendingRegenBuff
    // did) means an Evasion brew's dodge bonus is correctly zeroed by the Zealot/stun check below
    // like any other dodge source, instead of bypassing it. Antidote and Salve grant no stats —
    // they're read directly via getPoisonDamageMultiplier/getBurnDamageMultiplier (FightRoom.ts's
    // poison/burn tick calculations); Liquid Courage is read directly in FightRoom.startBattle —
    // so none of the three contribute anything here.
    player.pendingPotionEffects.forEach((skillId) => {
        const def = ITEM_SKILLS[skillId];
        if (!def) return;
        const v = skillValues(def, ItemRarity.COMMON);
        snapshot.hpRegen += v.hpRegen || 0;
        snapshot.dodgeRate += v.dodgeRate || 0;
        snapshot.defense += v.defense || 0;
        snapshot.maxHp += v.maxHp || 0;
    });

    // Assign once: neutralize accuracy first so the strength setter can't clamp up to a
    // stale value, then strength, then accuracy (its setter clamps to min(accuracy, strength)).
    player.accuracy = 1;
    player.strength = snapshot.strength;
    player.accuracy = snapshot.accuracy;
    player.maxHp = snapshot.maxHp;
    player.defense = snapshot.defense;
    // Zealot: zeroes dodge after every item/talent has contributed, so no other dodge source
    // (items, other talents) can bring it back up while Zealot is owned. Shield Bash (item skill)
    // reuses the same zeroing for its stun — a stunned player can't dodge either.
    player.dodgeRate = (player.dodgeDisabled || player.stunned) ? 0 : snapshot.dodgeRate;
    player.income = snapshot.income;
    player.hpRegen = snapshot.hpRegen;
    player.cooldownReduction = snapshot.cooldownReduction;

    player.attackSpeedMultiplier = attackSpeedMultiplier;
    player.attackSpeed = player.attackSpeedMultiplier;
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
