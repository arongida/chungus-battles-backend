import { mulberry32 } from '../src/bot/v2/rng';
import {
    bestSlotFor, buildDecisionContext, chooseJokerPick, chooseLossReward, chooseTalentAction,
    HeuristicPolicyV2, itemCombatValue, nextDraftAction, scoreBuys, scoreReroll, scoreSells,
    scoreUnequips,
} from '../src/bot/v2/HeuristicPolicyV2';
import { ARCHETYPES, rollArchetype } from '../src/bot/v2/archetypes';
import { expectedActivations, buildActivationContext, scalingSynergy } from '../src/bot/v2/synergy';
import { buildPowerContext } from '../src/bot/v2/combatModel';
import { skillNode, talentNode } from '../src/common/scalingGraph';
import { ItemSkillType } from '../src/items/types/ItemSkillTypes';
import { TalentType } from '../src/talents/types/TalentTypes';
import { TriggerType } from '../src/common/types';
import { BotAction, DraftObservation, ItemView, StatBlock, TalentView } from '../src/bot/BotPolicy';
import { makeDraftObs, makeItem, makeLossRewardObs, makePlayer, makeTalent, makeWeapon } from './helpers/botFixtures';

// Pure tests for heuristic-v2 — no MongoDB, no Colyseus room. The fuzz suites at the bottom are
// the safety net: one asserts every emitted action is legal against the observation it came from,
// the other asserts the unified argmax actually terminates instead of oscillating.

function ctxFor(obs: DraftObservation, archetypeId: keyof typeof ARCHETYPES = 'balanced') {
    return buildDecisionContext(obs, ARCHETYPES[archetypeId]);
}

function activationCtx(obs: DraftObservation) {
    return buildActivationContext(obs, buildPowerContext(obs));
}

describe('expectedActivations — the fix for "every skill is worth the same"', () => {
    it('never fires an on-dodge effect on a build with no dodge', () => {
        const obs = makeDraftObs({ player: makePlayer({ stats: { ...makePlayer().stats, dodgeRate: 0 } }) });
        expect(expectedActivations([TriggerType.ON_DODGE], activationCtx(obs))).toBe(0);
    });

    it('scales on-dodge activations with dodge rating', () => {
        const low = activationCtx(makeDraftObs({ player: makePlayer({ stats: { ...makePlayer().stats, dodgeRate: 20 } }) }));
        const high = activationCtx(makeDraftObs({ player: makePlayer({ stats: { ...makePlayer().stats, dodgeRate: 200 } }) }));
        expect(expectedActivations([TriggerType.ON_DODGE], high))
            .toBeGreaterThan(expectedActivations([TriggerType.ON_DODGE], low));
    });

    it('scales active procs by exactly (100 + cooldownReduction)/100', () => {
        const base = makePlayer().stats;
        const plain = activationCtx(makeDraftObs({ player: makePlayer({ stats: { ...base, cooldownReduction: 0 } }) }));
        const hasted = activationCtx(makeDraftObs({ player: makePlayer({ stats: { ...base, cooldownReduction: 50 } }) }));
        const opts = { activationRate: 1 };
        // fightSeconds can differ between boards, so compare the per-second rate.
        const plainRate = expectedActivations([TriggerType.ACTIVE], plain, opts) / plain.fightSeconds;
        const hastedRate = expectedActivations([TriggerType.ACTIVE], hasted, opts) / hasted.fightSeconds;
        expect(hastedRate / plainRate).toBeCloseTo(1.5, 6);
    });

    it('treats shop-phase triggers as producing no combat activations', () => {
        const ctx = activationCtx(makeDraftObs());
        expect(expectedActivations([TriggerType.SHOP_START], ctx)).toBe(0);
        expect(expectedActivations([TriggerType.AFTER_REFRESH], ctx)).toBe(0);
    });

    it('fires a fight-start effect exactly once', () => {
        expect(expectedActivations([TriggerType.FIGHT_START], activationCtx(makeDraftObs()))).toBe(1);
    });
});

describe('item skills are valued by what they do, not merely that they exist', () => {
    const dodgeBuild = () => makeDraftObs({
        player: makePlayer({
            stats: { ...makePlayer().stats, dodgeRate: 300, attackSpeed: 1 },
            equipped: { mainHand: makeWeapon() },
        }),
    });
    const attackBuild = () => makeDraftObs({
        player: makePlayer({
            stats: { ...makePlayer().stats, dodgeRate: 0, attackSpeed: 2 },
            equipped: { mainHand: makeWeapon() },
        }),
    });

    // Fluid Motion is on-dodge; Exploit Weakness is on-attack. v1 paid a flat +18 for either.
    const fluidMotion = makeItem({
        uid: 50, itemId: 50, class: 'rogue', rarity: 4, equipOptions: ['armor'], affectedStats: {},
        skillId: ItemSkillType.FLUID_MOTION, triggerTypes: [TriggerType.ON_DODGE],
    });
    const exploitWeakness = makeWeapon({
        uid: 51, itemId: 51, class: 'rogue', rarity: 4, equipOptions: ['mainHand'], affectedStats: {},
        skillId: ItemSkillType.EXPLOIT_WEAKNESS, triggerTypes: [TriggerType.ON_ATTACK],
    });

    it('prefers the on-dodge skill on a dodge build', () => {
        const ctx = ctxFor(dodgeBuild());
        expect(itemCombatValue(fluidMotion, ctx)).toBeGreaterThan(0);
    });

    it('ranks the two skills differently depending on the build', () => {
        const dodge = ctxFor(dodgeBuild());
        const attack = ctxFor(attackBuild());
        const dodgeGap = itemCombatValue(fluidMotion, dodge) - itemCombatValue(exploitWeakness, dodge);
        const attackGap = itemCombatValue(fluidMotion, attack) - itemCombatValue(exploitWeakness, attack);
        expect(dodgeGap).toBeGreaterThan(attackGap);
    });

    // item.triggerTypes is a union written when a skill is GRANTED, so a shop item can carry a
    // skill with an empty list. Scoring from that list would silently value every shop skill at
    // zero procs; the skill's own definition is the source of truth.
    it('values a skill on a shop item whose triggerTypes have not been written yet', () => {
        const ctx = ctxFor(dodgeBuild());
        const granted = makeItem({ ...fluidMotion, triggerTypes: [TriggerType.ON_DODGE] });
        const notYetGranted = makeItem({ ...fluidMotion, triggerTypes: [] });
        expect(itemCombatValue(notYetGranted, ctx)).toBeCloseTo(itemCombatValue(granted, ctx), 6);
    });

    it('gives an on-dodge skill no credit at all on a zero-dodge build', () => {
        const ctx = ctxFor(attackBuild());
        const withSkill = itemCombatValue(fluidMotion, ctx);
        const withoutSkill = itemCombatValue(makeItem({ ...fluidMotion, skillId: 0, triggerTypes: [] }), ctx);
        expect(withSkill).toBeCloseTo(withoutSkill, 6);
    });
});

describe('scalingSynergy — read straight out of the server\'s own scaling graph', () => {
    const stats = (overrides: Partial<StatBlock> = {}): StatBlock => ({
        maxHp: 200, hp: 200, strength: 10, accuracy: 5, defense: 10, attackSpeed: 1,
        dodgeRate: 0, hpRegen: 0, income: 0, cooldownReduction: 0, ...overrides,
    });

    it('values Titan\'s Might by the max HP it feeds on', () => {
        const node = skillNode(ItemSkillType.TITANS_MIGHT);
        const fat = scalingSynergy(node, stats({ maxHp: 3000 }), new Set());
        const thin = scalingSynergy(node, stats({ maxHp: 200 }), new Set());
        expect(fat).toBeGreaterThan(thin);
    });

    it('rewards a chain when a source already owned writes what this one reads', () => {
        const node = skillNode(ItemSkillType.TITANS_MIGHT); // reads maxHp
        const alone = scalingSynergy(node, stats({ maxHp: 1000 }), new Set());
        // Bulwark writes maxHp, so owning it feeds Titan's Might.
        const chained = scalingSynergy(node, stats({ maxHp: 1000 }), new Set([skillNode(ItemSkillType.BULWARK)]));
        expect(chained).toBeGreaterThan(alone);
    });

    it('is zero for something that is not a scaling source', () => {
        expect(scalingSynergy(talentNode(TalentType.JOKER), stats(), new Set())).toBe(0);
    });
});

describe('talent selection', () => {
    it('picks a talent even when every offered one is unmapped', () => {
        const unknown = [9001, 9002, 9003].map((id) => makeTalent({ talentId: id, affectedStats: {} }));
        const obs = makeDraftObs({
            availableTalents: unknown, remainingTalentPoints: 1, talentRerollUsed: [false, false, false],
        });
        const action = chooseTalentAction(ctxFor(obs));
        expect(action).not.toBeNull();
        expect(['select_talent', 'refresh_talent_slot']).toContain(action!.type);
    });

    it('does nothing without a talent point', () => {
        const obs = makeDraftObs({ availableTalents: [makeTalent()], remainingTalentPoints: 0, talentRerollUsed: [false] });
        expect(chooseTalentAction(ctxFor(obs))).toBeNull();
    });

    it('prefers a talent that fits the build over one that cannot fire', () => {
        // Hidden Vials is on-dodge; Unstoppable Force is an active. On a no-dodge board with
        // cooldown reduction, the active should win.
        const hiddenVials = makeTalent({
            talentId: TalentType.HIDDEN_VIALS, tier: 5, triggerTypes: [TriggerType.ON_DODGE],
            activationRate: 2, affectedStats: {}, tags: ['talent', 'rogue'],
        });
        const unstoppable = makeTalent({
            talentId: TalentType.WARRIOR_3, tier: 3, triggerTypes: [TriggerType.ACTIVE],
            activationRate: 0.5, scaling: 0.5, affectedStats: {}, tags: ['collection', 'warrior'],
        });
        const obs = makeDraftObs({
            player: makePlayer({
                stats: { ...makePlayer().stats, dodgeRate: 0, cooldownReduction: 60 },
                equipped: { mainHand: makeWeapon() },
            }),
            availableTalents: [hiddenVials, unstoppable],
            remainingTalentPoints: 1, talentRerollUsed: [true, true],
        });
        const action = chooseTalentAction(ctxFor(obs));
        expect(action).toEqual(expect.objectContaining({ type: 'select_talent', talentId: TalentType.WARRIOR_3 }));
    });

    it('never rerolls a slot whose reroll is already spent', () => {
        const talents = [
            makeTalent({ talentId: TalentType.WARRIOR_5, tier: 5, base: 100, affectedStats: {} }),
            makeTalent({ talentId: TalentType.JOKER, tier: 1, affectedStats: {} }),
        ];
        const obs = makeDraftObs({
            availableTalents: talents, remainingTalentPoints: 1, talentRerollUsed: [true, true],
        });
        expect(chooseTalentAction(ctxFor(obs))!.type).toBe('select_talent');
    });
});

describe('chooseJokerPick', () => {
    it('picks by power rather than by the biggest raw number', () => {
        // v1 took maxHp 50 over strength 10 purely because 50 > 10.
        const obs = makeDraftObs({
            player: makePlayer({
                stats: { ...makePlayer().stats, maxHp: 4000, defense: 300, strength: 5 },
                equipped: { mainHand: makeWeapon() },
            }),
            jokerPendingCards: [{ stat: 'maxHp', amount: 50 }, { stat: 'strength', amount: 10 }],
        });
        const action = chooseJokerPick(ctxFor(obs));
        expect(action).toEqual(expect.objectContaining({ type: 'joker_pick', stat: 'strength' }));
    });

    it('returns null when no cards are pending', () => {
        expect(chooseJokerPick(ctxFor(makeDraftObs()))).toBeNull();
    });
});

describe('buying', () => {
    it('will not consider an item it cannot afford', () => {
        const obs = makeDraftObs({
            player: makePlayer({ gold: 3 }),
            shop: [makeItem({ itemId: 7, price: 30, affectedStats: { strength: 50 } })],
        });
        expect(scoreBuys(ctxFor(obs))).toEqual([]);
    });

    it('scores a strong cheap item above a weak expensive one', () => {
        const obs = makeDraftObs({
            player: makePlayer({ gold: 40, equipped: { mainHand: makeWeapon() } }),
            shop: [
                makeItem({ itemId: 1, price: 5, equipOptions: ['armor'], affectedStats: { defense: 30, maxHp: 100 } }),
                makeItem({ itemId: 2, price: 35, equipOptions: ['helmet'], affectedStats: { defense: 1 } }),
            ],
        });
        const scored = scoreBuys(ctxFor(obs)).sort((a, b) => b.score - a.score);
        expect((scored[0].action as any).itemId).toBe(1);
    });

    it('prices a free-claim item at zero gold', () => {
        const obs = makeDraftObs({
            player: makePlayer({ gold: 0, comradeFreeClaim: true, equipped: { mainHand: makeWeapon() } }),
            shop: [makeItem({ itemId: 3, price: 30, equipOptions: ['armor'], affectedStats: { defense: 20 } })],
        });
        expect(scoreBuys(ctxFor(obs))).toHaveLength(1);
    });
});

describe('selling', () => {
    it('never sells the source item of a shop upgrade preview', () => {
        const owned = makeItem({ uid: 9, itemId: 77, sellPrice: 100, affectedStats: {} });
        const obs = makeDraftObs({
            player: makePlayer({ inventory: [owned] }),
            shop: [makeItem({ itemId: 77, upgradePreview: true, price: 12 })],
        });
        expect(scoreSells(ctxFor(obs))).toEqual([]);
    });

    it('is willing to sell a worthless inventory item', () => {
        const junk = makeItem({ uid: 9, itemId: 77, sellPrice: 20, price: 1, affectedStats: {} });
        const obs = makeDraftObs({ player: makePlayer({ inventory: [junk] }) });
        const sells = scoreSells(ctxFor(obs));
        expect(sells).toHaveLength(1);
        expect(sells[0].score).toBeGreaterThan(0);
    });
});

describe('unequip safety', () => {
    it('addresses the EQUIPPED item\'s uid, never an inventory uid', () => {
        // DraftRoom.unequipItem matches on the equipped item's uid; an inventory uid is a silent
        // no-op, so getting this wrong burns draft steps with no error anywhere.
        const cursed = makeItem({ uid: 400, itemId: 400, equipOptions: ['armor'], affectedStats: { defense: -200, maxHp: -400 } });
        const obs = makeDraftObs({
            player: makePlayer({
                equipped: { armor: cursed, mainHand: makeWeapon({ uid: 401 }) },
                inventory: [makeItem({ uid: 999, itemId: 999, equipOptions: ['helmet'] })],
            }),
        });
        for (const { action } of scoreUnequips(ctxFor(obs))) {
            expect((action as any).uid).toBe(400);
        }
    });

    it('does not unequip a slot an inventory item is waiting to fill', () => {
        const weak = makeItem({ uid: 1, itemId: 1, equipOptions: ['armor'], affectedStats: { defense: -50 } });
        const replacement = makeItem({ uid: 2, itemId: 2, equipOptions: ['armor'], affectedStats: { defense: 10 } });
        const obs = makeDraftObs({
            player: makePlayer({ equipped: { armor: weak }, inventory: [replacement] }),
        });
        expect(scoreUnequips(ctxFor(obs))).toEqual([]);
    });
});

describe('rerolling', () => {
    it('does not spend a free reroll on a shop holding a standout item', () => {
        const obs = makeDraftObs({
            player: makePlayer({ freeRerollCharges: 1, equipped: { mainHand: makeWeapon() } }),
            shop: [
                makeItem({ itemId: 1, price: 10, equipOptions: ['armor'], affectedStats: { defense: 80, maxHp: 400 } }),
                makeItem({ itemId: 2, price: 10, equipOptions: ['helmet'], affectedStats: {} }),
                makeItem({ itemId: 3, price: 10, equipOptions: ['helmet'], affectedStats: {} }),
            ],
        });
        expect(scoreReroll(ctxFor(obs))!.score).toBeLessThan(0);
    });

    it('will not reroll with no gold and no free reroll', () => {
        const obs = makeDraftObs({ player: makePlayer({ gold: 0, refreshShopCost: 3, freeRerollCharges: 0 }) });
        expect(scoreReroll(ctxFor(obs))).toBeNull();
    });
});

describe('loss reward', () => {
    it('takes gold when nothing else is on offer', () => {
        const obs = makeLossRewardObs({
            player: makePlayer({ level: 5, xp: 0, maxXp: 0 }),
            itemUpgradeAvailable: false, goldAmount: 40, xpAmount: 0,
        });
        expect(chooseLossReward(obs, ARCHETYPES.balanced)).toBe('gold');
    });

    it('returns a valid choice for every combination', () => {
        for (const itemUpgradeAvailable of [true, false]) {
            for (const level of [1, 3, 5]) {
                const choice = chooseLossReward(makeLossRewardObs({
                    player: makePlayer({ level, equipped: { mainHand: makeWeapon() } }),
                    itemUpgradeAvailable, itemUpgradeCount: 2,
                }), ARCHETYPES.balanced);
                expect(['gold', 'xp', 'item_upgrade']).toContain(choice);
            }
        }
    });
});

describe('archetypes', () => {
    it('rolls deterministically from a seed', () => {
        expect(rollArchetype(12345).id).toBe(rollArchetype(12345).id);
    });

    it('produces more than one identity across seeds', () => {
        const ids = new Set(Array.from({ length: 200 }, (_, i) => rollArchetype(i).id));
        expect(ids.size).toBeGreaterThan(1);
    });

    // Guards against archetypes being wired up but inert, which is invisible otherwise.
    it('changes at least some decisions between a tank and a bruiser', () => {
        let differences = 0;
        for (let seed = 0; seed < 40; seed++) {
            const obs = randomObservation(seed);
            const tank = nextDraftAction(ctxFor(obs, 'tank-paladin'));
            const bruiser = nextDraftAction(ctxFor(obs, 'bruiser-warrior'));
            if (JSON.stringify(tank) !== JSON.stringify(bruiser)) differences++;
        }
        expect(differences).toBeGreaterThan(0);
    });

    it('is deterministic for a given seed and observation', () => {
        const policy = new HeuristicPolicyV2({ seed: 7 });
        const twin = new HeuristicPolicyV2({ seed: 7 });
        expect(policy.archetypeId).toBe(twin.archetypeId);
        for (let seed = 0; seed < 20; seed++) {
            const obs = randomObservation(seed);
            expect(nextDraftAction(buildDecisionContext(obs, ARCHETYPES[policy.archetypeId])))
                .toEqual(nextDraftAction(buildDecisionContext(obs, ARCHETYPES[twin.archetypeId])));
        }
    });
});

// --- fuzzing ----------------------------------------------------------------------------------

let fuzzSeed = 1;
function rand(): number {
    fuzzSeed = (fuzzSeed * 1103515245 + 12345) & 0x7fffffff;
    return fuzzSeed / 0x7fffffff;
}

function randomItem(id: number): ItemView {
    const slots = [['mainHand'], ['offHand'], ['armor'], ['helmet'], ['drink']];
    return makeItem({
        uid: id, itemId: id,
        price: Math.floor(rand() * 30), sellPrice: Math.floor(rand() * 20),
        rarity: 1 + Math.floor(rand() * 5),
        class: ['', 'rogue', 'warrior', 'merchant'][Math.floor(rand() * 4)],
        equipOptions: slots[Math.floor(rand() * slots.length)],
        affectedStats: { strength: rand() * 20 - 5, defense: rand() * 10, maxHp: rand() * 100 },
        baseMinDamage: rand() < 0.5 ? rand() * 5 : 0,
        baseMaxDamage: rand() < 0.5 ? rand() * 15 : 0,
        baseAttackSpeed: rand() < 0.5 ? rand() * 1.5 : 0,
        strengthScaling: rand() * 2,
        skillId: rand() < 0.3 ? [101, 203, 301, 402, 501][Math.floor(rand() * 5)] : 0,
        futureSkillId: rand() < 0.2 ? 101 : 0,
        upgradePreview: rand() < 0.2,
        luckyFindSteps: rand() < 0.1 ? 1 : 0,
        sold: rand() < 0.1,
    });
}

function randomTalent(id: number): TalentView {
    const known = Object.values(TalentType).filter((v): v is number => typeof v === 'number');
    const triggers = [TriggerType.ACTIVE, TriggerType.ON_ATTACK, TriggerType.ON_DODGE, TriggerType.AURA];
    return makeTalent({
        talentId: rand() < 0.85 ? known[Math.floor(rand() * known.length)] : 9000 + id,
        tier: 1 + Math.floor(rand() * 5),
        tags: [['talent', 'rogue'], ['talent', 'warrior'], ['collection', 'merchant'], []][Math.floor(rand() * 4)],
        triggerTypes: [triggers[Math.floor(rand() * triggers.length)]],
        activationRate: rand() * 2,
        base: rand() * 10,
        scaling: rand(),
        affectedStats: rand() < 0.3 ? { strength: rand() * 5 } : {},
    });
}

function randomObservation(seed: number): DraftObservation {
    fuzzSeed = seed + 1;
    const shop = Array.from({ length: Math.floor(rand() * 6) }, (_, i) => randomItem(i + 1));
    const inventory = Array.from({ length: Math.floor(rand() * 4) }, (_, i) => randomItem(100 + i));
    const equippedItem = rand() < 0.7 ? randomItem(200) : null;
    const talentCount = Math.floor(rand() * 4);
    return makeDraftObs({
        round: 1 + Math.floor(rand() * 14),
        player: makePlayer({
            round: 1 + Math.floor(rand() * 14),
            level: 1 + Math.floor(rand() * 5),
            xp: Math.floor(rand() * 20), maxXp: 10 + Math.floor(rand() * 40),
            gold: Math.floor(rand() * 60),
            lives: Math.floor(rand() * 5), wins: Math.floor(rand() * 12), losses: Math.floor(rand() * 5),
            stats: {
                maxHp: 100 + rand() * 2000, hp: 100, strength: rand() * 80, accuracy: rand() * 60,
                defense: rand() * 300, attackSpeed: 0.5 + rand() * 2, dodgeRate: rand() * 200,
                hpRegen: rand() * 20, income: rand() * 20, cooldownReduction: rand() * 80,
            },
            refreshShopCost: 1 + Math.floor(rand() * 5),
            freeRerollCharges: rand() < 0.2 ? 1 : 0,
            freeRerolls: rand() < 0.1,
            potionCapacity: 1, pendingPotionEffects: rand() < 0.3 ? [501] : [],
            comradeFreeClaim: rand() < 0.15,
            equipped: equippedItem ? { mainHand: equippedItem } : {},
            inventory,
            talents: Array.from({ length: talentCount }, (_, i) => randomTalent(300 + i)),
        }),
        shop,
        availableTalents: rand() < 0.4 ? [randomTalent(1), randomTalent(2), randomTalent(3)] : [],
        remainingTalentPoints: rand() < 0.4 ? 1 : 0,
        talentRerollUsed: [rand() < 0.5, rand() < 0.5, rand() < 0.5],
        jokerPendingCards: rand() < 0.15 ? [{ stat: 'strength', amount: 5 }, { stat: 'maxHp', amount: 40 }] : undefined,
    });
}

function assertLegal(action: BotAction, obs: DraftObservation) {
    switch (action.type) {
        case 'buy':
            expect(obs.shop.some((i) => i.itemId === action.itemId && !i.sold)).toBe(true);
            break;
        case 'sell':
            expect(obs.player.inventory.some((i) => i.uid === action.uid)).toBe(true);
            break;
        case 'equip':
            expect(obs.player.inventory.some((i) => i.uid === action.uid)).toBe(true);
            if (action.slot !== 'drink') {
                const item = obs.player.inventory.find((i) => i.uid === action.uid)!;
                expect(item.equipOptions).toContain(action.slot);
            }
            break;
        case 'unequip': {
            // Must address the equipped item, not an inventory copy.
            const equipped = obs.player.equipped[action.slot];
            expect(equipped).toBeDefined();
            expect(equipped!.uid).toBe(action.uid);
            break;
        }
        case 'select_talent':
        case 'refresh_talent_slot':
            expect(obs.availableTalents.some((t) => t.talentId === action.talentId)).toBe(true);
            expect(obs.remainingTalentPoints).toBeGreaterThan(0);
            break;
        case 'joker_pick':
            expect((obs.jokerPendingCards ?? []).some((c) => c.stat === action.stat)).toBe(true);
            break;
        case 'level_up':
            expect(obs.player.level).toBeLessThan(5);
            expect(obs.player.xp).toBeLessThan(obs.player.maxXp);
            break;
        default:
            break;
    }
}

describe('nextDraftAction fuzzing', () => {
    it('emits only legal, well-formed actions across 1000 random observations', () => {
        for (let seed = 0; seed < 1000; seed++) {
            const obs = randomObservation(seed);
            const archetype = rollArchetype(seed);
            const action = nextDraftAction(buildDecisionContext(obs, archetype));
            expect(action).toBeDefined();
            assertLegal(action, obs);
        }
    });

    it('never emits an action type the driver cannot perform', () => {
        const supported = new Set([
            'buy', 'sell', 'undo_sell', 'equip', 'unequip', 'refresh_shop', 'buy_xp', 'level_up',
            'select_talent', 'refresh_talent_slot', 'joker_pick', 'lock_shop', 'unlock_shop', 'end_draft',
        ]);
        for (let seed = 0; seed < 300; seed++) {
            const obs = randomObservation(seed);
            expect(supported.has(nextDraftAction(buildDecisionContext(obs, rollArchetype(seed))).type)).toBe(true);
        }
    });
});

// The failure mode the lexicographic chain structurally could not have: with one argmax over every
// action, an equip/unequip or buy/sell pair can trade places forever. The runner's rejection check
// cannot see it (the state genuinely changes each time), so the round would just burn all 60 steps.
describe('nextDraftAction convergence', () => {
    /** Equipping an item changes the player's absolute stats — UpdateStatsCommand recalculates
     *  them every tick and the runner re-observes after every action, so a reducer that moved
     *  items between slots without updating `stats` would be testing a state the server never
     *  produces (and would report oscillations that don't exist). */
    function applyStatDelta(stats: StatBlock, delta: Partial<StatBlock>, sign: 1 | -1): StatBlock {
        const out = { ...stats };
        for (const [key, value] of Object.entries(delta)) {
            if (value === undefined) continue;
            if (key === 'attackSpeed') {
                if (value !== 0 && value !== 1) out.attackSpeed += sign * (value - 1);
            } else {
                (out as any)[key] += sign * value;
            }
        }
        return out;
    }

    /** A small reducer that applies an action to the observation, standing in for DraftRoom. */
    function apply(obs: DraftObservation, action: BotAction): DraftObservation {
        const player = { ...obs.player, equipped: { ...obs.player.equipped }, stats: { ...obs.player.stats } };
        const next: DraftObservation = { ...obs, player, shop: [...obs.shop], step: obs.step + 1 };
        switch (action.type) {
            case 'buy': {
                const item = next.shop.find((i) => i.itemId === action.itemId)!;
                next.shop = next.shop.map((i) => (i.itemId === action.itemId ? { ...i, sold: true } : i));
                player.gold -= item.price;
                player.inventory = [...player.inventory, { ...item, sold: false }];
                break;
            }
            case 'sell': {
                const item = player.inventory.find((i) => i.uid === action.uid)!;
                player.inventory = player.inventory.filter((i) => i.uid !== action.uid);
                player.gold += item.sellPrice;
                break;
            }
            case 'equip': {
                const item = player.inventory.find((i) => i.uid === action.uid)!;
                player.inventory = player.inventory.filter((i) => i.uid !== action.uid);
                if (action.slot === 'drink') {
                    player.pendingPotionEffects = [...player.pendingPotionEffects, item.skillId];
                } else {
                    const incumbent = player.equipped[action.slot];
                    if (incumbent) {
                        player.inventory = [...player.inventory, incumbent];
                        player.stats = applyStatDelta(player.stats, incumbent.affectedStats, -1);
                    }
                    player.equipped[action.slot] = item;
                    player.stats = applyStatDelta(player.stats, item.affectedStats, 1);
                }
                break;
            }
            case 'unequip': {
                const item = player.equipped[action.slot]!;
                delete player.equipped[action.slot];
                player.inventory = [...player.inventory, item];
                player.stats = applyStatDelta(player.stats, item.affectedStats, -1);
                break;
            }
            case 'refresh_shop':
                player.rerollsThisRound += 1;
                if (player.freeRerollCharges > 0) player.freeRerollCharges -= 1;
                else player.gold -= player.refreshShopCost;
                next.shop = next.shop.map((i, idx) => ({ ...i, itemId: i.itemId + 1000, uid: i.uid + 1000, sold: false, price: 5 + idx }));
                break;
            case 'level_up':
                player.gold -= Math.ceil((player.maxXp - player.xp) / 4) * 4;
                player.level += 1;
                player.xp = 0;
                player.maxXp += 20;
                break;
            case 'select_talent':
                player.talents = [...player.talents, obs.availableTalents.find((t) => t.talentId === action.talentId)!];
                next.remainingTalentPoints = 0;
                next.availableTalents = [];
                break;
            case 'refresh_talent_slot': {
                const index = obs.availableTalents.findIndex((t) => t.talentId === action.talentId);
                next.talentRerollUsed = obs.talentRerollUsed.map((used, i) => (i === index ? true : used));
                break;
            }
            case 'joker_pick':
                next.jokerPendingCards = undefined;
                break;
            default:
                break;
        }
        return next;
    }

    it('reaches end_draft within 40 steps from 200 random starts', () => {
        const stuck: string[] = [];
        for (let seed = 0; seed < 200; seed++) {
            let obs = randomObservation(seed);
            const archetype = rollArchetype(seed);
            let steps = 0;
            let action = nextDraftAction(buildDecisionContext(obs, archetype));
            while (action.type !== 'end_draft' && steps < 40) {
                obs = apply(obs, action);
                action = nextDraftAction(buildDecisionContext(obs, archetype));
                steps++;
            }
            if (action.type !== 'end_draft') stuck.push(`seed ${seed}: still doing ${action.type} after ${steps} steps`);
        }
        expect(stuck).toEqual([]);
    });

    it('still converges when a scouted next enemy shifts the reference', () => {
        const stuck: string[] = [];
        for (let seed = 0; seed < 100; seed++) {
            const base = randomObservation(seed);
            const rand = mulberry32(seed + 5000);
            let obs: DraftObservation = {
                ...base,
                nextEnemyRevealLevel: 100,
                nextEnemyBuild: {
                    avatarClass: (['rogue', 'warrior', 'merchant'] as const)[seed % 3],
                    level: base.player.level,
                    stats: {
                        ...base.player.stats,
                        defense: rand() * 150, dodgeRate: rand() * 150, strength: 5 + rand() * 80,
                        attackSpeed: 0.8 + rand() * 1.5, maxHp: 200 + rand() * 1500,
                    },
                    equipped: { mainHand: makeWeapon({ uid: 9000, itemId: 9000 }) },
                    talents: [],
                },
                player: { ...base.player, lives: 1 + (seed % 4) },
            };
            const archetype = rollArchetype(seed);
            let steps = 0;
            let action = nextDraftAction(buildDecisionContext(obs, archetype));
            while (action.type !== 'end_draft' && steps < 40) {
                obs = apply(obs, action);
                action = nextDraftAction(buildDecisionContext(obs, archetype));
                steps++;
            }
            if (action.type !== 'end_draft') stuck.push(`seed ${seed}: still doing ${action.type} after ${steps} steps`);
        }
        expect(stuck).toEqual([]);
    });
});
