import {
    DraftObservation, ItemView, LossRewardObservation, OBSERVATION_SCHEMA_VERSION, PlayerView,
    TalentView,
} from '../../src/bot/BotPolicy';

// Shared observation fixtures for every pure bot-policy test (botPolicy.test.ts,
// botPolicyV2.test.ts, botKnowledge.test.ts). Kept in one place so widening an observation type
// means adding a default here once instead of in every suite.

export function makeItem(overrides: Partial<ItemView> = {}): ItemView {
    return {
        uid: 1, itemId: 1, name: 'Test Item', price: 10, sellPrice: 7, rarity: 1, tier: 1,
        type: 'weapon', class: '', tags: [], equipOptions: ['mainHand'],
        affectedStats: { strength: 3 }, affectedEnemyStats: {},
        baseMinDamage: 0, baseMaxDamage: 0, baseAttackSpeed: 0, strengthScaling: 1,
        bonusMaxDamage: 0, triggerTypes: [], activationRate: 0,
        upgradePreview: false, previewBaseRarity: 0, luckyFind: false, luckyFindSteps: 0,
        skillId: 0, skillName: '', skillDescription: '', futureSkillId: 0, futureSkillName: '',
        skillAffectedStats: {}, skillAffectedEnemyStats: {},
        skillId2: 0, skillName2: '', skillAffectedStats2: {}, skillAffectedEnemyStats2: {},
        sold: false, equipped: false,
        ...overrides,
    };
}

/** A weapon that actually swings — `makeItem`'s default has baseAttackSpeed 0, which the combat
 *  model correctly treats as a non-weapon (that's how shields drop out of the attack timers). */
export function makeWeapon(overrides: Partial<ItemView> = {}): ItemView {
    return makeItem({
        type: 'weapon', baseMinDamage: 2, baseMaxDamage: 6, baseAttackSpeed: 1, strengthScaling: 1,
        ...overrides,
    });
}

export function makeTalent(overrides: Partial<TalentView> = {}): TalentView {
    return {
        talentId: 1, name: 'Test Talent', tier: 1, tags: [], triggerTypes: [],
        affectedStats: { strength: 2 }, affectedEnemyStats: {},
        activationRate: 0, base: 0, scaling: 0,
        totalActivations: 0, totalDamageDealt: 0, totalHealingDone: 0, totalGoldGained: 0,
        totalXpGained: 0, totalHealingPrevented: 0,
        ...overrides,
    };
}

export function makePlayer(overrides: Partial<PlayerView> = {}): PlayerView {
    return {
        playerId: 1, originalPlayerId: 1, name: 'Bot', avatarUrl: 'assets/warrior_01.png',
        round: 3, level: 1, xp: 0, maxXp: 10, gold: 20, lives: 4, wins: 0, losses: 0,
        stats: {
            maxHp: 200, hp: 200, strength: 5, accuracy: 2, defense: 0, attackSpeed: 1,
            dodgeRate: 0, hpRegen: 0, income: 4, cooldownReduction: 0,
        },
        refreshShopCost: 2, freeRerollCharges: 0, freeRerolls: false, rerollsThisRound: 0,
        luckyFindChance: 0.1, potionCapacity: 1, pendingPotionEffects: [],
        comradeFreeClaim: false, goldGenieFreeClaim: false, luckyFindFreeClaim: false,
        misconductFreeClaim: false, storeCreditFreeClaim: false, storeCreditFreeClaimCap: 0,
        shopLocked: false,
        equipped: {}, inventory: [], talents: [],
        ...overrides,
    };
}

export function makeDraftObs(overrides: Partial<DraftObservation> = {}): DraftObservation {
    return {
        schemaVersion: OBSERVATION_SCHEMA_VERSION, runId: 'test-run', step: 0, round: 3,
        player: makePlayer(),
        shop: [], availableTalents: [], remainingTalentPoints: 0, talentRerollUsed: [],
        canUndoSell: false, nextEnemy: null, nextEnemyRevealLevel: -1,
        nextEnemyTalentClasses: [], nextEnemyItemClasses: [],
        ...overrides,
    };
}

export function makeLossRewardObs(overrides: Partial<LossRewardObservation> = {}): LossRewardObservation {
    return {
        schemaVersion: OBSERVATION_SCHEMA_VERSION, runId: 'test-run', round: 3, player: makePlayer(),
        goldAmount: 20, xpAmount: 30, itemUpgradeAvailable: false, itemUpgradeCount: 0,
        ...overrides,
    };
}
