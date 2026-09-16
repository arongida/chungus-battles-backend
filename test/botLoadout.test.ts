import { TalentType } from '../src/talents/types/TalentTypes';
import { TriggerType } from '../src/common/types';
import { evaluateLoadout } from '../src/bot/v2/loadout';
import { buildDecisionContext, scoreEquips, itemEconomyValue, bestSlotFor } from '../src/bot/v2/HeuristicPolicyV2';
import { ARCHETYPES } from '../src/bot/v2/archetypes';
import { valueItemSkills } from '../src/bot/v2/synergy';
import { ItemSkillType as Skill } from '../src/items/types/ItemSkillTypes';
import { makeDraftObs, makeItem, makePlayer, makeWeapon, makeTalent } from './helpers/botFixtures';

const neutral = ARCHETYPES.balanced;
const helmet = (income: number, uid = 1) => makeItem({ uid, affectedStats: { income }, equipOptions: ['helmet'], type: 'helmet' });
const ctx = (obs: ReturnType<typeof makeDraftObs>) => buildDecisionContext(obs, neutral);

describe('economy loadouts', () => {
    it('equips an income-only item', () => {
        const item = helmet(5);
        const c = ctx(makeDraftObs({ player: makePlayer({ inventory: [item] }) }));
        expect(scoreEquips(c)).toEqual([expect.objectContaining({ action: expect.objectContaining({ type: 'equip', uid: 1 }), score: expect.any(Number) })]);
        expect(scoreEquips(c)[0].score).toBeCloseTo(itemEconomyValue(item, c));
    });
    it('subtracts the displaced income and rejects an inferior replacement', () => {
        const old = helmet(5), candidate = helmet(3, 2);
        const obs = makeDraftObs({ player: makePlayer({ stats: { ...makePlayer().stats, income: 9 }, equipped: { helmet: old }, inventory: [candidate] }) });
        expect(itemEconomyValue(candidate, ctx(obs))).toBeLessThan(0);
        expect(scoreEquips(ctx(obs))).toEqual([]);
    });
    it('keeps income gear when choosing between otherwise identical slots', () => {
        const old = helmet(5), candidate = makeItem({ uid: 2, affectedStats: { defense: 10 }, equipOptions: ['helmet', 'armor'] });
        const obs = makeDraftObs({ player: makePlayer({ stats: { ...makePlayer().stats, income: 9 }, equipped: { helmet: old }, inventory: [candidate] }) });
        const actions = scoreEquips(ctx(obs)).sort((a, b) => b.score - a.score);
        expect(actions[0].action).toMatchObject({ slot: 'armor' });
        expect(itemEconomyValue(candidate, ctx(obs))).toBe(0);
    });
});

describe('scaling loadouts', () => {
    const obs = makeDraftObs({ player: makePlayer({ stats: { ...makePlayer().stats, maxHp: 1800, hp: 1800, hpRegen: 10, income: 20 } }) });
    const gear = (skillId: number, uid = 1) => makeItem({ uid, skillId, rarity: 4, affectedStats: {}, equipOptions: ['helmet'] });
    it('prices all five scaling skills before they are equipped', () => {
        for (const id of [Skill.TITANS_MIGHT, Skill.IRONBLOOD, Skill.BULWARK, Skill.LAST_STAND, Skill.COMPOUND_INTEREST]) {
            const v = valueItemSkills(gear(id), ctx(obs).activation, neutral, false);
            expect(Object.values(v.auraStats).some(n => n > 0)).toBe(true);
        }
        expect(valueItemSkills(gear(Skill.TITANS_MIGHT), ctx(obs).activation, neutral, false).auraStats.strength).toBe(100);
    });
    it('orders Bulwark before Titan and does not self-compound duplicate Bulwarks', () => {
        const result = evaluateLoadout(obs, { helmet: gear(Skill.BULWARK), armor: gear(Skill.BULWARK, 2), mainHand: gear(Skill.TITANS_MIGHT, 3) });
        expect(result.stats.maxHp).toBe(2520);
        expect(result.stats.strength).toBe(5 + Math.floor(2520 / 18));
    });
    it('removes measured aura output before rebuilding both skill slots', () => {
        const item = { ...gear(Skill.BULWARK), skillId2: Skill.TITANS_MIGHT, skillAffectedStats: { maxHp: 360 }, skillAffectedStats2: { strength: 120 } };
        const equippedObs = makeDraftObs({ player: makePlayer({ stats: { ...obs.player.stats, maxHp: 2160, hp: 2160, strength: 125 }, equipped: { helmet: item } }) });
        const result = evaluateLoadout(equippedObs, equippedObs.player.equipped);
        expect(result.stats.maxHp).toBe(2160);
        expect(result.stats.strength).toBe(125);
        expect(evaluateLoadout(equippedObs, {}).stats.maxHp).toBe(1800);
    });
    it('does not recommend swapping identical scaling items back and forth', () => {
        const old = { ...gear(Skill.BULWARK), skillAffectedStats: { maxHp: 360 } };
        const candidate = gear(Skill.BULWARK, 2);
        const state = makeDraftObs({ player: makePlayer({ stats: { ...obs.player.stats, maxHp: 2160, hp: 2160 }, equipped: { helmet: old }, inventory: [candidate] }) });
        expect(bestSlotFor(candidate, ctx(state)).power).toBeCloseTo(0);
        expect(scoreEquips(ctx(state))).toEqual([]);
    });
});

describe('candidate activation contexts', () => {
    it('recalculates attack rates, dodge procs, and fight duration for the candidate', () => {
        const obs = makeDraftObs();
        const item = makeWeapon({ affectedStats: { attackSpeed: 2, dodgeRate: 100 }, baseAttackSpeed: 3 });
        const before = evaluateLoadout(obs, {});
        const after = evaluateLoadout(obs, { mainHand: item });
        expect(after.activation.stats.attackSpeed).toBe(2);
        expect(after.activation.weapons[0].baseAttackSpeed).toBe(3);
        expect(after.activation.expectedDodges).toBeGreaterThan(0);
        expect(before.activation.expectedDodges).toBe(0);
        expect(after.activation.fightSeconds).toBeLessThan(before.activation.fightSeconds);
    });
});


describe('talent candidate recalculation', () => {
    it('applies a newly offered scaling talent before estimating attack procs', () => {
        const obs = makeDraftObs({ player: makePlayer({ equipped: { mainHand: makeWeapon() } }) });
        const strong = makeTalent({ talentId: TalentType.STRONG, activationRate: 0.2, affectedStats: {}, triggerTypes: [TriggerType.AURA] });
        const before = evaluateLoadout(obs, obs.player.equipped);
        const after = evaluateLoadout(obs, obs.player.equipped, neutral, [strong]);
        expect(after.stats.maxHp).toBe(240);
        expect(after.stats.strength).toBe(15);
        expect(after.activation.averageHitDamage).toBeGreaterThan(before.activation.averageHitDamage);
    });
    it('rebuilds an owned non-scaling talent aura from the candidate weapon rate', () => {
        const talent = makeTalent({ talentId: TalentType.ASSASSIN_AMUSEMENT, activationRate: 0.01, affectedStats: {}, triggerTypes: [TriggerType.ON_ATTACK] });
        const obs = makeDraftObs({ player: makePlayer({ talents: [talent] }) });
        const slow = evaluateLoadout(obs, { mainHand: makeWeapon({ baseAttackSpeed: 0.1 }) });
        const fast = evaluateLoadout(obs, { mainHand: makeWeapon({ baseAttackSpeed: 1 }) });
        expect(fast.stats.attackSpeed).toBeGreaterThan(slow.stats.attackSpeed);
    });
});
