import {
    buildDecisionContext, classLevelUpPower, HeuristicPolicyV2, itemEconomyValue, talentValue,
} from '../src/bot/v2/HeuristicPolicyV2';
import {
    ARCHETYPES, ARCHETYPE_IDS, BOT_CLASSES, rollClassAndArchetype,
} from '../src/bot/v2/archetypes';
import { blendReference, referenceEnemy, scoutedEnemy } from '../src/bot/v2/combatModel';
import { scoutWeight } from '../src/bot/v2/economy';
import { buildActivationContext, expectedActivations } from '../src/bot/v2/synergy';
import { buildPowerContext } from '../src/bot/v2/combatModel';
import { TALENT_HINTS } from '../src/bot/v2/talentCatalog';
import { classToAvatar } from '../src/bot/botIdentity';
import { TalentType } from '../src/talents/types/TalentTypes';
import { TriggerType } from '../src/common/types';
import { PlayerAvatar } from '../src/players/types/PlayerTypes';
import { BotClass, DraftObservation, EnemyBuildView, PlayerView, TalentView } from '../src/bot/BotPolicy';
import { makeDraftObs, makeItem, makePlayer, makeTalent, makeWeapon } from './helpers/botFixtures';

// heuristic-v2.1: class-locked archetypes, downside/anti-synergy pricing, next-enemy scouting.

const ctxFor = (obs: DraftObservation) => buildDecisionContext(obs, ARCHETYPES.balanced);

// Talent parameters as they sit in the database.
const comrade = makeTalent({ talentId: TalentType.COMRADE, tags: ['talent', 'merchant'], triggerTypes: [TriggerType.AURA], activationRate: 1, affectedStats: {} });
const fortunesFool = makeTalent({ talentId: TalentType.FORTUNES_FOOL, tags: ['collection', 'merchant'], triggerTypes: [TriggerType.AURA, TriggerType.FIGHT_START], base: 0.05, scaling: 0.99, affectedStats: {} });
const bargainHunter = makeTalent({ talentId: TalentType.BARGAIN_HUNTER, tags: ['collection', 'merchant'], triggerTypes: [TriggerType.AURA], affectedStats: {} });
const robbery = makeTalent({ talentId: TalentType.ROBBERY, tags: ['talent', 'rogue', 'thief'], triggerTypes: [TriggerType.SHOP_START], activationRate: 1, affectedStats: {} });
const incomeInequality = makeTalent({ talentId: TalentType.MERCHANT_5, tags: ['collection', 'merchant'], triggerTypes: [TriggerType.AURA], base: 10, scaling: 1, affectedStats: {} });
const berserk = makeTalent({ talentId: TalentType.BERSERK, tags: ['collection', 'warrior'], triggerTypes: [TriggerType.AURA], base: 1, scaling: 1.4, activationRate: 0.6, affectedStats: {} });
const bully = makeTalent({ talentId: TalentType.WARRIOR_2, tags: ['collection', 'warrior'], triggerTypes: [TriggerType.ACTIVE], base: 1.2, activationRate: 0.25, affectedStats: {} });
const sharpeningStone = makeTalent({ talentId: TalentType.SHARPENING_STONE, tags: ['collection', 'warrior'], triggerTypes: [TriggerType.AURA], base: 10, affectedStats: {} });

function player(overrides: Partial<PlayerView> = {}, stats: Partial<PlayerView['stats']> = {}): PlayerView {
    const base = makePlayer();
    return makePlayer({
        round: 5, level: 3, gold: 30,
        equipped: { mainHand: makeWeapon() },
        ...overrides,
        stats: { ...base.stats, maxHp: 600, hp: 600, strength: 40, accuracy: 20, defense: 30, income: 10, ...stats },
    });
}

function enemyBuild(overrides: Partial<EnemyBuildView> = {}, stats: Partial<PlayerView['stats']> = {}): EnemyBuildView {
    return {
        avatarClass: 'warrior', level: 3, talents: [],
        equipped: { mainHand: makeWeapon({ uid: 900, itemId: 900 }) },
        ...overrides,
        stats: { ...makePlayer().stats, maxHp: 700, hp: 700, strength: 40, accuracy: 20, defense: 40, ...stats },
    };
}

describe('class-locked archetypes', () => {
    it('only ever pairs a class with an archetype that class may play', () => {
        const counts: Record<string, number> = {};
        for (let seed = 0; seed < 1000; seed++) {
            const { avatarClass, archetype } = rollClassAndArchetype(seed);
            expect(archetype.classes).toContain(avatarClass);
            counts[avatarClass] = (counts[avatarClass] ?? 0) + 1;
        }
        for (const cls of BOT_CLASSES) {
            expect(counts[cls]).toBeGreaterThan(250);
            expect(counts[cls]).toBeLessThan(420);
        }
    });

    it('gives a forced archetype one of its own classes', () => {
        for (const id of ARCHETYPE_IDS) {
            for (let seed = 0; seed < 20; seed++) {
                const policy = new HeuristicPolicyV2({ seed, archetypeId: id });
                expect(ARCHETYPES[id].classes).toContain(policy.avatarClass);
            }
        }
        expect(new HeuristicPolicyV2({ seed: 1, archetypeId: 'dodge-rogue' }).avatarClass).toBe('rogue');
    });

    it('replays the same class and archetype from the same seed', () => {
        const a = new HeuristicPolicyV2({ seed: 777 });
        const b = new HeuristicPolicyV2({ seed: 777 });
        expect([a.avatarClass, a.archetypeId]).toEqual([b.avatarClass, b.archetypeId]);
    });

    it('maps each class to its avatar', () => {
        expect(classToAvatar('rogue')).toBe(PlayerAvatar.THIEF);
        expect(classToAvatar('warrior')).toBe(PlayerAvatar.WARRIOR);
        expect(classToAvatar('merchant')).toBe(PlayerAvatar.MERCHANT);
    });

    it('prefers own-class talents from the very first pick', () => {
        const value = (cls: BotClass) => talentValue(sharpeningStone, ctxFor(makeDraftObs({ player: player({ avatarClass: cls }) })))!;
        expect(value('warrior')).toBeGreaterThan(value('merchant'));
    });

    it('values the class level-up grant, and nothing without a class', () => {
        for (const cls of BOT_CLASSES) {
            expect(classLevelUpPower(ctxFor(makeDraftObs({ player: player({ avatarClass: cls }) })))).toBeGreaterThan(0);
        }
        expect(classLevelUpPower(ctxFor(makeDraftObs({ player: player() })))).toBe(0);
    });
});

describe('downsides priced against the rest of the build', () => {
    it('Comrade is worth more when rerolls are free (Fortune\'s Fool, Bargain Hunter)', () => {
        const value = (talents: TalentView[]) => talentValue(comrade, ctxFor(makeDraftObs({ player: player({ talents }) })))!;
        const alone = value([]);
        expect(value([fortunesFool])).toBeGreaterThan(alone);
        expect(value([bargainHunter])).toBeGreaterThan(alone);
    });

    it('Comrade\'s tax shrinks with income', () => {
        const value = (income: number) => TALENT_HINTS[TalentType.COMRADE].goldPerRound!(comrade, {
            ...buildActivationContext(makeDraftObs({ player: player({}, { income }) }), buildPowerContext(makeDraftObs({ player: player({}, { income }) }))),
            procs: 1,
        });
        expect(value(0)).toBeGreaterThan(value(10));
    });

    it('a -income item costs a Comrade board less than a board without Comrade', () => {
        const drain = makeItem({ uid: 60, itemId: 60, equipOptions: ['armor'], affectedStats: { income: -3, defense: 5 } });
        const economy = (talents: TalentView[], refreshShopCost: number) =>
            itemEconomyValue(drain, ctxFor(makeDraftObs({ player: player({ talents, refreshShopCost, inventory: [drain] }) })));
        expect(economy([comrade], 12)).toBeGreaterThan(economy([], 2));
    });

    it('Robbery\'s compounding income loss hurts an Income Inequality board', () => {
        const value = (talents: TalentView[]) => talentValue(robbery, ctxFor(makeDraftObs({ player: player({ talents }, { income: 20 }) })))!;
        expect(value([incomeInequality])).toBeLessThan(value([]));
    });

    it('Robbery is no longer free money: it is worth less than the gold it steals', () => {
        const ctx = ctxFor(makeDraftObs({ player: player() }));
        const stolen = TALENT_HINTS[TalentType.ROBBERY].goldPerRound!(robbery, { ...ctx.activation, procs: 0 });
        expect(talentValue(robbery, ctx)!).toBeLessThan(stolen * ctx.remainingFights * ctx.rate * ctx.economyWeight);
    });

    it('Berserk gets more uptime from Fortune\'s Fool\'s missing HP', () => {
        const value = (talents: TalentView[]) => talentValue(berserk, ctxFor(makeDraftObs({ player: player({ talents }) })))!;
        expect(value([fortunesFool])).toBeGreaterThan(value([]));
    });

    it('Fortune\'s Fool\'s HP cost shows up on the board', () => {
        const ctx = buildActivationContext(makeDraftObs({ player: player({ talents: [fortunesFool] }) }), buildPowerContext(makeDraftObs({ player: player() })));
        expect(ctx.startHpFraction).toBeLessThan(1);
        expect(ctx.paidRerollsPerRound).toBe(0);
    });
});

describe('next-enemy scouting', () => {
    it('scouts the enemy\'s real numbers and blends them with the round curve', () => {
        const generic = referenceEnemy(5);
        const scouted = scoutedEnemy(enemyBuild({}, { defense: 300 }));
        expect(scouted.defense).toBe(300);
        expect(blendReference(generic, scouted, 0)).toEqual(generic);
        expect(blendReference(generic, scouted, 1).defense).toBeCloseTo(300);
        expect(blendReference(generic, scouted, 0.5).defense).toBeCloseTo((generic.defense + 300) / 2);
    });

    it('leans harder on the scouted enemy as lives run out', () => {
        expect(scoutWeight(player({ lives: 1 }))).toBeGreaterThan(scoutWeight(player({ lives: 4 })));
    });

    it('counts more on-attacked procs against a fast-swinging enemy', () => {
        const procs = (attackSpeed: number) => {
            const obs = makeDraftObs({ player: player({ lives: 1 }), nextEnemyBuild: enemyBuild({}, { attackSpeed }) });
            return expectedActivations([TriggerType.ON_ATTACKED], buildActivationContext(obs, buildPowerContext(obs)))
                / buildPowerContext(obs).fightSeconds;
        };
        expect(procs(3)).toBeGreaterThan(procs(1));
    });

    it('prices Bully by whether the bot actually out-muscles the scouted enemy', () => {
        const value = (enemyStrength: number) => talentValue(bully, ctxFor(makeDraftObs({
            player: player({ lives: 1 }), nextEnemyBuild: enemyBuild({}, { strength: enemyStrength }),
        })))!;
        expect(value(10)).toBeGreaterThan(value(200));
    });

    it('prices Wit\'s End by the scouted enemy\'s class', () => {
        const witsEnd = makeTalent({ talentId: TalentType.WITS_END, tags: ['talent', 'rogue'], triggerTypes: [TriggerType.FIGHT_END], base: 3, affectedStats: {} });
        const once = (cls: BotClass) => {
            const obs = makeDraftObs({ player: player(), nextEnemyBuild: enemyBuild({ avatarClass: cls }) });
            return TALENT_HINTS[TalentType.WITS_END].goldOnce!(witsEnd, { ...buildActivationContext(obs, buildPowerContext(obs)), procs: 1 });
        };
        expect(once('merchant')).toBeGreaterThan(once('rogue'));
    });

    it('scores one-fight potions against the scouted enemy only', () => {
        const obs = makeDraftObs({ player: player({ lives: 4 }), nextEnemyBuild: enemyBuild({}, { defense: 400 }) });
        const blended = buildPowerContext(obs).ref.defense;
        const full = buildPowerContext(obs, 1).ref.defense;
        expect(full).toBeCloseTo(400);
        expect(blended).toBeLessThan(full);
    });
});
