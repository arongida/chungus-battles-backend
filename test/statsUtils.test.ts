import { recalculatePlayerStats } from '../src/common/statsUtils';
import { Player } from '../src/players/schema/PlayerSchema';
import { Item } from '../src/items/schema/ItemSchema';
import { Talent } from '../src/talents/schema/TalentSchema';
import { AffectedStats } from '../src/common/schema/AffectedStatsSchema';

// Pure unit tests for the per-tick stat pipeline — no room, no Colyseus test harness, no
// MongoDB. recalculatePlayerStats takes plain Player/Item/Talent schema instances (see its
// doc comment: "so out-of-room code ... computes exactly the same final stats a room would"),
// so these run in milliseconds and pin down the accumulation rules documented in
// CLAUDE.md's "Common Gotchas" without ever booting a room.

function statItem(stats: Partial<Record<keyof AffectedStats, number>> = {}): Item {
    const item = new Item();
    item.affectedStats = Object.assign(new AffectedStats(), stats);
    item.skillAffectedStats = new AffectedStats();
    item.skillAffectedStats2 = new AffectedStats();
    return item;
}

function statTalent(stats: Partial<Record<keyof AffectedStats, number>> = {}): Talent {
    const talent = new Talent();
    talent.affectedStats = Object.assign(new AffectedStats(), stats);
    talent.affectedEnemyStats = new AffectedStats();
    return talent;
}

describe('recalculatePlayerStats', () => {
    it('with no items or talents, final stats equal baseStats', () => {
        const player = new Player();
        player.baseStats = Object.assign(new AffectedStats(), {
            strength: 10, accuracy: 5, defense: 3, maxHp: 100, dodgeRate: 2, hpRegen: 1, income: 0,
        });

        recalculatePlayerStats(player);

        expect(player.strength).toBe(10);
        expect(player.accuracy).toBe(5);
        expect(player.defense).toBe(3);
        expect(player.maxHp).toBe(100);
        expect(player.dodgeRate).toBe(2);
        // Fresh player (hp = maxHp = 0 beforehand) comes out at full HP.
        expect(player.hp).toBe(100);
    });

    it('an equipped item\'s affectedStats add onto baseStats', () => {
        const player = new Player();
        player.baseStats = Object.assign(new AffectedStats(), { strength: 10, accuracy: 5, maxHp: 100 });
        player.equippedItems.set('mainHand', statItem({ strength: 4, maxHp: 20 }));

        recalculatePlayerStats(player);

        expect(player.strength).toBe(14);
        expect(player.maxHp).toBe(120);
    });

    it('a talent\'s affectedStats add on top of item stats', () => {
        const player = new Player();
        player.baseStats = Object.assign(new AffectedStats(), { defense: 3 });
        player.talents.push(statTalent({ defense: 7 }));

        recalculatePlayerStats(player);

        expect(player.defense).toBe(10);
    });

    // CLAUDE.md gotcha #2: attackSpeed is additive on the multiplier, not multiplicative on
    // itself. Two independent +50% sources must total +100%, matching the in-game tooltips —
    // 1.5 * 1.5 = 2.25 would be the wrong (multiplicative) answer.
    it('two attackSpeed sources stack additively, not multiplicatively', () => {
        const player = new Player();
        player.baseStats = new AffectedStats(); // attackSpeed defaults to 1 (no change)
        player.equippedItems.set('mainHand', statItem({ attackSpeed: 1.5 })); // +50%
        player.talents.push(statTalent({ attackSpeed: 1.5 })); // +50%

        recalculatePlayerStats(player);

        expect(player.attackSpeedMultiplier).toBeCloseTo(2.0);
        expect(player.attackSpeed).toBeCloseTo(2.0);
    });

    // CLAUDE.md gotcha #3: AffectedStats.attackSpeed defaults to 1, meaning "no change" — a
    // source that never sets it must not silently apply a -95%-style penalty.
    it('an item/talent that never touches attackSpeed leaves the multiplier unchanged', () => {
        const player = new Player();
        player.baseStats = new AffectedStats();
        player.equippedItems.set('mainHand', statItem({ strength: 5 })); // attackSpeed left at default 1

        recalculatePlayerStats(player);

        expect(player.attackSpeedMultiplier).toBe(1);
    });

    it('an enemy\'s affectedEnemyStats talents debuff the player when an enemy is passed', () => {
        const player = new Player();
        player.baseStats = Object.assign(new AffectedStats(), { defense: 10 });
        const enemy = new Player();
        enemy.talents.push(statTalent()); // this talent's affectedEnemyStats does the debuffing
        (enemy.talents[0].affectedEnemyStats as AffectedStats).defense = -4;

        recalculatePlayerStats(player, enemy);

        expect(player.defense).toBe(6);
    });

    it('dodgeRate is zeroed while stunned, regardless of dodge sources', () => {
        const player = new Player();
        player.baseStats = Object.assign(new AffectedStats(), { dodgeRate: 15 });
        player.stunned = true;

        recalculatePlayerStats(player);

        expect(player.dodgeRate).toBe(0);
    });

    it('accuracy is clamped to strength even after both accumulate bonuses', () => {
        const player = new Player();
        player.baseStats = Object.assign(new AffectedStats(), { strength: 10, accuracy: 5 });
        // A big accuracy bonus with no matching strength bonus would otherwise push accuracy
        // above strength, which the Player.accuracy setter must not allow.
        player.equippedItems.set('mainHand', statItem({ accuracy: 20 }));

        recalculatePlayerStats(player);

        expect(player.accuracy).toBeLessThanOrEqual(player.strength);
        expect(player.accuracy).toBe(10);
    });

    it('preserves the absolute damage already taken when maxHp changes mid-fight', () => {
        const player = new Player();
        player.baseStats = Object.assign(new AffectedStats(), { maxHp: 100 });
        recalculatePlayerStats(player); // establishes maxHp=100, hp=100
        player.hp = 60; // took 40 damage

        // Gaining +50 maxHp (e.g. a mid-fight item/talent) should preserve the 40 damage taken,
        // landing at 110, not silently refill to the new max or keep the old 60.
        player.baseStats.maxHp = 150;
        recalculatePlayerStats(player);

        expect(player.maxHp).toBe(150);
        expect(player.hp).toBe(110);
    });

    it('an item\'s skillAffectedStats (item-skill output) adds on top of its rolled affectedStats', () => {
        const player = new Player();
        player.baseStats = new AffectedStats();
        const item = statItem({ strength: 3 });
        item.skillAffectedStats.strength = 2;
        item.skillAffectedStats2.strength = 1;
        player.equippedItems.set('mainHand', item);

        recalculatePlayerStats(player);

        expect(player.strength).toBe(6);
    });

    it('healingEffectiveness halves while poisoned, and is fully restored once poison clears', () => {
        const player = new Player();
        player.baseStats = new AffectedStats();
        player.poisonStack = 3;

        recalculatePlayerStats(player);
        expect(player.healingEffectiveness).toBe(0.5);

        player.poisonStack = 0;
        recalculatePlayerStats(player);
        expect(player.healingEffectiveness).toBe(1);
    });
});
