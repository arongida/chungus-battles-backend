/**
 * heuristic-v2. Every decision is scored in one currency — power, as defined by combatModel.ts —
 * so buying, rerolling, levelling, equipping and selling compete in a single argmax instead of
 * v1's fixed priority chain.
 *
 * What changed from v1, and why:
 *  - Items are valued by the power they add to THIS board (diminishing returns, weapon DPS,
 *    balance pressure), not by a linear weighted sum of their stat delta.
 *  - Item skills are read from their real definitions and weighted by how often they will actually
 *    fire (v1 paid a flat +18 for any skill, so an on-dodge proc on a no-dodge build looked great).
 *  - Talents are read from a coverage-complete catalog, because 37 of the 47 offerable talents
 *    carry no stats at all and were invisible to v1.
 *  - Gold, income and XP convert into power through a shop-derived exchange rate and a horizon
 *    that knows how many fights the run has left.
 *  - An archetype rolled from the run's seed shifts affinities, so a batch produces varied builds.
 *
 * Structure mirrors v1 deliberately: every scorer is an exported pure function of the observation,
 * so the whole file is unit-testable without a server or a database.
 */
import { evaluateLoadout } from './loadout';
import {
    BotAction, BotPolicy, DraftObservation, EquipSlotName, ItemView, LossRewardChoice,
    LossRewardObservation, PolicyDiagnostics, StatBlock, TalentView,
} from '../BotPolicy';
import {
    buildPowerContext, marginalPower, PowerContext,
} from './combatModel';
import {
    ActivationContext, affinityBonus, buildActivationContext, buildAffinity,
    itemScalingSynergy, ownedScalingNodes,
    talentScalingSynergy, valueItemSkills, valueTalent,
} from './synergy';
import {
    goldToPowerRate, isRerollFree, levelUpGoldCost, levelUpValue, MAX_REROLLS_PER_ROUND,
    remainingFights, rerollExpectedGain, economyUrgency,
} from './economy';
import { ARCHETYPES, ArchetypeId, ArchetypeWeights, rollArchetype } from './archetypes';
import { ScalingNodeId } from '../../common/scalingGraph';
import { TalentType } from '../../talents/types/TalentTypes';

// --- tunables ---------------------------------------------------------------------------------

/** An action must beat this much power to be worth taking at all; below it the draft ends. */
const ACTION_EPSILON = 0.05;
/** A swap must beat the incumbent by this much power. Absolute, not a ratio: a ratio misbehaves
 *  when the incumbent's own contribution is zero or negative, which v1 had to special-case. */
const EQUIP_HYSTERESIS_ABS = 0.5;
/** Talent-reroll threshold, as a fraction of the median value of the other offered slots. */
const TALENT_REROLL_FRACTION = 0.6;
/** Used when every offered talent is unmapped, so a full offer of unknowns still gets picked from. */
const UNKNOWN_TALENT_FALLBACK_POWER = 1;
/** Permanent per-fight stat accrual decays: later fights may never happen. */
const STATS_PER_FIGHT_DISCOUNT = 0.6;
const MAX_LEVEL = 5;

export const POLICY_TUNABLES = {
    ACTION_EPSILON, EQUIP_HYSTERESIS_ABS, TALENT_REROLL_FRACTION,
    UNKNOWN_TALENT_FALLBACK_POWER, STATS_PER_FIGHT_DISCOUNT,
};

/** Identifies the tunable set a run used, so a tuning pass stays separable in telemetry without
 *  hand-bumping `version` (which v1's header asks for and nobody remembers to do). */
export function policyConfigHash(): string {
    const json = JSON.stringify(POLICY_TUNABLES);
    let h = 0x811c9dc5;
    for (let i = 0; i < json.length; i++) {
        h ^= json.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16);
}

// --- decision context -------------------------------------------------------------------------

export interface DecisionContext {
    obs: DraftObservation;
    power: PowerContext;
    activation: ActivationContext;
    archetype: ArchetypeWeights;
    affinity: Map<string, number>;
    ownedScaling: Set<ScalingNodeId>;
    /** Power per gold at today's shop prices. */
    rate: number;
    economyWeight: number;
    combatWeight: number;
    remainingFights: number;
    onUnknown?: (id: number) => void;
}

/** Guards against a silent NaN: with strictNullChecks off, one undefined field turns a score into
 *  NaN, every comparison against it is false, and the bot quietly degrades to "always take the
 *  first option" with no error anywhere. */
function assertFinite(n: number, label: string): number {
    if (!Number.isFinite(n)) throw new Error(`[heuristic-v2] ${label} produced a non-finite score: ${n}`);
    return n;
}

export function buildDecisionContext(
    obs: DraftObservation, archetype: ArchetypeWeights, onUnknown?: (id: number) => void,
): DecisionContext {
    const power = buildPowerContext(obs);
    const activation = buildActivationContext(obs, power);
    const urgency = economyUrgency(obs.player, archetype.riskTolerance);
    const partial: DecisionContext = {
        obs, power, activation, archetype,
        affinity: buildAffinity(obs.player),
        ownedScaling: ownedScalingNodes(obs.player),
        rate: 0,
        economyWeight: urgency.economyWeight * archetype.economyWeight,
        combatWeight: urgency.combatWeight,
        remainingFights: remainingFights(obs.player),
        onUnknown,
    };
    // The rate is derived from combat-only values, which must therefore be computed without it —
    // that is what keeps this from being circular.
    partial.rate = goldToPowerRate(
        obs.shop.filter((i) => !i.sold).map((item) => ({ value: itemCombatValue(item, partial), price: item.price })),
    );
    return partial;
}

// --- item valuation ---------------------------------------------------------------------------

function equipSlots(item: ItemView): EquipSlotName[] {
    return item.equipOptions.filter((s) => s !== 'drink') as EquipSlotName[];
}

export function isPotion(item: ItemView): boolean {
    return item.equipOptions.includes('drink');
}

type BoardValue = ReturnType<typeof evaluateLoadout>;
const boardCache = new WeakMap<DecisionContext, Map<ItemView | null | undefined, Map<EquipSlotName | undefined, BoardValue>>>();
function boardFor(ctx: DecisionContext, item?: ItemView | null, slot?: EquipSlotName): BoardValue {
    let items = boardCache.get(ctx);
    if (!items) { items = new Map(); boardCache.set(ctx, items); }
    let slots = items.get(item);
    if (!slots) { slots = new Map(); items.set(item, slots); }
    let result = slots.get(slot);
    if (!result) {
        result = evaluateLoadout(ctx.obs, slot ? { ...ctx.obs.player.equipped, [slot]: item } : ctx.obs.player.equipped, ctx.archetype, undefined, ctx.onUnknown);
        slots.set(slot, result);
    }
    return result;
}

/** Power gained by putting `item` into `slot`, displacing whatever is there. */
function equipGainFor(item: ItemView, slot: EquipSlotName | null, ctx: DecisionContext): number {
    if (!slot) return skillPowerOf(item, ctx);
    const before = boardFor(ctx);
    const after = boardFor(ctx, item, slot);
    return after.power - before.power;
}

/** Standalone skill value for consumables, which do not occupy an equipment slot. */
function skillPowerOf(item: ItemView, ctx: DecisionContext): number {
    const skills = valueItemSkills(item, ctx.activation, ctx.archetype, false, ctx.onUnknown);
    return marginalPower(ctx.power, {
        addStats: [skills.auraStats],
        addDamagePerFight: skills.damagePerFight,
        addEhp: skills.ehpPerFight,
    });
}

/** Taking an equipped item off. The mirror image of equipping it, so "worth unequipping" and
 *  "worth equipping" can never both be true. */
function removalGainFor(item: ItemView, ctx: DecisionContext): number {
    const slot = Object.entries(ctx.obs.player.equipped).find(([, owned]) => owned?.uid === item.uid)?.[0];
    const before = boardFor(ctx);
    const after = boardFor(ctx, null, slot as EquipSlotName);
    return (after.power - before.power) * ctx.combatWeight + economyDelta(before, after, ctx);
}

function economyDelta(before: ReturnType<typeof evaluateLoadout>, after: ReturnType<typeof evaluateLoadout>, ctx: DecisionContext): number {
    return ((after.income - before.income) + (after.goldPerRound - before.goldPerRound))
        * ctx.remainingFights * ctx.rate * ctx.economyWeight;
}

function equipEconomyGain(item: ItemView, slot: EquipSlotName, ctx: DecisionContext): number {
    return economyDelta(boardFor(ctx),
        boardFor(ctx, item, slot), ctx);
}

/** Purchase, keep and equip all choose a slot using the same combat/economy tradeoff. */
function bestTotalSlot(item: ItemView, ctx: DecisionContext): EquipSlotName | null {
    return equipSlots(item).sort((a, b) =>
        (equipGainFor(item, b, ctx) * ctx.combatWeight + equipEconomyGain(item, b, ctx))
        - (equipGainFor(item, a, ctx) * ctx.combatWeight + equipEconomyGain(item, a, ctx)))[0] ?? null;
}

/** Best slot to put this item in, by resulting power. */
export function bestSlotFor(item: ItemView, ctx: DecisionContext): { slot: EquipSlotName | null; power: number } {
    const slots = equipSlots(item);
    if (slots.length === 0) return { slot: null, power: equipGainFor(item, null, ctx) };

    let best: { slot: EquipSlotName | null; power: number } = { slot: null, power: -Infinity };
    for (const slot of slots) {
        const gain = equipGainFor(item, slot, ctx);
        if (gain > best.power) best = { slot, power: gain };
    }
    return best;
}

/**
 * What this item is worth in power, ignoring its price. Contains NO gold term — goldToPowerRate
 * depends on this, so adding one would make the rate self-referential.
 */
export function itemCombatValue(item: ItemView, ctx: DecisionContext): number {
    if (item.sold) return 0;

    let value: number;
    if (isPotion(item) && equipSlots(item).length === 0) {
        value = skillPowerOf(item, ctx);
    } else if (item.upgradePreview) {
        // A preview is a clone of an owned item one rarity up: score only the delta over the
        // original, not the clone's absolute stats.
        const owned = findOwnedByItemId(ctx.obs, item.itemId);
        const before = owned ? bestSlotFor(owned, ctx).power : 0;
        value = bestSlotFor(item, ctx).power - before;
    } else {
        value = equipGainFor(item, bestTotalSlot(item, ctx), ctx);
    }

    value += itemScalingSynergy(item, ctx.power.stats, ctx.ownedScaling);
    // A skill this item will unlock at a higher rarity is real, but only if it gets there.
    if (!item.skillId && item.futureSkillId) value *= 1 + 0.05 * ctx.archetype.skillPremium;
    if (item.skillId) value *= 1 + 0.05 * (ctx.archetype.skillPremium - 1);
    value += affinityBonus(item.class ? [item.class] : [], value, ctx.affinity, ctx.archetype);

    return assertFinite(value, `itemCombatValue(${item.itemId})`);
}

/** Gold-denominated value of an item's income and skill economy, converted to power. */
export function itemEconomyValue(item: ItemView, ctx: DecisionContext): number {
    const slot = bestTotalSlot(item, ctx);
    if (!slot) return 0;
    const gain = equipEconomyGain(item, slot, ctx);
    if (!item.upgradePreview) return gain;
    const owned = findOwnedByItemId(ctx.obs, item.itemId);
    return gain - (owned ? equipEconomyGain(owned, slot, ctx) : 0);
}

function findOwnedByItemId(obs: DraftObservation, itemId: number): ItemView | null {
    for (const item of Object.values(obs.player.equipped)) {
        if (item && item.itemId === itemId) return item;
    }
    return obs.player.inventory.find((i) => i.itemId === itemId) ?? null;
}

export function isFreeClaimEligible(item: ItemView, obs: DraftObservation): boolean {
    // Mirrors DraftRoom.buyItem's mutually exclusive priority order exactly.
    const player = obs.player;
    if (item.sold) return false;
    const lucky = player.luckyFindFreeClaim && item.luckyFind;
    const genie = !lucky && player.goldGenieFreeClaim && item.class === 'merchant';
    const credit = !lucky && !genie && player.storeCreditFreeClaim && item.price <= player.storeCreditFreeClaimCap;
    const comrade = !lucky && !genie && !credit && player.comradeFreeClaim;
    const misconduct = !lucky && !genie && !credit && !comrade && player.misconductFreeClaim;
    return lucky || genie || credit || comrade || misconduct;
}

export function effectivePrice(item: ItemView, obs: DraftObservation): number {
    return isFreeClaimEligible(item, obs) ? 0 : item.price;
}

// --- talents ----------------------------------------------------------------------------------

/** Full value of a talent: its stats through the power model, plus what its behavior does. */
export function talentValue(talent: TalentView, ctx: DecisionContext): number | null {
    const behavior = valueTalent(talent, ctx.activation, ctx.archetype, ctx.onUnknown);
    if (!behavior) return null;

    const perFight = behavior.statsPerFight;
    const accrued: Partial<StatBlock> | undefined = perFight
        ? Object.fromEntries(
            Object.entries(perFight).map(([k, v]) => [
                k,
                k === 'attackSpeed'
                    ? 1 + (v - 1) * ctx.remainingFights * STATS_PER_FIGHT_DISCOUNT
                    : v * ctx.remainingFights * STATS_PER_FIGHT_DISCOUNT,
            ]),
        )
        : undefined;

    const others = ctx.obs.player.talents.filter(t => t.talentId !== talent.talentId);
    const before = others.length === ctx.obs.player.talents.length ? boardFor(ctx)
        : evaluateLoadout(ctx.obs, ctx.obs.player.equipped, ctx.archetype, others, ctx.onUnknown);
    const after = evaluateLoadout(ctx.obs, ctx.obs.player.equipped, ctx.archetype,
        [...others, talent], ctx.onUnknown);
    let value = after.power - before.power + marginalPower(ctx.power, { addStats: [accrued] });

    value += talentScalingSynergy(talent, ctx.power.stats, ctx.ownedScaling);

    const gold = ((after.goldPerRound - before.goldPerRound + after.income - before.income) * ctx.remainingFights + behavior.goldOnce) * ctx.rate;
    const xp = behavior.xpPerRound * ctx.remainingFights * ctx.rate * 0.5;
    value += (gold + xp) * ctx.economyWeight;
    value += affinityBonus(talent.tags, value, ctx.affinity, ctx.archetype);

    return assertFinite(value, `talentValue(${talent.talentId})`);
}

/**
 * Picks a talent, rerolling a slot first if it is clearly the weakest of the offer. Every offered
 * talent is the same tier (getRandomTalents matches `{tier: level}`), so the other slots are the
 * right yardstick — no tier table needed, and an unmapped talent is scored at the offer's median
 * rather than 0, so a newly added talent isn't automatically discarded.
 */
export function chooseTalentAction(ctx: DecisionContext): BotAction | null {
    const { obs } = ctx;
    if (obs.remainingTalentPoints <= 0 || obs.availableTalents.length === 0) return null;

    const raw = obs.availableTalents.map((talent, index) => ({ talent, index, value: talentValue(talent, ctx) }));
    const known = raw.map((r) => r.value).filter((v): v is number => v !== null).sort((a, b) => a - b);
    const median = known.length
        ? known[Math.floor(known.length / 2)]
        : UNKNOWN_TALENT_FALLBACK_POWER;
    const scored = raw.map((r) => ({ ...r, score: r.value ?? median }));

    const worst = [...scored].sort((a, b) => a.score - b.score || a.talent.talentId - b.talent.talentId)[0];
    if (!obs.talentRerollUsed[worst.index] && worst.score < median * TALENT_REROLL_FRACTION) {
        return { type: 'refresh_talent_slot', talentId: worst.talent.talentId, reason: `score=${worst.score.toFixed(2)}` };
    }

    const best = [...scored].sort((a, b) => b.score - a.score || a.talent.talentId - b.talent.talentId)[0];
    return { type: 'select_talent', talentId: best.talent.talentId, reason: `score=${best.score.toFixed(2)}` };
}

export function chooseJokerPick(ctx: DecisionContext): BotAction | null {
    const cards = ctx.obs.jokerPendingCards;
    if (!cards || cards.length === 0) return null;
    // v1 took the biggest number regardless of which stat it was; score them through the model.
    const scored = cards.map((card) => ({
        card,
        value: marginalPower(ctx.power, { addStats: [{ [card.stat]: card.amount } as Partial<StatBlock>] }),
    }));
    const best = [...scored].sort((a, b) => b.value - a.value)[0];
    return { type: 'joker_pick', stat: best.card.stat, reason: `power=${best.value.toFixed(2)}` };
}

export function chooseFreeClaimBuy(ctx: DecisionContext): BotAction | null {
    const candidates = ctx.obs.shop.filter((item) => isFreeClaimEligible(item, ctx.obs));
    if (candidates.length === 0) return null;
    // v1 claimed the most EXPENSIVE item; take the most valuable one instead.
    const best = [...candidates]
        .map((item) => ({ item, value: itemCombatValue(item, ctx) + itemEconomyValue(item, ctx) }))
        .sort((a, b) => b.value - a.value || a.item.itemId - b.item.itemId)[0];
    return { type: 'buy', itemId: best.item.itemId, reason: 'free_claim' };
}

// --- scored actions ---------------------------------------------------------------------------

export interface ScoredAction {
    action: BotAction;
    score: number;
}

export function scoreBuys(ctx: DecisionContext): ScoredAction[] {
    const { obs } = ctx;
    const out: ScoredAction[] = [];
    for (const item of obs.shop) {
        if (item.sold) continue;
        const price = effectivePrice(item, obs);
        if (price > obs.player.gold) continue;
        const value = itemCombatValue(item, ctx) * ctx.combatWeight + itemEconomyValue(item, ctx);
        const score = value - price * ctx.rate;
        out.push({ action: { type: 'buy', itemId: item.itemId, reason: `score=${score.toFixed(2)}` }, score });
    }
    return out;
}

export function scoreReroll(ctx: DecisionContext): ScoredAction | null {
    const { obs } = ctx;
    const player = obs.player;
    if (player.rerollsThisRound >= MAX_REROLLS_PER_ROUND) return null;
    if (!isRerollFree(player) && player.gold < player.refreshShopCost) return null;
    const values = obs.shop.filter((i) => !i.sold).map((item) => itemCombatValue(item, ctx));
    const score = rerollExpectedGain(values, player, ctx.rate, ctx.archetype.rerollAppetite);
    return { action: { type: 'refresh_shop', reason: `gain=${score.toFixed(2)}` }, score };
}

export function scoreLevelUp(ctx: DecisionContext): ScoredAction | null {
    const { obs } = ctx;
    const player = obs.player;
    if (player.level >= MAX_LEVEL) return null;
    // The Future is Now blocks buying XP outright — a rule, not a preference.
    if (player.talents.some((t) => t.talentId === TalentType.FUTURE_NOW)) return null;
    const cost = levelUpGoldCost(player);
    if (cost <= 0 || cost > player.gold) return null;

    // The talent point is worth roughly what the current offer is worth; with no offer in front of
    // us, fall back to the median value of the talents already owned.
    const owned = player.talents.map((t) => talentValue(t, ctx)).filter((v): v is number => v !== null);
    const expectedTalentPower = owned.length
        ? [...owned].sort((a, b) => a - b)[Math.floor(owned.length / 2)]
        : UNKNOWN_TALENT_FALLBACK_POWER;

    const score = levelUpValue(player, expectedTalentPower, ctx.rate) - cost * ctx.rate;
    return { action: { type: 'level_up', reason: `cost=${cost}` }, score };
}

export function scoreEquips(ctx: DecisionContext): ScoredAction[] {
    const out: ScoredAction[] = [];
    for (const item of ctx.obs.player.inventory) {
        for (const slot of equipSlots(item)) {
            // Compare complete before/after loadouts, including displaced economy effects.
            const gain = equipGainFor(item, slot, ctx) * ctx.combatWeight + equipEconomyGain(item, slot, ctx);
            if (gain <= EQUIP_HYSTERESIS_ABS) continue;
            out.push({ action: { type: 'equip', uid: item.uid, slot, reason: `gain=${gain.toFixed(2)}` }, score: gain });
        }
    }
    return out;
}

/** Only for an equipped item that is actively hurting, and only when nothing would take its slot —
 *  equipping already swaps, so unequip is otherwise never needed. Note the uid must be the
 *  EQUIPPED item's: DraftRoom.unequipItem matches on it, so an inventory uid is a silent no-op. */
export function scoreUnequips(ctx: DecisionContext): ScoredAction[] {
    const out: ScoredAction[] = [];
    const wantsSlot = new Set(
        ctx.obs.player.inventory.flatMap((item) => equipSlots(item).map((s) => s as string)),
    );
    for (const [slotName, item] of Object.entries(ctx.obs.player.equipped)) {
        if (!item || wantsSlot.has(slotName)) continue;
        const slot = slotName as EquipSlotName;
        const removalGain = removalGainFor(item, ctx);
        if (removalGain <= EQUIP_HYSTERESIS_ABS) continue;
        out.push({
            action: { type: 'unequip', uid: item.uid, slot, reason: `gain=${removalGain.toFixed(2)}` },
            score: removalGain,
        });
    }
    return out;
}

export function scoreDrink(ctx: DecisionContext): ScoredAction | null {
    const player = ctx.obs.player;
    if (player.pendingPotionEffects.length >= player.potionCapacity) return null;
    const potions = player.inventory.filter((item) => isPotion(item));
    if (potions.length === 0) return null;
    const best = potions
        .map((item) => ({ item, value: itemCombatValue(item, ctx) }))
        .sort((a, b) => b.value - a.value)[0];
    if (best.value <= 0) return null;
    return {
        action: { type: 'equip', uid: best.item.uid, slot: 'drink', reason: `power=${best.value.toFixed(2)}` },
        score: best.value,
    };
}

export function scoreSells(ctx: DecisionContext): ScoredAction[] {
    const { obs } = ctx;
    // Never sell the source of a shop upgrade preview: the preview is a clone of it, and selling
    // it throws the upgrade away.
    const protectedIds = new Set(obs.shop.filter((i) => i.upgradePreview && !i.sold).map((i) => i.itemId));
    const out: ScoredAction[] = [];
    for (const item of obs.player.inventory) {
        if (protectedIds.has(item.itemId)) continue;
        const keepValue = itemCombatValue(item, ctx) + itemEconomyValue(item, ctx);
        const score = item.sellPrice * ctx.rate - keepValue;
        out.push({ action: { type: 'sell', uid: item.uid, reason: `score=${score.toFixed(2)}` }, score });
    }
    return out;
}

/**
 * One action per call, same as v1 — the driver re-observes after each, which keeps every scorer a
 * pure function of a fresh observation.
 *
 * Phase A is ordered because those actions are free and gate progress (a pending talent point
 * blocks nothing else from being worth evaluating). Phase B is a single argmax, which is the real
 * departure from v1: reroll, buy, level and equip finally compete on one scale.
 */
export function nextDraftAction(ctx: DecisionContext): BotAction {
    const phaseA = chooseJokerPick(ctx) ?? chooseTalentAction(ctx) ?? chooseFreeClaimBuy(ctx);
    if (phaseA) return phaseA;

    const candidates: ScoredAction[] = [
        ...scoreBuys(ctx),
        ...scoreEquips(ctx),
        ...scoreUnequips(ctx),
        ...scoreSells(ctx),
    ];
    const reroll = scoreReroll(ctx);
    if (reroll) candidates.push(reroll);
    const levelUp = scoreLevelUp(ctx);
    if (levelUp) candidates.push(levelUp);
    const drink = scoreDrink(ctx);
    if (drink) candidates.push(drink);

    for (const candidate of candidates) assertFinite(candidate.score, `score(${candidate.action.type})`);

    const best = candidates.sort((a, b) => b.score - a.score)[0];
    if (!best || best.score <= ACTION_EPSILON) return { type: 'end_draft', reason: 'nothing worth doing' };
    return best.action;
}

export function chooseLossReward(obs: LossRewardObservation, archetype: ArchetypeWeights): LossRewardChoice {
    // Build a draft-shaped observation so the same power model can price all three options.
    const ctx = buildDecisionContext(
        {
            schemaVersion: obs.schemaVersion, runId: obs.runId, step: 0, round: obs.round,
            player: obs.player, shop: [], availableTalents: [], remainingTalentPoints: 0,
            talentRerollUsed: [], canUndoSell: false, nextEnemy: null, nextEnemyRevealLevel: -1,
            nextEnemyTalentClasses: [], nextEnemyItemClasses: [],
        },
        archetype,
    );

    const goldScore = obs.goldAmount * ctx.rate * ctx.economyWeight;

    let xpScore = 0;
    if (obs.player.level < MAX_LEVEL) {
        const xpNeeded = Math.max(1, obs.player.maxXp - obs.player.xp);
        const levelsWorth = Math.min(1, obs.xpAmount / xpNeeded);
        xpScore = levelsWorth * levelUpValue(obs.player, UNKNOWN_TALENT_FALLBACK_POWER * 4, ctx.rate);
    }

    let upgradeScore = 0;
    if (obs.itemUpgradeAvailable) {
        // A rarity step is worth roughly the power the weakest equipped item already provides.
        const gains = Object.values(obs.player.equipped)
            .filter((item): item is ItemView => !!item)
            .map((item) => marginalPower(ctx.power, { addStats: [item.affectedStats] }));
        const weakest = gains.length ? Math.min(...gains) : 0;
        upgradeScore = Math.max(0, weakest) * Math.max(1, obs.itemUpgradeCount);
    }

    if (upgradeScore >= goldScore && upgradeScore >= xpScore && upgradeScore > 0) return 'item_upgrade';
    if (xpScore >= goldScore && xpScore > 0) return 'xp';
    return 'gold';
}

// --- the policy -------------------------------------------------------------------------------

export interface HeuristicPolicyV2Options {
    seed?: number;
    archetypeId?: ArchetypeId;
}

export class HeuristicPolicyV2 implements BotPolicy {
    readonly id = 'heuristic-v2';
    readonly version = '2.0.0';
    readonly archetypeId: ArchetypeId;
    readonly seed: number;

    private readonly archetype: ArchetypeWeights;
    private readonly unknownHintIds = new Set<number>();

    constructor(opts: HeuristicPolicyV2Options = {}) {
        this.seed = opts.seed ?? 0;
        this.archetype = opts.archetypeId ? ARCHETYPES[opts.archetypeId] : rollArchetype(this.seed);
        this.archetypeId = this.archetype.id;
    }

    async decideDraft(obs: DraftObservation): Promise<BotAction[]> {
        const ctx = buildDecisionContext(obs, this.archetype, (id) => this.unknownHintIds.add(id));
        return [nextDraftAction(ctx)];
    }

    async decideLossReward(obs: LossRewardObservation): Promise<LossRewardChoice> {
        return chooseLossReward(obs, this.archetype);
    }

    drainDiagnostics(): PolicyDiagnostics {
        const ids = [...this.unknownHintIds];
        this.unknownHintIds.clear();
        return { unknownHintIds: ids, policyConfigHash: policyConfigHash() };
    }
}
