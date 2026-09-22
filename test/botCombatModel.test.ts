import {
    addAffected, buildPowerContext, cloneRaw, dodgeChance, estimateDps, estimateEhp, estimatePower,
    FIST, marginalPower, mitigation, normalize, rawStatsFromPlayer, referenceEnemy, weaponProfileOf,
    weaponProfiles, WeaponProfile,
} from '../src/bot/v2/combatModel';
import { StatBlock } from '../src/bot/BotPolicy';
import { makeDraftObs, makeItem, makePlayer, makeWeapon } from './helpers/botFixtures';

// Pure tests for the v2 combat model. These assert against VERIFIED live game math (the formulas
// in FightRoom.tryWeaponAttack / startSingleWeaponTimer, PlayerSchema.getDamageAfterDefense /
// getDodgeChance, statsUtils.recalculatePlayerStats) — if the model drifts from the real fight,
// every decision built on it is wrong, so these are the gating tests for the whole policy.

function stats(overrides: Partial<StatBlock> = {}): StatBlock {
    return {
        maxHp: 200, hp: 200, strength: 10, accuracy: 5, defense: 0, attackSpeed: 1,
        dodgeRate: 0, hpRegen: 0, income: 0, cooldownReduction: 0,
        ...overrides,
    };
}

const NO_MITIGATION = { defense: 0, dodgeRate: 0 };

function weapon(overrides: Partial<WeaponProfile> = {}): WeaponProfile {
    return { baseMinDamage: 2, baseMaxDamage: 8, bonusMaxDamage: 0, baseAttackSpeed: 1, strengthScaling: 1, ...overrides };
}

describe('estimateDps — mirrors FightRoom.tryWeaponAttack', () => {
    it('matches a hand-computed uniform roll for one weapon', () => {
        // min = baseMinDamage + accuracy = 2 + 5 = 7
        // max = baseMaxDamage + bonusMaxDamage + strength * strengthScaling = 8 + 0 + 10*1 = 18
        // avg = 12.5, speed = baseAttackSpeed * attackSpeed = 1 * 1.5 = 1.5  ->  18.75
        const dps = estimateDps(stats({ attackSpeed: 1.5 }), [weapon()], NO_MITIGATION);
        expect(dps).toBeCloseTo(18.75, 6);
    });

    it('sums two weapons, each applying shared strength through its own strengthScaling', () => {
        const slow = weapon({ baseAttackSpeed: 0.5, strengthScaling: 2 });
        const fast = weapon({ baseAttackSpeed: 2, strengthScaling: 0.5 });
        const s = stats();
        const both = estimateDps(s, [slow, fast], NO_MITIGATION);
        expect(both).toBeCloseTo(estimateDps(s, [slow], NO_MITIGATION) + estimateDps(s, [fast], NO_MITIGATION), 6);
    });

    it('never credits a shield (baseAttackSpeed 0) with damage, even passed in directly', () => {
        const shield = makeItem({ type: 'shield', baseAttackSpeed: 0, equipOptions: ['offHand'], affectedStats: { defense: 20 } });
        expect(weaponProfiles({ offHand: shield })).toEqual([]);
        // Passed straight in, bypassing weaponProfiles' filter: the shield still contributes
        // nothing, and the player falls back to a fist rather than swinging the shield.
        expect(estimateDps(stats(), [weaponProfileOf(shield)], NO_MITIGATION))
            .toBeCloseTo(estimateDps(stats(), [FIST], NO_MITIGATION), 6);
    });

    it('falls back to the fist when nothing equipped swings', () => {
        expect(weaponProfiles({})).toEqual([]);
        // Fist: min = 0 + accuracy, max = 0 + strength*1 -> a bare player still deals damage.
        expect(estimateDps(stats(), [], NO_MITIGATION)).toBeGreaterThan(0);
        expect(estimateDps(stats(), [], NO_MITIGATION)).toBeCloseTo(estimateDps(stats(), [FIST], NO_MITIGATION), 6);
    });

    it('clamps effective speed at 0.1 per weapon, as startSingleWeaponTimer does', () => {
        const slowed = estimateDps(stats({ attackSpeed: 0.01 }), [weapon()], NO_MITIGATION);
        const atClamp = estimateDps(stats({ attackSpeed: 0.1 }), [weapon()], NO_MITIGATION);
        expect(slowed).toBeCloseTo(atClamp, 6);
    });

    it('ranks strengthScaling correctly at high strength and converges at low strength', () => {
        const heavy = weapon({ strengthScaling: 2 });
        const light = weapon({ strengthScaling: 0.5 });
        expect(estimateDps(stats({ strength: 100 }), [heavy], NO_MITIGATION))
            .toBeGreaterThan(estimateDps(stats({ strength: 100 }), [light], NO_MITIGATION));
        const lowHeavy = estimateDps(stats({ strength: 1, accuracy: 1 }), [heavy], NO_MITIGATION);
        const lowLight = estimateDps(stats({ strength: 1, accuracy: 1 }), [light], NO_MITIGATION);
        expect(Math.abs(lowHeavy - lowLight)).toBeLessThan(lowLight * 0.2);
    });

    it('applies the reference enemy mitigation', () => {
        const bare = estimateDps(stats(), [weapon()], NO_MITIGATION);
        expect(estimateDps(stats(), [weapon()], { defense: 100, dodgeRate: 0 })).toBeCloseTo(bare / 2, 6);
    });
});

describe('mitigation / EHP — defense and dodge are the same reducer', () => {
    it('treats +100 defense and +100 dodge as exactly equivalent', () => {
        const byDefense = estimateEhp(stats({ defense: 100, dodgeRate: 0 }), 20);
        const byDodge = estimateEhp(stats({ defense: 0, dodgeRate: 100 }), 20);
        expect(byDefense).toBeCloseTo(byDodge, 6);
        expect(byDefense).toBeCloseTo(400, 6); // 200 maxHp / (100/200) = 400
    });

    it('multiplies the two reducers together', () => {
        expect(mitigation({ defense: 100, dodgeRate: 100 })).toBeCloseTo(0.25, 6);
    });

    it('matches PlayerSchema.getDodgeChance', () => {
        expect(dodgeChance(0)).toBe(0);
        expect(dodgeChance(100)).toBeCloseTo(0.5, 6);
    });

    it('adds regen to the pool before mitigating', () => {
        expect(estimateEhp(stats({ hpRegen: 5, defense: 100 }), 10)).toBeCloseTo((200 + 50) * 2, 6);
    });
});

describe('normalize — reproduces the statsUtils accuracy-overflow rule', () => {
    function raw(strength: number, accuracy: number) {
        return normalize({
            strength, accuracy, defense: 0, maxHp: 200, dodgeRate: 0, hpRegen: 0, income: 0,
            cooldownReduction: 0, attackSpeedMultiplier: 1,
        });
    }

    it('leaves accuracy below strength untouched', () => {
        const s = raw(10, 4);
        expect(s.strength).toBe(10);
        expect(s.accuracy).toBe(4);
    });

    it('is continuous at accuracy === strength', () => {
        const s = raw(10, 10);
        expect(s.strength).toBe(10);
        expect(s.accuracy).toBe(10);
    });

    it('splits excess accuracy across both endpoints past the knee', () => {
        // overflow = (20 - 10)/2 = 5 -> strength 15, accuracy min(20,10) + 5 = 15
        const s = raw(10, 20);
        expect(s.strength).toBe(15);
        expect(s.accuracy).toBe(15);
    });

    it('floors raw strength and accuracy at 1', () => {
        const s = raw(0, 0);
        expect(s.strength).toBe(1);
        expect(s.accuracy).toBe(1);
    });

    it('clamps income at 0 rather than carrying debt into the model', () => {
        const s = normalize({
            strength: 5, accuracy: 5, defense: -3, maxHp: 200, dodgeRate: -1, hpRegen: -2,
            income: -4, cooldownReduction: 0, attackSpeedMultiplier: 1,
        });
        expect(s.income).toBe(0);
        expect(s.defense).toBe(0);
        expect(s.hpRegen).toBe(0);
    });
});

describe('addAffected', () => {
    function emptyRaw() {
        return rawStatsFromPlayer(makePlayer({
            stats: stats({ maxHp: 100, strength: 0, accuracy: 0, attackSpeed: 1 }),
        }));
    }

    it('treats attackSpeed 1 and 0 alike as "no change"', () => {
        expect(addAffected(emptyRaw(), { attackSpeed: 1 }, 1).attackSpeedMultiplier).toBe(1);
        expect(addAffected(emptyRaw(), { attackSpeed: 0 }, 1).attackSpeedMultiplier).toBe(1);
    });

    it('accumulates attackSpeed as (value - 1)', () => {
        const r = addAffected(addAffected(emptyRaw(), { attackSpeed: 1.5 }, 1), { attackSpeed: 1.5 }, 1);
        expect(r.attackSpeedMultiplier).toBeCloseTo(2, 6); // two +50% sources = +100%
    });

    it('is reversible with sign -1', () => {
        const base = emptyRaw();
        const there = addAffected(cloneRaw(base), { strength: 7, defense: 3, attackSpeed: 1.2 }, 1);
        const back = addAffected(there, { strength: 7, defense: 3, attackSpeed: 1.2 }, -1);
        expect(back).toEqual(base);
    });
});

describe('estimatePower — diminishing returns and balance pressure', () => {
    const ref = { defense: 20, dodgeRate: 0, dps: 30, ehp: 600, attackRate: 1, strength: 0 };

    it('has diminishing returns on defense', () => {
        const low = stats({ defense: 0 });
        const high = stats({ defense: 200 });
        const gainLow = estimatePower({ ...low, defense: 10 }, [weapon()], ref) - estimatePower(low, [weapon()], ref);
        const gainHigh = estimatePower({ ...high, defense: 210 }, [weapon()], ref) - estimatePower(high, [weapon()], ref);
        expect(gainLow).toBeGreaterThan(gainHigh);
    });

    // The test that encodes the whole point of the rework: the model, not a hand-tuned penalty,
    // is what stops the bot building a lopsided character.
    it('values damage more on a tanky board and survivability more on a glass cannon', () => {
        const tanky = buildPowerContext(makeDraftObs({
            player: makePlayer({ stats: stats({ maxHp: 3000, defense: 300, strength: 5, accuracy: 5 }) }),
        }));
        const glassCannon = buildPowerContext(makeDraftObs({
            player: makePlayer({ stats: stats({ maxHp: 150, defense: 0, strength: 120, accuracy: 60 }) }),
        }));

        const moreDamage = { addStats: [{ strength: 20 } as Partial<StatBlock>] };
        const moreHp = { addStats: [{ maxHp: 300 } as Partial<StatBlock>] };

        expect(marginalPower(tanky, moreDamage)).toBeGreaterThan(marginalPower(tanky, moreHp));
        expect(marginalPower(glassCannon, moreHp)).toBeGreaterThan(marginalPower(glassCannon, moreDamage));
    });
});

describe('marginalPower', () => {
    const ctx = () => buildPowerContext(makeDraftObs({
        player: makePlayer({
            stats: stats({ strength: 20, accuracy: 10, maxHp: 400, defense: 30 }),
            equipped: { mainHand: makeWeapon({ uid: 99 }) },
        }),
    }));

    it('is zero for an empty change', () => {
        expect(marginalPower(ctx(), {})).toBeCloseTo(0, 9);
    });

    it('is positive for a stat gain and negative for the same stat lost', () => {
        const c = ctx();
        expect(marginalPower(c, { addStats: [{ strength: 10 }] })).toBeGreaterThan(0);
        expect(marginalPower(c, { removeStats: [{ strength: 10 }] })).toBeLessThan(0);
    });

    it('does not mutate the context it scores against', () => {
        const c = ctx();
        const before = { ...c.raw };
        marginalPower(c, { addStats: [{ strength: 50, maxHp: 500 }], addWeapon: weapon() });
        expect(c.raw).toEqual(before);
        expect(marginalPower(c, {})).toBeCloseTo(0, 9);
    });

    it('displaces the fist when the first real weapon is added', () => {
        const bare = buildPowerContext(makeDraftObs({ player: makePlayer({ stats: stats(), equipped: {} }) }));
        expect(bare.weapons).toEqual([]);
        const w = weapon({ baseAttackSpeed: 1, baseMaxDamage: 8 });
        expect(marginalPower(bare, { addWeapon: w })).toBeGreaterThan(0);
        // The fist is a fallback, not a weapon that keeps swinging alongside the new one.
        const armed = buildPowerContext(makeDraftObs({
            player: makePlayer({ stats: stats(), equipped: { mainHand: makeWeapon({ baseMinDamage: 2, baseMaxDamage: 8, baseAttackSpeed: 1 }) } }),
        }));
        expect(armed.weapons).toHaveLength(1);
    });

    it('gains nothing from equipping a shield as a weapon', () => {
        const c = ctx();
        const shieldProfile = { ...weapon(), baseAttackSpeed: 0 };
        expect(marginalPower(c, { addWeapon: shieldProfile })).toBeCloseTo(0, 9);
    });

    it('values swapping a weak weapon for a strong one', () => {
        const weak = weapon({ baseMinDamage: 1, baseMaxDamage: 2, baseAttackSpeed: 0.8 });
        const strong = weapon({ baseMinDamage: 5, baseMaxDamage: 20, baseAttackSpeed: 1.2 });
        const c = buildPowerContext(makeDraftObs({
            player: makePlayer({
                stats: stats(),
                equipped: { mainHand: makeWeapon({ baseMinDamage: 1, baseMaxDamage: 2, baseAttackSpeed: 0.8 }) },
            }),
        }));
        expect(marginalPower(c, { addWeapon: strong, removeWeapon: weak })).toBeGreaterThan(0);
    });
});

describe('referenceEnemy', () => {
    it('is never a degenerate zero reference, even at round 1', () => {
        const ref = referenceEnemy(1);
        expect(ref.defense).toBeGreaterThan(0);
        expect(ref.dodgeRate).toBeGreaterThan(0);
        expect(ref.dps).toBeGreaterThan(0);
        expect(ref.ehp).toBeGreaterThan(0);
    });

    it('scales with the round', () => {
        expect(referenceEnemy(10).ehp).toBeGreaterThan(referenceEnemy(1).ehp);
        expect(referenceEnemy(10).defense).toBeGreaterThan(referenceEnemy(1).defense);
    });

    // The invariant the equip/unequip oscillation violated: a mirrored reference made `power` a
    // non-function of the board, so the same item could be worth both adding and removing.
    it('does not depend on the player\'s own stats', () => {
        const weak = buildPowerContext(makeDraftObs({
            player: makePlayer({ round: 5, stats: stats({ defense: 0, maxHp: 100 }) }),
        }));
        const tanky = buildPowerContext(makeDraftObs({
            player: makePlayer({ round: 5, stats: stats({ defense: 400, maxHp: 4000 }) }),
        }));
        expect(weak.ref).toEqual(tanky.ref);
    });
});

describe('power is a consistent function of the board', () => {
    // Directly guards the oscillation: if adding an item improves power, then removing that same
    // item from the resulting board must NOT also improve it.
    it('never rates both adding and removing the same stats as a gain', () => {
        const deltas: Partial<StatBlock>[] = [
            { defense: 40 }, { maxHp: 500 }, { strength: 25 }, { dodgeRate: 60 },
            { defense: 30, strength: -4 }, { maxHp: 200, defense: -10 }, { hpRegen: 8 },
        ];
        const base = makePlayer({
            round: 6,
            stats: stats({ maxHp: 600, strength: 20, accuracy: 10, defense: 40, dodgeRate: 20 }),
            equipped: { mainHand: makeWeapon() },
        });

        for (const delta of deltas) {
            const without = buildPowerContext(makeDraftObs({ player: base }));
            const addGain = marginalPower(without, { addStats: [delta] });

            // Same board, now holding the delta.
            const withStats = { ...base.stats };
            for (const [k, v] of Object.entries(delta)) {
                if (k === 'attackSpeed') withStats.attackSpeed += v as number;
                else (withStats as any)[k] += v as number;
            }
            const withIt = buildPowerContext(makeDraftObs({ player: { ...base, stats: withStats } }));
            const removeGain = marginalPower(withIt, { removeStats: [delta] });

            expect(Math.min(addGain, removeGain)).toBeLessThanOrEqual(0);
        }
    });
});
