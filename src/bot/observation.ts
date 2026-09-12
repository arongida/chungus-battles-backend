/**
 * Converts live Colyseus Schema state (DraftState / FightState / Player / Item / Talent) into
 * the plain-JSON observation shapes a BotPolicy consumes (src/bot/BotPolicy.ts). This is the
 * ONLY file in src/bot/ that knows about Colyseus Schema objects — everything downstream of it
 * (HeuristicPolicy, and any future LLM/trained policy) works from plain data only.
 *
 * Bump OBSERVATION_SCHEMA_VERSION whenever a field is added, removed, or reinterpreted, so
 * telemetry recorded under different observation shapes stays distinguishable.
 */
import { ArraySchema, MapSchema } from '@colyseus/schema';
import { Player } from '../players/schema/PlayerSchema';
import { Item } from '../items/schema/ItemSchema';
import { Talent } from '../talents/schema/TalentSchema';
import { DraftState } from '../rooms/schema/DraftState';
import { AffectedStats } from '../common/schema/AffectedStatsSchema';
import { TalentType } from '../talents/types/TalentTypes';
import { parseJokerPendingCards } from '../talents/behavior/jokerState';
import {
    DraftObservation, EnemyPreviewView, EquipSlotName, ItemView, JokerPendingCard,
    LossRewardObservation, OBSERVATION_SCHEMA_VERSION, PlayerView, StatBlock, TalentView,
} from './BotPolicy';

function statBlockFromAffectedStats(s: AffectedStats | undefined): Partial<StatBlock> {
    if (!s) return {};
    return {
        strength: s.strength, accuracy: s.accuracy, attackSpeed: s.attackSpeed, defense: s.defense,
        dodgeRate: s.dodgeRate, hpRegen: s.hpRegen, income: s.income,
        cooldownReduction: s.cooldownReduction, maxHp: s.maxHp,
    };
}

function toStringArray(a: ArraySchema<string> | string[] | undefined): string[] {
    if (!a) return [];
    return Array.from(a as Iterable<string>);
}

export function buildItemView(item: Item): ItemView {
    return {
        uid: item.uid,
        itemId: item.itemId,
        name: item.name,
        description: item.description,
        price: item.price,
        sellPrice: item.sellPrice,
        rarity: item.rarity,
        tier: item.tier,
        type: item.type,
        class: item.class,
        tags: toStringArray(item.tags),
        equipOptions: toStringArray(item.equipOptions as any),
        affectedStats: statBlockFromAffectedStats(item.affectedStats),
        affectedEnemyStats: statBlockFromAffectedStats(item.affectedEnemyStats),
        baseMinDamage: item.baseMinDamage,
        baseMaxDamage: item.baseMaxDamage,
        baseAttackSpeed: item.baseAttackSpeed,
        upgradePreview: item.upgradePreview,
        previewBaseRarity: item.previewBaseRarity,
        luckyFind: item.luckyFind,
        luckyFindSteps: item.luckyFindSteps,
        skillId: item.skillId,
        skillName: item.skillName,
        skillDescription: item.skillDescription,
        futureSkillId: item.futureSkillId,
        futureSkillName: item.futureSkillName,
        sold: item.sold,
        equipped: item.equipped,
    };
}

export function buildTalentView(talent: Talent): TalentView {
    return {
        talentId: talent.talentId,
        name: talent.name,
        description: talent.description,
        tier: talent.tier,
        tags: toStringArray(talent.tags),
        triggerTypes: toStringArray(talent.triggerTypes),
        affectedStats: statBlockFromAffectedStats(talent.affectedStats),
        affectedEnemyStats: statBlockFromAffectedStats(talent.affectedEnemyStats),
    };
}

function buildEquippedView(equippedItems: MapSchema<Item>): Partial<Record<EquipSlotName, ItemView>> {
    const out: Partial<Record<EquipSlotName, ItemView>> = {};
    equippedItems.forEach((item, slot) => {
        out[slot as EquipSlotName] = buildItemView(item);
    });
    return out;
}

export function buildPlayerView(player: Player): PlayerView {
    return {
        playerId: player.playerId,
        originalPlayerId: player.originalPlayerId,
        name: player.name,
        avatarUrl: player.avatarUrl,
        round: player.round,
        level: player.level,
        xp: player.xp,
        maxXp: player.maxXp,
        gold: player.gold,
        lives: player.lives,
        wins: player.wins,
        losses: player.losses,
        stats: {
            maxHp: player.maxHp, hp: player.hp, strength: player.strength, accuracy: player.accuracy,
            defense: player.defense, attackSpeed: player.attackSpeed, dodgeRate: player.dodgeRate,
            hpRegen: player.hpRegen, income: player.income, cooldownReduction: player.cooldownReduction,
        },
        refreshShopCost: player.refreshShopCost,
        freeRerollCharges: player.freeRerollCharges,
        freeRerolls: player.freeRerolls,
        rerollsThisRound: player.rerollsThisRound,
        luckyFindChance: player.luckyFindChance,
        potionCapacity: player.potionCapacity,
        pendingPotionEffects: Array.from(player.pendingPotionEffects as ArraySchema<number>),
        comradeFreeClaim: player.comradeFreeClaim,
        goldGenieFreeClaim: player.goldGenieFreeClaim,
        luckyFindFreeClaim: player.luckyFindFreeClaim,
        misconductFreeClaim: player.misconductFreeClaim,
        storeCreditFreeClaim: player.storeCreditFreeClaim,
        storeCreditFreeClaimCap: player.storeCreditFreeClaimCap,
        equipped: buildEquippedView(player.equippedItems),
        inventory: player.inventory.map(buildItemView),
        talents: player.talents.map(buildTalentView),
    };
}

function buildEnemyPreviewView(nextEnemy: Player, revealLevel: number): EnemyPreviewView | null {
    if (revealLevel < 0 || !nextEnemy?.name) return null;
    return { name: nextEnemy.name, avatarUrl: nextEnemy.avatarUrl, level: nextEnemy.level, round: nextEnemy.round };
}

// Joker's pending cards are encoded onto the talent's own `tags` array (see
// talents/behavior/jokerState.ts's CARD_TAG_PREFIX idiom) rather than a dedicated field — reuse
// its own parser (parseJokerPendingCards) directly rather than re-deriving the tag encoding here.
function extractJokerPendingCards(player: Player): JokerPendingCard[] | undefined {
    const joker = player.talents.find((t) => t.talentId === TalentType.JOKER);
    if (!joker) return undefined;
    const cards = parseJokerPendingCards(joker.tags);
    return cards.length ? cards : undefined;
}

export function buildDraftObservation(state: DraftState, runId: string, step: number): DraftObservation {
    return {
        schemaVersion: OBSERVATION_SCHEMA_VERSION,
        runId,
        step,
        round: state.player.round,
        player: buildPlayerView(state.player),
        shop: state.shop.map(buildItemView),
        availableTalents: state.availableTalents.map(buildTalentView),
        remainingTalentPoints: state.remainingTalentPoints,
        talentRerollUsed: Array.from(state.talentRerollUsed as ArraySchema<boolean>),
        canUndoSell: state.canUndoSell,
        nextEnemy: buildEnemyPreviewView(state.nextEnemy, state.nextEnemyRevealLevel),
        nextEnemyRevealLevel: state.nextEnemyRevealLevel,
        nextEnemyTalentClasses: toStringArray(state.nextEnemyTalentClasses as any),
        nextEnemyItemClasses: toStringArray(state.nextEnemyItemClasses as any),
        jokerPendingCards: extractJokerPendingCards(state.player),
    };
}

/** Built from FightState — lossRewardOptions/lossRewardPending are plain (non-@type) fields on
 *  FightState, set by FightRoom.handleFightEnd (src/rooms/FightRoom.ts:1090-1096). */
export function buildLossRewardObservation(
    player: Player, round: number, runId: string,
    goldAmount: number, xpAmount: number, itemUpgradeAvailable: boolean, itemUpgradeCount: number,
): LossRewardObservation {
    return {
        schemaVersion: OBSERVATION_SCHEMA_VERSION,
        runId,
        round,
        player: buildPlayerView(player),
        goldAmount,
        xpAmount,
        itemUpgradeAvailable,
        itemUpgradeCount,
    };
}
