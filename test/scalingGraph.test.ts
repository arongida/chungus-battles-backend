import { buildScalingOrder, skillNode, talentNode, ScalingNodeDef } from '../src/common/scalingGraph';
import { SCALING_ORDER } from '../src/common/scalingRegistry';
import { runScalingSources } from '../src/common/triggerUtils';
import { buildFloorSnapshot, recalculatePlayerStats } from '../src/common/statsUtils';
import { Player } from '../src/players/schema/PlayerSchema';
import { Item } from '../src/items/schema/ItemSchema';
import { Talent } from '../src/talents/schema/TalentSchema';
import { AffectedStats } from '../src/common/schema/AffectedStatsSchema';
import { ItemSkillType } from '../src/items/types/ItemSkillTypes';
import { TalentType } from '../src/talents/types/TalentTypes';
import { ItemRarity, EquipSlot } from '../src/items/types/ItemTypes';
import { TriggerType } from '../src/common/types';
import { BehaviorContext } from '../src/common/BehaviorContext';
import { POISON_DURATION_MS } from '../src/common/poisonBalance';
import { ClockTimer } from '@colyseus/timer';

// Pure unit tests for the scaling-order engine (scalingGraph.ts) plus integration tests against
// the real declared sources (scalingRegistry.ts / itemSkillBalance.ts / talentScaling.ts). No
// room, no Colyseus test harness, no MongoDB — same "plain schema instances" idiom as
// statsUtils.test.ts.

function scalingItem(skillId: number, rarity: ItemRarity): Item {
    const item = new Item();
    item.skillId = skillId;
    item.rarity = rarity;
    item.affectedStats = new AffectedStats();
    item.skillAffectedStats = new AffectedStats();
    item.skillAffectedStats2 = new AffectedStats();
    return item;
}

function scalingTalent(talentId: number, activationRate: number): Talent {
    const talent = new Talent();
    talent.talentId = talentId;
    talent.activationRate = activationRate;
    talent.affectedStats = new AffectedStats();
    talent.affectedEnemyStats = new AffectedStats();
    return talent;
}

// ClockTimer.tick() (unlike the base Clock it extends) takes no arguments — it always measures
// deltaTime against real wall-clock time internally. Rewinding `currentTime` before calling it is
// the only way to advance a ClockTimer's Delayed timers by a controlled amount in a unit test.
function advanceClock(clock: ClockTimer, ms: number): void {
    clock.currentTime -= ms;
    clock.tick();
}

function fakeContext(player: Player, attackerSnapshot: ReturnType<typeof buildFloorSnapshot>): BehaviorContext {
    return {
        client: undefined as any, // every behavior sends via `client?.send(...)`, never required
        attacker: player,
        trigger: TriggerType.AURA,
        attackerSnapshot,
    };
}

describe('buildScalingOrder', () => {
    it('orders a simple A -> B chain (A writes what B reads)', () => {
        const defs: ScalingNodeDef[] = [
            { id: skillNode(1), reads: ['maxHp'], writes: ['strength'] }, // B
            { id: skillNode(2), reads: [], writes: ['maxHp'] }, // A
        ];
        const order = buildScalingOrder(defs);
        expect(order.indexOf(skillNode(2))).toBeLessThan(order.indexOf(skillNode(1)));
    });

    it('ignores a self-reference (a node reading a stat it also writes)', () => {
        // Last Stand's real shape: reads defense, writes defense. Must not be treated as an
        // edge to itself, or a lone node could never reach zero indegree.
        const defs: ScalingNodeDef[] = [
            { id: skillNode(1), reads: ['defense'], writes: ['defense'] },
        ];
        expect(() => buildScalingOrder(defs)).not.toThrow();
        expect(buildScalingOrder(defs)).toEqual([skillNode(1)]);
    });

    it('throws, naming both nodes, when two sources mutually read what the other writes', () => {
        const defs: ScalingNodeDef[] = [
            { id: skillNode(1), reads: ['hpRegen'], writes: ['defense'] },
            { id: skillNode(2), reads: ['defense'], writes: ['hpRegen'] },
        ];
        expect(() => buildScalingOrder(defs)).toThrow(/skill:1/);
        expect(() => buildScalingOrder(defs)).toThrow(/skill:2/);
    });

    it('an `after` tie-break resolves an otherwise-cyclic pair deterministically', () => {
        const defs: ScalingNodeDef[] = [
            { id: skillNode(1), reads: ['hpRegen'], writes: ['defense'] },
            { id: skillNode(2), reads: ['defense'], writes: ['hpRegen'], after: [skillNode(1)] },
        ];
        expect(() => buildScalingOrder(defs)).not.toThrow();
        const order = buildScalingOrder(defs);
        expect(order.indexOf(skillNode(1))).toBeLessThan(order.indexOf(skillNode(2)));
    });

    it('a node declared `after` every other node always sorts last', () => {
        const defs: ScalingNodeDef[] = [
            { id: skillNode(1), reads: [], writes: ['maxHp'] },
            { id: skillNode(2), reads: [], writes: ['strength'] },
            {
                id: talentNode(99),
                reads: ['maxHp', 'strength'],
                writes: ['maxHp', 'strength'],
                after: [skillNode(1), skillNode(2)],
            },
        ];
        const order = buildScalingOrder(defs);
        expect(order[order.length - 1]).toBe(talentNode(99));
    });
});

describe('SCALING_ORDER (real declared sources)', () => {
    it('does not throw at module load — no undeclared cycle exists among the real sources', () => {
        // If this suite can even import scalingRegistry.ts, buildScalingOrder already ran once
        // at module load without throwing. Asserting non-emptiness pins that down explicitly.
        expect(SCALING_ORDER.length).toBeGreaterThan(0);
    });

    it('Bulwark runs before Titan\'s Might (both read maxHp it can affect)', () => {
        const bulwark = SCALING_ORDER.indexOf(skillNode(ItemSkillType.BULWARK));
        const titansMight = SCALING_ORDER.indexOf(skillNode(ItemSkillType.TITANS_MIGHT));
        expect(bulwark).toBeGreaterThanOrEqual(0);
        expect(bulwark).toBeLessThan(titansMight);
    });

    it('Last Stand runs before Ironblood (the natural hpRegen edge — no `after` needed)', () => {
        const lastStand = SCALING_ORDER.indexOf(skillNode(ItemSkillType.LAST_STAND));
        const ironblood = SCALING_ORDER.indexOf(skillNode(ItemSkillType.IRONBLOOD));
        expect(lastStand).toBeGreaterThanOrEqual(0);
        expect(lastStand).toBeLessThan(ironblood);
    });

    it('Strong runs before Bulwark (the declared `after` tie-break)', () => {
        const strong = SCALING_ORDER.indexOf(talentNode(TalentType.STRONG));
        const bulwark = SCALING_ORDER.indexOf(skillNode(ItemSkillType.BULWARK));
        expect(strong).toBeGreaterThanOrEqual(0);
        expect(strong).toBeLessThan(bulwark);
    });

    it('Merchant\'s capstone runs strictly last', () => {
        const merchant5 = SCALING_ORDER.indexOf(talentNode(TalentType.MERCHANT_5));
        expect(merchant5).toBe(SCALING_ORDER.length - 1);
    });
});

describe('runScalingSources', () => {
    it('lets Bulwark\'s max HP feed Titan\'s Might\'s strength', () => {
        const player = new Player();
        player.baseStats = Object.assign(new AffectedStats(), { maxHp: 1000, strength: 100 });
        player.equippedItems.set(EquipSlot.ARMOR, scalingItem(ItemSkillType.BULWARK, ItemRarity.MYTHIC));
        player.equippedItems.set(EquipSlot.HELMET, scalingItem(ItemSkillType.TITANS_MIGHT, ItemRarity.MYTHIC));

        const snapshot = buildFloorSnapshot(player);
        const context = fakeContext(player, snapshot);
        runScalingSources(player, context);

        const bulwarkItem = player.equippedItems.get(EquipSlot.ARMOR)!;
        const titansMightItem = player.equippedItems.get(EquipSlot.HELMET)!;

        // Bulwark Mythic: +40% max HP -> 1000 * 0.4 = 400.
        expect(bulwarkItem.skillAffectedStats.maxHp).toBe(400);
        // Titan's Might Mythic (divisor 11) must read the POST-Bulwark max HP (1400), not the
        // floor 1000 — this is the actual chaining the whole system exists to enable.
        expect(titansMightItem.skillAffectedStats.strength).toBe(Math.floor(1400 / 11));
        expect(titansMightItem.skillAffectedStats.strength).toBeGreaterThan(Math.floor(1000 / 11));
    });

    it('two equipped copies of the same scaling skill read the SAME pre-node snapshot, not each other', () => {
        // Regression test for the historical bug: with per-item (rather than per-skill) nodes,
        // two copies of a "reads and writes the same stat" skill would each see the other's
        // freshly-written output and climb every tick. Compound Interest (reads+writes income)
        // is the real skill with exactly that shape.
        const player = new Player();
        player.baseStats = Object.assign(new AffectedStats(), { income: 100 });
        player.equippedItems.set(EquipSlot.MAIN_HAND, scalingItem(ItemSkillType.COMPOUND_INTEREST, ItemRarity.MYTHIC));
        player.equippedItems.set(EquipSlot.OFF_HAND, scalingItem(ItemSkillType.COMPOUND_INTEREST, ItemRarity.MYTHIC));

        const snapshot = buildFloorSnapshot(player);
        const context = fakeContext(player, snapshot);
        runScalingSources(player, context);

        const copyA = player.equippedItems.get(EquipSlot.MAIN_HAND)!.skillAffectedStats.income;
        const copyB = player.equippedItems.get(EquipSlot.OFF_HAND)!.skillAffectedStats.income;

        // Mythic Compound Interest: ratio 0.3 of floor income (100) = 30, for BOTH copies.
        expect(copyA).toBe(30);
        expect(copyB).toBe(30);
    });

    it('a chained board converges instead of climbing across repeated aura ticks', () => {
        // The actual regression test for the old exponential bug: run several ticks of
        // recalculatePlayerStats + the scaling pass and assert the numbers settle rather than
        // grow tick over tick.
        const player = new Player();
        player.baseStats = Object.assign(new AffectedStats(), { maxHp: 1000, strength: 100, defense: 50, hpRegen: 10 });
        player.equippedItems.set(EquipSlot.ARMOR, scalingItem(ItemSkillType.BULWARK, ItemRarity.MYTHIC));
        player.equippedItems.set(EquipSlot.HELMET, scalingItem(ItemSkillType.TITANS_MIGHT, ItemRarity.MYTHIC));
        player.equippedItems.set(EquipSlot.MAIN_HAND, scalingItem(ItemSkillType.LAST_STAND, ItemRarity.MYTHIC));

        const tick = () => {
            const snapshot = buildFloorSnapshot(player);
            runScalingSources(player, fakeContext(player, snapshot));
            recalculatePlayerStats(player);
        };

        for (let i = 0; i < 5; i++) tick();
        const atFive = { maxHp: player.maxHp, strength: player.strength, defense: player.defense };

        for (let i = 0; i < 15; i++) tick();
        const atTwenty = { maxHp: player.maxHp, strength: player.strength, defense: player.defense };

        expect(atTwenty).toEqual(atFive);
        // Sanity: these are finite, bounded numbers, not NaN/Infinity from an unbounded climb.
        expect(Number.isFinite(atTwenty.maxHp)).toBe(true);
        expect(Number.isFinite(atTwenty.strength)).toBe(true);
        expect(Number.isFinite(atTwenty.defense)).toBe(true);
    });
});

describe('Zealot (defense -> attack speed conversion)', () => {
    it('converts half of defense into attack speed, reading the pre-node snapshot', () => {
        const player = new Player();
        player.baseStats = Object.assign(new AffectedStats(), { defense: 100 });
        player.talents.push(scalingTalent(TalentType.ZEALOT, 0.5));

        const snapshot = buildFloorSnapshot(player);
        runScalingSources(player, fakeContext(player, snapshot));
        recalculatePlayerStats(player);

        // 100 defense converted at 50% -> -50 defense, +50% attack speed.
        expect(player.defense).toBe(50);
        expect(player.attackSpeedMultiplier).toBeCloseTo(1.5);
    });

    it('holds steady at exactly half defense across repeated aura ticks, without compounding down', () => {
        const player = new Player();
        player.baseStats = Object.assign(new AffectedStats(), { defense: 100 });
        player.talents.push(scalingTalent(TalentType.ZEALOT, 0.5));

        const tick = () => {
            const snapshot = buildFloorSnapshot(player);
            runScalingSources(player, fakeContext(player, snapshot));
            recalculatePlayerStats(player);
        };

        for (let i = 0; i < 5; i++) tick();
        expect(player.defense).toBe(50);

        for (let i = 0; i < 15; i++) tick();
        // Reading attackerSnapshot (base+item floor, not the live post-conversion defense) is
        // what keeps this at exactly 50 instead of halving 50 -> 25 -> 12.5 -> ... every tick.
        expect(player.defense).toBe(50);
    });

    it('runs after Last Stand, converting the full defense pool including its emergency bonus', () => {
        const player = new Player();
        player.baseStats = Object.assign(new AffectedStats(), { maxHp: 1000, defense: 50, hpRegen: 0 });
        player.maxHp = 1000;
        player.hp = 400; // below 50% max HP — activates Last Stand
        player.equippedItems.set(EquipSlot.MAIN_HAND, scalingItem(ItemSkillType.LAST_STAND, ItemRarity.MYTHIC));
        player.talents.push(scalingTalent(TalentType.ZEALOT, 0.5));

        const snapshot = buildFloorSnapshot(player);
        runScalingSources(player, fakeContext(player, snapshot));
        recalculatePlayerStats(player);

        // Last Stand (Mythic, 100% ratio) doubles defense 50 -> 100 before Zealot converts half.
        expect(player.defense).toBe(50);
        expect(player.attackSpeedMultiplier).toBeCloseTo(1.5);
    });

    it('does not grant bonus defense or sub-1 attack speed when snapshot defense is negative', () => {
        const player = new Player();
        player.baseStats = Object.assign(new AffectedStats(), { defense: -20 });
        player.talents.push(scalingTalent(TalentType.ZEALOT, 0.5));

        const snapshot = buildFloorSnapshot(player);
        runScalingSources(player, fakeContext(player, snapshot));
        recalculatePlayerStats(player);

        // Player.defense clamps negative to 0 on assignment; the point of this test is that
        // Zealot itself contributed nothing (no bonus defense, no attack-speed penalty) rather
        // than converting a negative pool into a positive attack-speed multiplier.
        expect(player.defense).toBe(0);
        expect(player.attackSpeedMultiplier).toBeCloseTo(1);
    });
});

describe('Ironblood (regen bonus + poison cleanse)', () => {
    it('grants a bonus computed from a snapshot that already includes Last Stand\'s regen', () => {
        const player = new Player();
        player.baseStats = Object.assign(new AffectedStats(), { maxHp: 1000, defense: 50, hpRegen: 10 });
        player.maxHp = 1000;
        player.hp = 400; // below 50% max HP — activates Last Stand
        player.equippedItems.set(EquipSlot.MAIN_HAND, scalingItem(ItemSkillType.LAST_STAND, ItemRarity.MYTHIC));
        player.equippedItems.set(EquipSlot.ARMOR, scalingItem(ItemSkillType.IRONBLOOD, ItemRarity.MYTHIC));

        const snapshot = buildFloorSnapshot(player);
        runScalingSources(player, fakeContext(player, snapshot));

        // Last Stand (Mythic) grants +20 hpRegen while active -> floor 10 + 20 = 30.
        // Ironblood (Mythic, 60%) must read THAT 30, not the floor 10.
        const ironbloodItem = player.equippedItems.get(EquipSlot.ARMOR)!;
        expect(ironbloodItem.skillAffectedStats.hpRegen).toBe(Math.round(30 * 0.6));
        expect(ironbloodItem.skillAffectedStats.hpRegen).toBeGreaterThan(Math.round(10 * 0.6));
    });

    it('cleanses poison stacks up to the bonus amount and suppresses regen this tick', () => {
        const player = new Player();
        player.baseStats = Object.assign(new AffectedStats(), { hpRegen: 20 });
        player.poisonStack = 10;
        player.equippedItems.set(EquipSlot.ARMOR, scalingItem(ItemSkillType.IRONBLOOD, ItemRarity.MYTHIC));

        const snapshot = buildFloorSnapshot(player);
        runScalingSources(player, fakeContext(player, snapshot));

        // Mythic bonus = round(20 * 0.6) = 12, which covers all 10 live stacks.
        expect(player.poisonStack).toBe(0);
        expect(player.regenSuppressed).toBe(true);

        recalculatePlayerStats(player);
        // healingEffectiveness recovers the instant the last poison stack is gone.
        expect(player.healingEffectiveness).toBe(1);
        // regenSuppressed forces the final hpRegen to 0 even though Ironblood's own
        // skillAffectedStats.hpRegen is a positive 12 — the "heal nothing while cleansing" rule.
        expect(player.hpRegen).toBe(0);
    });

    it('grants the plain bonus with no suppression when there is no poison to cleanse', () => {
        const player = new Player();
        player.baseStats = Object.assign(new AffectedStats(), { hpRegen: 20 });
        player.equippedItems.set(EquipSlot.ARMOR, scalingItem(ItemSkillType.IRONBLOOD, ItemRarity.MYTHIC));

        const snapshot = buildFloorSnapshot(player);
        runScalingSources(player, fakeContext(player, snapshot));

        expect(player.regenSuppressed).toBe(false);
        recalculatePlayerStats(player);
        expect(player.hpRegen).toBe(20 + Math.round(20 * 0.6));
    });

    it('two equipped copies cleanse double the stacks but hpRegen still lands at exactly 0, never negative', () => {
        const player = new Player();
        player.baseStats = Object.assign(new AffectedStats(), { hpRegen: 20 });
        player.poisonStack = 20;
        player.equippedItems.set(EquipSlot.ARMOR, scalingItem(ItemSkillType.IRONBLOOD, ItemRarity.MYTHIC));
        player.equippedItems.set(EquipSlot.HELMET, scalingItem(ItemSkillType.IRONBLOOD, ItemRarity.MYTHIC));

        const snapshot = buildFloorSnapshot(player);
        runScalingSources(player, fakeContext(player, snapshot));

        // Each copy's bonus is round(20 * 0.6) = 12; the two copies together cleanse min(20, 24) = 20.
        expect(player.poisonStack).toBe(0);
        expect(player.regenSuppressed).toBe(true);

        recalculatePlayerStats(player);
        expect(player.hpRegen).toBe(0);
    });

    it('poisonConsumedDebt: a cleanse mid-duration does not let the original application\'s expiry wipe a LATER, still-live application', () => {
        const player = new Player();
        const clock = new ClockTimer();
        const fakeClient = { send: () => {} } as any;

        // A: 10 stacks applied at t=0 (expires once 5000ms of ITS OWN elapsed time pass).
        player.addPoisonStacks(clock, fakeClient, 10);
        advanceClock(clock, 2000); // 2s in — A not due yet.

        // Ironblood cleanses 6 of A's stacks well before A expires.
        const cleansed = player.consumePoisonStacks(6);
        expect(cleansed).toBe(6);
        expect(player.poisonStack).toBe(4);

        // B: a fresh 5-stack application lands now (e.g. re-poisoned), 2s behind A.
        player.addPoisonStacks(clock, fakeClient, 5);
        expect(player.poisonStack).toBe(9);

        // Advance 3001ms more: A's own elapsed time reaches 5001ms and its expiry fires; B's
        // elapsed time is only 3001ms and is NOT due yet. Without poisonConsumedDebt, A's expiry
        // would blindly subtract the full 10 it originally applied, wiping into B's still-live
        // stacks (9 - 10 -> clamped to 0). With the debt absorbing the 6 already cleansed, A's
        // expiry only removes the 4 of ITS OWN stacks still outstanding, leaving B's 5 untouched.
        advanceClock(clock, POISON_DURATION_MS - 2000 + 1);
        expect(player.poisonStack).toBe(5);
    });
});
