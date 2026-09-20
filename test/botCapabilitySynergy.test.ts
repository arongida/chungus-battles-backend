import { buildDecisionContext, bestSlotFor, talentValue } from '../src/bot/v2/HeuristicPolicyV2';
import { supplyOfItem, valueItemSkills, supplyOfTalent, valueTalent } from '../src/bot/v2/synergy';
import { ARCHETYPES } from '../src/bot/v2/archetypes';
import { ItemSkillType } from '../src/items/types/ItemSkillTypes';
import { TalentType } from '../src/talents/types/TalentTypes';
import { TriggerType } from '../src/common/types';
import { makeDraftObs, makePlayer, makeWeapon, makeTalent } from './helpers/botFixtures';

const source = makeWeapon({ uid: 2, skillId: ItemSkillType.COATED_EDGE, affectedStats: {} });
const consumer = makeWeapon({ uid: 3, skillId: ItemSkillType.PLAGUE_BEARER, affectedStats: {} });
function context(equipped = {}) {
    return buildDecisionContext(makeDraftObs({ player: makePlayer({ equipped }) }), ARCHETYPES.balanced);
}

describe('cross-source capability synergy', () => {
    it('values Plague Bearer only with equipped poison supply', () => {
        const empty = context();
        const poison = context({ mainHand: source });
        expect(valueItemSkills(consumer, empty.activation, ARCHETYPES.balanced, false).auraStats.attackSpeed).toBe(1);
        expect(valueItemSkills(consumer, poison.activation, ARCHETYPES.balanced, false).auraStats.attackSpeed).toBeGreaterThan(1);
    });

    it('counts only the supplying weapon swings, excluding fight-start reset triggers', () => {
        const one = context({ mainHand: source });
        const two = context({ mainHand: source, offHand: makeWeapon({ baseAttackSpeed: 3 }) });
        expect(supplyOfItem(source, one.activation)).toEqual(supplyOfItem(source, { ...two.activation, fightSeconds: one.activation.fightSeconds }));
        const stopped = { ...one.activation, fightSeconds: 0 };
        expect(supplyOfItem(source, stopped).enemyPoison).toBe(0);
    });

    it('prefers keeping the consumer when equipping a supplier', () => {
        const ctx = context({ mainHand: consumer });
        const flexible = { ...source, equipOptions: ['mainHand', 'offHand'] };
        expect(bestSlotFor(flexible, ctx).slot).toBe('offHand');
        const plain = context({ mainHand: { ...consumer, skillId: 0 } });
        expect(bestSlotFor(flexible, ctx).power).toBeGreaterThan(bestSlotFor(flexible, plain).power);
    });

    // Not just "on or off": the payoff has to track HOW MUCH poison the build applies, or two
    // sources would look no better than one and the bot would stop building into the theme.
    it('scales the consumer with the amount of poison supplied', () => {
        const talent = makeTalent({ talentId: TalentType.POISON_2, triggerTypes: [TriggerType.ON_ATTACK], activationRate: 2 });
        const oneSource = buildDecisionContext(
            makeDraftObs({ player: makePlayer({ equipped: { mainHand: source } }) }),
            ARCHETYPES.balanced,
        );
        const twoSources = buildDecisionContext(
            makeDraftObs({ player: makePlayer({ equipped: { mainHand: source }, talents: [talent] }) }),
            ARCHETYPES.balanced,
        );
        expect(twoSources.activation.enemyPoisonStacks).toBeGreaterThan(oneSource.activation.enemyPoisonStacks);
        expect(bestSlotFor(consumer, twoSources).power).toBeGreaterThan(bestSlotFor(consumer, oneSource).power);
    });

    it('does not retain poison credit when its only supplier is replaced', () => {
        const poison = context({ mainHand: source });
        const noSource = context({ mainHand: { ...source, skillId: 0 } });
        expect(bestSlotFor(consumer, poison).power).toBeLessThan(bestSlotFor(consumer, noSource).power);
    });

    it('values a poison talent more when an owned skill consumes poison', () => {
        const talent = makeTalent({ talentId: TalentType.POISON_2, triggerTypes: [TriggerType.ON_ATTACK], activationRate: 2 });
        expect(talentValue(talent, context({ mainHand: consumer }))).toBeGreaterThan(
            talentValue(talent, context({ mainHand: { ...consumer, skillId: 0 } })),
        );
    });

    it('Hidden Vials supplies neither poison nor burn without dodges', () => {
        const talent = makeTalent({ talentId: TalentType.HIDDEN_VIALS, triggerTypes: [TriggerType.ON_DODGE], activationRate: 2 });
        expect(supplyOfTalent(talent, context().activation)).toEqual({ enemyPoison: 0, enemyBurn: 0, selfBurn: 0 });
    });
});


describe('burn payoff balance', () => {
    it('uses the talent healing percentage and caps each player separately', () => {
        const talent = makeTalent({ talentId: TalentType.FIRE_WITH_FIRE, base: 2, activationRate: 1, triggerTypes: [TriggerType.ACTIVE] });
        const activation = { ...context().activation, fightSeconds: 1, enemyBurnStacks: 30, selfBurnStacks: 30 };
        expect(valueTalent(talent, activation, ARCHETYPES.balanced).ehpPerFight).toBe(20 * 0.02 * activation.stats.maxHp);
        expect(valueTalent(talent, { ...activation, enemyBurnStacks: 0, selfBurnStacks: 0 }, ARCHETYPES.balanced).ehpPerFight).toBe(0);
    });
});
