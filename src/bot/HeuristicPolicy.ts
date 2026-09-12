/**
 * The default, non-AI bot policy. Every rule below is an exported pure function of a plain
 * observation (src/bot/BotPolicy.ts) — no room/DB access, so each is independently unit-testable
 * (test/botPolicy.test.ts) without a live server or MongoDB.
 *
 * `decideDraft` returns one action per call (a valid degenerate case of the batch contract —
 * see BotPolicy.ts's doc comment): the heuristic is instant, so there's no latency to amortize by
 * batching, and returning one action lets the driver re-observe after every mutation for free.
 *
 * Explicitly out of scope for v1 (see the bot service plan): combat lookahead or opponent-aware
 * counter-building (the observation's `nextEnemy*` fields are carried through unused), shop
 * locking, `undo_sell`, cross-round gold banking, a talent-synergy graph beyond "same class", and
 * Joker EV math (it just picks the larger offered amount).
 */
import {
    BotAction, BotPolicy, DraftObservation, EquipSlotName, ItemView, LossRewardChoice,
    LossRewardObservation, PlayerView, StatBlock, TalentView,
} from './BotPolicy';

// ---------------------------------------------------------------------------------------------
// Tunables — every one of these is a first-pass calibration, meant to be tuned against real
// telemetry (see the plan's "Suggested order" step 6) once runs exist to measure against.
// Bump HeuristicPolicy.version (below) whenever one of these changes so aggregations stay
// separable across tuning passes.
// ---------------------------------------------------------------------------------------------

const STAT_WEIGHTS = {
    strength: 1.0,
    accuracy: 0.8,
    defense: 0.9,
    maxHp: 0.12,
    dodgeRate: 0.5,
    hpRegen: 0.6,
    cooldownReduction: 0.3,
    attackSpeed: 40, // multiplies (attackSpeed - 1) — AffectedStats' default of 1 means "no change"
} as const;

const INCOME_WEIGHT_EARLY = 2.5; // rounds <= INCOME_EARLY_ROUND_CUTOFF — income compounds, so early income is worth more
const INCOME_WEIGHT_LATE = 0.5;
const INCOME_EARLY_ROUND_CUTOFF = 6;

const SKILL_GRANTED_BONUS = 18; // item already has a class skill (Legendary+)
const SKILL_NEAR_BONUS = 9; // one rarity step from unlocking its futureSkill (>= Epic)
const SKILL_FAR_BONUS = 3; // has a futureSkill promise, but still far from it
const EPIC_RARITY = 3; // ItemRarity.EPIC — see items/types/ItemTypes.ts
const LEGENDARY_RARITY = 4; // ItemRarity.LEGENDARY

const CLASS_FOCUS_BONUS = 6; // scoreShopItem: item's class matches the player's dominant class
const TALENT_CLASS_FOCUS_BONUS = 8; // talentScore: talent's tags include the dominant class
const TALENT_MULTI_TRIGGER_BONUS = 2; // talent reacts to 2+ TriggerTypes
const LUCKY_STEP_BONUS = 4; // per free lucky-find rarity step a shop slot already rolled
const POTION_BASE_VALUE = 6; // flat value for a 'drink'-only item (no affectedStats to score)

const MAX_PAID_REROLLS_PER_ROUND = 3; // also feeds Fortune's Fool's HP penalty — see DraftRoom.ts
const MIN_GOLD_AFTER_PAID_REROLL = 4; // don't reroll a round's gold down to nothing

const FUTURE_NOW_TALENT_ID = 32; // TalentType.FUTURE_NOW — blocks buying XP directly
const MAX_LEVEL_FOR_TALENT_POINT = 5; // no talent point granted at/above this level
const XP_BUY_GOLD_CEILING = 12; // buys L2 (<=10g) and L3 (<=16g→ but see note) aggressively, L4+ almost never
const XP_BUY_MIN_GOLD_BUFFER = 6; // leave a small buffer after buying XP

const EQUIP_HYSTERESIS = 1.15; // a candidate must beat the incumbent by >15% to avoid equip/unequip thrash

const SELL_TRIGGER_SCORE_MULTIPLIER = 2; // a shop item must score this many times buyFloor to justify selling for it
const SELL_CANDIDATE_SCORE_MULTIPLIER = 0.5; // an inventory item scoring below buyFloor * this is sellable

const CLASS_NAMES = ['rogue', 'warrior', 'merchant'];

function lerp(a: number, b: number, x: number, x0: number, x1: number): number {
    if (x1 === x0) return a;
    const t = Math.min(1, Math.max(0, (x - x0) / (x1 - x0)));
    return a + (b - a) * t;
}

/** Level-scaled: early on almost anything is worth buying; later, gold should go toward
 *  upgrades/rerolls rather than filler commons. */
export function buyFloor(level: number): number {
    return lerp(0.25, 0.6, level, 1, 5);
}

/** Level-scaled: higher levels are pickier about settling for the current shop. */
export function rerollFloor(level: number): number {
    return lerp(0.5, 1.0, level, 1, 5);
}

/** Tier-scaled: later talent tiers are pickier before spending their one free reroll per slot. */
export function talentFloor(tier: number): number {
    return lerp(3, 8, tier, 1, 5);
}

/** Weighted sum over a stat delta (an item's/talent's affectedStats, NOT a player's absolute
 *  stats) — the common currency every buy/equip/talent/sell decision compares against. */
export function statValue(stats: Partial<StatBlock>, round: number): number {
    let v = 0;
    v += (stats.strength ?? 0) * STAT_WEIGHTS.strength;
    v += (stats.accuracy ?? 0) * STAT_WEIGHTS.accuracy;
    v += (stats.defense ?? 0) * STAT_WEIGHTS.defense;
    v += (stats.maxHp ?? 0) * STAT_WEIGHTS.maxHp;
    v += (stats.dodgeRate ?? 0) * STAT_WEIGHTS.dodgeRate;
    v += (stats.hpRegen ?? 0) * STAT_WEIGHTS.hpRegen;
    v += (stats.cooldownReduction ?? 0) * STAT_WEIGHTS.cooldownReduction;
    const attackSpeed = stats.attackSpeed ?? 1;
    v += (attackSpeed - 1) * STAT_WEIGHTS.attackSpeed;
    const incomeWeight = round <= INCOME_EARLY_ROUND_CUTOFF ? INCOME_WEIGHT_EARLY : INCOME_WEIGHT_LATE;
    v += (stats.income ?? 0) * incomeWeight;
    return v;
}

/** Mirrors DraftRoom.buyItem's free-claim priority order EXACTLY (lucky-find > gold-genie >
 *  store-credit > comrade > misconduct — see DraftRoom.ts:548-553) — a drift here silently costs
 *  the bot every free item in the game. */
export function isFreeClaimEligible(item: ItemView, player: PlayerView): boolean {
    if (item.sold) return false;
    const luckyFree = player.luckyFindFreeClaim && item.luckyFind;
    const goldGenieFree = !luckyFree && player.goldGenieFreeClaim && item.class === 'merchant';
    const storeCreditFree = !luckyFree && !goldGenieFree && player.storeCreditFreeClaim && item.price <= player.storeCreditFreeClaimCap;
    const comradeFree = !luckyFree && !goldGenieFree && !storeCreditFree && player.comradeFreeClaim;
    const misconductFree = !luckyFree && !goldGenieFree && !storeCreditFree && !comradeFree && player.misconductFreeClaim;
    return luckyFree || goldGenieFree || storeCreditFree || comradeFree || misconductFree;
}

export function effectivePrice(item: ItemView, player: PlayerView): number {
    return isFreeClaimEligible(item, player) ? 0 : item.price;
}

/** Gold to leave unspent this decision — nothing early, and nothing once a reroll is genuinely
 *  free (a charge or Fortune's Fool), otherwise one reroll's worth. */
export function reserveGold(obs: DraftObservation): number {
    const player = obs.player;
    if (obs.round <= 2) return 0;
    if (player.freeRerollCharges > 0 || player.freeRerolls) return 0;
    return player.refreshShopCost;
}

/** Most frequent class among the player's talent tags and equipped items' `class` — replaces the
 *  (now-removed) item-set-bonus concept: today `class` only matters for unlocking a Legendary
 *  skill, so "focus" means concentrating upgrades into one class rather than hitting a threshold. */
export function dominantClass(player: PlayerView): string | null {
    const counts: Record<string, number> = {};
    for (const talent of player.talents) {
        for (const tag of talent.tags) {
            if (CLASS_NAMES.includes(tag)) counts[tag] = (counts[tag] ?? 0) + 1;
        }
    }
    for (const item of Object.values(player.equipped)) {
        if (item && CLASS_NAMES.includes(item.class)) counts[item.class] = (counts[item.class] ?? 0) + 1;
    }
    let best: string | null = null;
    let bestCount = 0;
    for (const [cls, count] of Object.entries(counts)) {
        if (count > bestCount) { best = cls; bestCount = count; }
    }
    return best;
}

export function findOwnedItemByItemId(player: PlayerView, itemId: number): ItemView | null {
    for (const item of Object.values(player.equipped)) {
        if (item && item.itemId === itemId) return item;
    }
    return player.inventory.find((i) => i.itemId === itemId) ?? null;
}

/** value ÷ effective price — the single ranking number every buy/reroll/sell decision below
 *  reads. Works identically for a shop slot or an owned (inventory/equipped) item, so
 *  chooseSellAction can reuse it to score what the player already has. */
export function scoreShopItem(item: ItemView, obs: DraftObservation): number {
    const player = obs.player;
    if (item.sold) return -Infinity;

    let marginal: number;
    if (item.upgradePreview) {
        // A preview is a clone of an owned item upgraded one step — score the marginal gain over
        // what's currently owned, not the preview's absolute stats.
        const owned = findOwnedItemByItemId(player, item.itemId);
        marginal = statValue(item.affectedStats, obs.round) - (owned ? statValue(owned.affectedStats, obs.round) : 0);
    } else if (item.equipOptions.includes('drink') && item.equipOptions.length === 1) {
        // Potions have no comparable affectedStats — a flat value stands in for their skill effect.
        marginal = POTION_BASE_VALUE;
    } else {
        const slots = item.equipOptions.filter((s) => s !== 'drink') as EquipSlotName[];
        if (slots.length === 0) {
            marginal = statValue(item.affectedStats, obs.round);
        } else {
            const emptySlot = slots.find((s) => !player.equipped[s]);
            marginal = emptySlot
                ? statValue(item.affectedStats, obs.round)
                : Math.max(...slots.map((s) => {
                    const incumbent = player.equipped[s];
                    return statValue(item.affectedStats, obs.round) - (incumbent ? statValue(incumbent.affectedStats, obs.round) : 0);
                }));
        }
    }

    const skillBonus = item.skillId !== 0 ? SKILL_GRANTED_BONUS
        : item.futureSkillId !== 0 && item.rarity >= EPIC_RARITY ? SKILL_NEAR_BONUS
        : item.futureSkillId !== 0 ? SKILL_FAR_BONUS
        : 0;

    const focus = dominantClass(player);
    const classFocus = focus && item.class === focus ? CLASS_FOCUS_BONUS : 0;
    const luckyBonus = item.luckyFindSteps * LUCKY_STEP_BONUS;

    const value = marginal + skillBonus + classFocus + luckyBonus;
    const price = Math.max(1, effectivePrice(item, player));
    return value / price;
}

function talentScore(talent: TalentView, focus: string | null, round: number): number {
    const statVal = statValue(talent.affectedStats, round) + statValue(talent.affectedEnemyStats, round) * 0.7;
    const classBonus = focus && talent.tags.includes(focus) ? TALENT_CLASS_FOCUS_BONUS : 0;
    const triggerBonus = talent.triggerTypes.length >= 2 ? TALENT_MULTI_TRIGGER_BONUS : 0;
    return statVal + classBonus + triggerBonus;
}

// ---------------------------------------------------------------------------------------------
// Per-decision-type action choosers. `nextDraftAction` composes these in priority order.
// ---------------------------------------------------------------------------------------------

export function chooseJokerPick(obs: DraftObservation): BotAction | null {
    const cards = obs.jokerPendingCards;
    if (!cards || cards.length === 0) return null;
    const best = [...cards].sort((a, b) => b.amount - a.amount)[0];
    return { type: 'joker_pick', stat: best.stat, reason: `amount=${best.amount}` };
}

/** Reroll at most one slot per call (tracked via `talentRerollUsed`, which the server sets
 *  regardless of NODE_ENV — only the *blocking* of a second reroll is production-only, see
 *  DraftRoom.ts:451), then select the best offered talent once nothing's worth rerolling. */
export function chooseTalentAction(obs: DraftObservation): BotAction | null {
    const { player, availableTalents, remainingTalentPoints, talentRerollUsed } = obs;
    if (remainingTalentPoints <= 0 || availableTalents.length === 0) return null;

    const focus = dominantClass(player);
    const scored = availableTalents.map((talent, index) => ({ talent, index, score: talentScore(talent, focus, obs.round) }));

    const floor = talentFloor(availableTalents[0]?.tier ?? 1);
    const worst = [...scored].sort((a, b) => a.score - b.score || a.talent.talentId - b.talent.talentId)[0];
    if (worst.score < floor && !talentRerollUsed[worst.index]) {
        return { type: 'refresh_talent_slot', talentId: worst.talent.talentId, reason: `score=${worst.score.toFixed(2)}` };
    }

    const best = [...scored].sort((a, b) => b.score - a.score || a.talent.talentId - b.talent.talentId)[0];
    return { type: 'select_talent', talentId: best.talent.talentId, reason: `score=${best.score.toFixed(2)}` };
}

/** A live free claim on an unsold shop slot — spent on the most expensive eligible item to
 *  maximize the value extracted from the claim. Checked before rerolling so a valuable free item
 *  is never lost to a shop refresh. */
export function chooseFreeClaimBuy(obs: DraftObservation): BotAction | null {
    const player = obs.player;
    const candidates = obs.shop.filter((item) => isFreeClaimEligible(item, player));
    if (candidates.length === 0) return null;
    const best = [...candidates].sort((a, b) => b.price - a.price)[0];
    return { type: 'buy', itemId: best.itemId, reason: 'free_claim' };
}

export function chooseReroll(obs: DraftObservation): BotAction | null {
    const player = obs.player;
    if (player.freeRerolls || player.freeRerollCharges > 0) {
        return { type: 'refresh_shop', reason: 'free_reroll' };
    }
    if (player.rerollsThisRound >= MAX_PAID_REROLLS_PER_ROUND) return null;
    if (player.gold < player.refreshShopCost + MIN_GOLD_AFTER_PAID_REROLL) return null;

    const unsold = obs.shop.filter((item) => !item.sold);
    const bestScore = unsold.length ? Math.max(...unsold.map((item) => scoreShopItem(item, obs))) : -Infinity;
    if (bestScore < rerollFloor(player.level)) {
        return { type: 'refresh_shop', reason: `bestScore=${bestScore.toFixed(2)}` };
    }
    return null;
}

export function chooseScoredBuy(obs: DraftObservation): BotAction | null {
    const player = obs.player;
    const reserve = reserveGold(obs);
    const affordable = obs.shop.filter((item) => !item.sold && effectivePrice(item, player) <= player.gold - reserve);
    if (affordable.length === 0) return null;

    const scored = affordable.map((item) => ({ item, score: scoreShopItem(item, obs) }));
    const best = [...scored].sort((a, b) => b.score - a.score || a.item.itemId - b.item.itemId)[0];
    if (best.score < buyFloor(player.level)) return null;
    return { type: 'buy', itemId: best.item.itemId, reason: `score=${best.score.toFixed(2)}` };
}

/** buy_xp is 4 gold -> 4 xp; `level_up` (the action performed) buys exactly enough to hit the
 *  next level, same as DraftRoom's own `level_up` message handler. Ground truth: 10/15/55/190 xp
 *  for levels 2-5, so this buys L2/L3 aggressively and almost never L4/L5 (passive per-fight xp
 *  gets there for free). */
export function chooseXpPurchase(obs: DraftObservation): BotAction | null {
    const player = obs.player;
    if (player.level >= MAX_LEVEL_FOR_TALENT_POINT) return null;
    if (player.talents.some((t) => t.talentId === FUTURE_NOW_TALENT_ID)) return null;
    const xpNeeded = player.maxXp - player.xp;
    if (xpNeeded <= 0) return null;
    const goldCost = Math.ceil(xpNeeded / 4) * 4;
    if (goldCost > XP_BUY_GOLD_CEILING) return null;
    if (player.gold - goldCost < XP_BUY_MIN_GOLD_BUFFER) return null;
    return { type: 'level_up', reason: `goldCost=${goldCost}` };
}

/** Equip is mostly automatic already (buying auto-equips into an empty slot) — this only swaps
 *  an equipped item for a clearly better inventory one, with hysteresis to avoid thrash across
 *  re-observations of near-identical items. */
export function chooseEquipAction(obs: DraftObservation): BotAction | null {
    const player = obs.player;
    for (const item of player.inventory) {
        const slots = item.equipOptions.filter((s) => s !== 'drink') as EquipSlotName[];
        for (const slot of slots) {
            const incumbent = player.equipped[slot];
            const candidateValue = statValue(item.affectedStats, obs.round);
            if (!incumbent) {
                if (candidateValue > 0) return { type: 'equip', uid: item.uid, slot, reason: 'empty_slot' };
                continue;
            }
            const incumbentValue = statValue(incumbent.affectedStats, obs.round);
            const beatsIncumbent = incumbentValue <= 0 ? candidateValue > 0 : candidateValue > incumbentValue * EQUIP_HYSTERESIS;
            if (beatsIncumbent) return { type: 'equip', uid: item.uid, slot, reason: 'beats_incumbent' };
        }
    }
    return null;
}

export function chooseDrinkAction(obs: DraftObservation): BotAction | null {
    const player = obs.player;
    if (player.pendingPotionEffects.length >= player.potionCapacity) return null;
    const potion = player.inventory.find((item) => item.equipOptions.includes('drink'));
    if (!potion) return null;
    return { type: 'equip', uid: potion.uid, slot: 'drink', reason: 'drink_potion' };
}

/** Sell only to afford a shop item clearly better than the buy floor, and never an item that's
 *  the upgrade source of a current shop `upgradePreview` slot (matched by itemId — the preview is
 *  a clone of the owned item it upgrades, see DraftRoom.updateShop). */
export function chooseSellAction(obs: DraftObservation): BotAction | null {
    const player = obs.player;
    const availableGold = player.gold - reserveGold(obs);

    const unsold = obs.shop.filter((item) => !item.sold);
    if (unsold.length === 0) return null;
    const bestShop = [...unsold].map((item) => ({ item, score: scoreShopItem(item, obs) }))
        .sort((a, b) => b.score - a.score)[0];
    if (bestShop.score < buyFloor(player.level) * SELL_TRIGGER_SCORE_MULTIPLIER) return null;

    const gap = effectivePrice(bestShop.item, player) - availableGold;
    if (gap <= 0) return null; // already affordable — chooseScoredBuy handles it

    const protectedItemIds = new Set(obs.shop.filter((item) => item.upgradePreview && !item.sold).map((item) => item.itemId));
    const sellFloor = buyFloor(player.level) * SELL_CANDIDATE_SCORE_MULTIPLIER;
    const candidate = player.inventory
        .filter((item) => !protectedItemIds.has(item.itemId))
        .map((item) => ({ item, score: scoreShopItem(item, obs) }))
        .filter((c) => c.score < sellFloor && c.item.sellPrice >= gap)
        .sort((a, b) => a.score - b.score)[0];
    if (!candidate) return null;
    return { type: 'sell', uid: candidate.item.uid, reason: `frees gold for score=${bestShop.score.toFixed(2)}` };
}

export function chooseLossReward(obs: LossRewardObservation): LossRewardChoice {
    const player = obs.player;
    if (obs.itemUpgradeAvailable) {
        const belowLegendary = Object.values(player.equipped)
            .filter((item) => item && item.class && item.rarity < LEGENDARY_RARITY).length;
        if (belowLegendary >= 2) return 'item_upgrade';
    }
    if (player.level < MAX_LEVEL_FOR_TALENT_POINT) {
        const xpNeeded = player.maxXp - player.xp;
        if (xpNeeded > 0 && obs.xpAmount >= xpNeeded / 2) return 'xp';
    }
    return 'gold';
}

/** Composes the choosers above in priority order — see the file doc comment for why this is one
 *  action per call rather than a real batch. */
export function nextDraftAction(obs: DraftObservation): BotAction | null {
    return chooseJokerPick(obs)
        ?? chooseTalentAction(obs)
        ?? chooseFreeClaimBuy(obs)
        ?? chooseReroll(obs)
        ?? chooseScoredBuy(obs)
        ?? chooseXpPurchase(obs)
        ?? chooseEquipAction(obs)
        ?? chooseDrinkAction(obs)
        ?? chooseSellAction(obs)
        ?? null;
}

export class HeuristicPolicy implements BotPolicy {
    readonly id = 'heuristic-v1';
    readonly version = '1.0.0';

    async decideDraft(obs: DraftObservation): Promise<BotAction[]> {
        const action = nextDraftAction(obs);
        return action ? [action] : [];
    }

    async decideLossReward(obs: LossRewardObservation): Promise<LossRewardChoice> {
        return chooseLossReward(obs);
    }
}
