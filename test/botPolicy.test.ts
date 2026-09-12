import {
    buyFloor, chooseEquipAction, chooseFreeClaimBuy, chooseLossReward, chooseReroll,
    chooseScoredBuy, chooseSellAction, chooseTalentAction, chooseXpPurchase, effectivePrice,
    isFreeClaimEligible, nextDraftAction, scoreShopItem,
} from '../src/bot/HeuristicPolicy';
import { BotAction, DraftObservation, ItemView, LossRewardObservation, PlayerView, TalentView } from '../src/bot/BotPolicy';

// Pure unit tests for the heuristic bot policy — no live MongoDB or Colyseus room required (like
// matchmaking.test.ts), since every function under test takes plain observation objects.

function makeItem(overrides: Partial<ItemView> = {}): ItemView {
    return {
        uid: 1, itemId: 1, name: 'Test Item', price: 10, sellPrice: 7, rarity: 1, tier: 1,
        type: 'weapon', class: '', tags: [], equipOptions: ['mainHand'],
        affectedStats: { strength: 3 }, affectedEnemyStats: {},
        baseMinDamage: 0, baseMaxDamage: 0, baseAttackSpeed: 0,
        upgradePreview: false, previewBaseRarity: 0, luckyFind: false, luckyFindSteps: 0,
        skillId: 0, skillName: '', skillDescription: '', futureSkillId: 0, futureSkillName: '',
        sold: false, equipped: false,
        ...overrides,
    };
}

function makeTalent(overrides: Partial<TalentView> = {}): TalentView {
    return {
        talentId: 1, name: 'Test Talent', tier: 1, tags: [], triggerTypes: [],
        affectedStats: { strength: 2 }, affectedEnemyStats: {},
        ...overrides,
    };
}

function makePlayer(overrides: Partial<PlayerView> = {}): PlayerView {
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
        equipped: {}, inventory: [], talents: [],
        ...overrides,
    };
}

function makeDraftObs(overrides: Partial<DraftObservation> = {}): DraftObservation {
    return {
        schemaVersion: 1, runId: 'test-run', step: 0, round: 3,
        player: makePlayer(),
        shop: [], availableTalents: [], remainingTalentPoints: 0, talentRerollUsed: [],
        canUndoSell: false, nextEnemy: null, nextEnemyRevealLevel: -1,
        nextEnemyTalentClasses: [], nextEnemyItemClasses: [],
        ...overrides,
    };
}

function makeLossRewardObs(overrides: Partial<LossRewardObservation> = {}): LossRewardObservation {
    return {
        schemaVersion: 1, runId: 'test-run', round: 3, player: makePlayer(),
        goldAmount: 20, xpAmount: 30, itemUpgradeAvailable: false, itemUpgradeCount: 0,
        ...overrides,
    };
}

describe('isFreeClaimEligible / effectivePrice', () => {
    // Mirrors DraftRoom.buyItem's mutually-exclusive priority order EXACTLY (DraftRoom.ts:548-553):
    // lucky-find > gold-genie > store-credit > comrade > misconduct.
    it('is not eligible for a sold item regardless of claims', () => {
        const player = makePlayer({ comradeFreeClaim: true });
        const item = makeItem({ sold: true });
        expect(isFreeClaimEligible(item, player)).toBe(false);
        expect(effectivePrice(item, player)).toBe(item.price);
    });

    it('lucky-find claim requires the item itself to have rolled lucky', () => {
        const player = makePlayer({ luckyFindFreeClaim: true });
        expect(isFreeClaimEligible(makeItem({ luckyFind: true }), player)).toBe(true);
        expect(isFreeClaimEligible(makeItem({ luckyFind: false }), player)).toBe(false);
    });

    it('gold-genie claim only applies to merchant-class items', () => {
        const player = makePlayer({ goldGenieFreeClaim: true });
        expect(isFreeClaimEligible(makeItem({ class: 'merchant' }), player)).toBe(true);
        expect(isFreeClaimEligible(makeItem({ class: 'warrior' }), player)).toBe(false);
    });

    it('store-credit claim only covers items at or under its cap', () => {
        const player = makePlayer({ storeCreditFreeClaim: true, storeCreditFreeClaimCap: 15 });
        expect(isFreeClaimEligible(makeItem({ price: 15 }), player)).toBe(true);
        expect(isFreeClaimEligible(makeItem({ price: 16 }), player)).toBe(false);
    });

    it('comrade claim applies to any unsold item', () => {
        const player = makePlayer({ comradeFreeClaim: true });
        expect(isFreeClaimEligible(makeItem({ price: 999 }), player)).toBe(true);
    });

    it('misconduct claim applies to any unsold item', () => {
        const player = makePlayer({ misconductFreeClaim: true });
        expect(isFreeClaimEligible(makeItem({ price: 999 }), player)).toBe(true);
    });

    it('effectivePrice is 0 whenever any claim is eligible, otherwise the item price', () => {
        const player = makePlayer({ comradeFreeClaim: true });
        expect(effectivePrice(makeItem({ price: 50 }), player)).toBe(0);
        expect(effectivePrice(makeItem({ price: 50 }), makePlayer())).toBe(50);
    });

    it('lucky-find takes priority over gold-genie when both could apply', () => {
        // A merchant item that also rolled lucky, with both claims live — chooseFreeClaimBuy
        // doesn't need to know which claim actually fires (the room resolves that), only that
        // *some* claim applies — but isFreeClaimEligible's priority order must still match the
        // room's so a later cap-limited claim (store-credit) is never assumed to apply when a
        // higher-priority unconditional one (comrade) would actually be the one spent.
        const player = makePlayer({ luckyFindFreeClaim: true, goldGenieFreeClaim: true });
        const item = makeItem({ luckyFind: true, class: 'merchant' });
        expect(isFreeClaimEligible(item, player)).toBe(true);
    });
});

describe('chooseFreeClaimBuy', () => {
    it('buys the most expensive eligible item when multiple qualify', () => {
        const player = makePlayer({ comradeFreeClaim: true, gold: 0 });
        const shop = [
            makeItem({ itemId: 1, price: 5 }),
            makeItem({ itemId: 2, price: 50 }),
            makeItem({ itemId: 3, price: 20 }),
        ];
        const action = chooseFreeClaimBuy(makeDraftObs({ player, shop }));
        expect(action).toEqual({ type: 'buy', itemId: 2, reason: 'free_claim' });
    });

    it('returns null when nothing qualifies', () => {
        const action = chooseFreeClaimBuy(makeDraftObs({ shop: [makeItem()] }));
        expect(action).toBeNull();
    });
});

describe('chooseScoredBuy', () => {
    it('never returns an item priced above available gold', () => {
        const player = makePlayer({ gold: 10, round: 5 });
        const shop = [
            makeItem({ itemId: 1, price: 100, affectedStats: { strength: 999 } }), // best score, unaffordable
            makeItem({ itemId: 2, price: 5, affectedStats: { strength: 3 } }),
        ];
        const action = chooseScoredBuy(makeDraftObs({ player, shop }));
        expect(action).not.toBeNull();
        expect(action!.type).toBe('buy');
        if (action!.type === 'buy') {
            const bought = shop.find((i) => i.itemId === action!.itemId)!;
            expect(effectivePrice(bought, player)).toBeLessThanOrEqual(player.gold);
        }
    });

    it('never returns a sold item', () => {
        const player = makePlayer({ gold: 100 });
        const shop = [makeItem({ itemId: 1, price: 1, sold: true, affectedStats: { strength: 999 } })];
        expect(chooseScoredBuy(makeDraftObs({ player, shop }))).toBeNull();
    });

    it('does not buy below the level-scaled floor', () => {
        const player = makePlayer({ gold: 100, level: 5 }); // highest floor
        const shop = [makeItem({ itemId: 1, price: 50, affectedStats: { strength: 1 } })]; // tiny marginal value, expensive
        expect(chooseScoredBuy(makeDraftObs({ player, shop }))).toBeNull();
    });

    it('scores an upgrade-preview slot by its marginal gain over the owned item, not its absolute stats', () => {
        const owned = makeItem({ uid: 5, itemId: 42, affectedStats: { strength: 10 } });
        const player = makePlayer({ gold: 100, inventory: [owned] });
        const preview = makeItem({ itemId: 42, upgradePreview: true, price: 10, affectedStats: { strength: 12 } });
        const scoreWithOwnership = scoreShopItem(preview, makeDraftObs({ player, shop: [preview] }));

        const playerNoOwnership = makePlayer({ gold: 100, inventory: [] });
        const scoreWithoutOwnership = scoreShopItem(preview, makeDraftObs({ player: playerNoOwnership, shop: [preview] }));

        // Marginal (12-10=2 strength) must score far lower than treating it as a fresh +12 item.
        expect(scoreWithOwnership).toBeLessThan(scoreWithoutOwnership);
    });
});

describe('chooseReroll', () => {
    it('always rerolls when free, regardless of shop quality', () => {
        const player = makePlayer({ freeRerolls: true });
        const shop = [makeItem({ affectedStats: { strength: 999 } })]; // shop is already great
        expect(chooseReroll(makeDraftObs({ player, shop }))).toEqual({ type: 'refresh_shop', reason: 'free_reroll' });
    });

    it('rerolls with a free charge even with 0 gold', () => {
        const player = makePlayer({ freeRerollCharges: 1, gold: 0 });
        expect(chooseReroll(makeDraftObs({ player, shop: [makeItem()] }))?.type).toBe('refresh_shop');
    });

    it('never exceeds the per-round paid reroll cap', () => {
        const player = makePlayer({ gold: 100, rerollsThisRound: 3 });
        const shop = [makeItem({ affectedStats: { strength: 0 } })]; // weak shop, would otherwise reroll
        expect(chooseReroll(makeDraftObs({ player, shop }))).toBeNull();
    });

    it('does not reroll when gold cannot cover the cost plus buffer', () => {
        const player = makePlayer({ gold: 2, refreshShopCost: 2 });
        const shop = [makeItem({ affectedStats: { strength: 0 } })];
        expect(chooseReroll(makeDraftObs({ player, shop }))).toBeNull();
    });
});

describe('chooseXpPurchase', () => {
    it('never buys past level 5', () => {
        const player = makePlayer({ level: 5, xp: 0, maxXp: 190, gold: 1000 });
        expect(chooseXpPurchase(makeDraftObs({ player }))).toBeNull();
    });

    it('is blocked by the Future is Now talent (id 32)', () => {
        const player = makePlayer({ level: 1, xp: 0, maxXp: 10, gold: 100, talents: [makeTalent({ talentId: 32 })] });
        expect(chooseXpPurchase(makeDraftObs({ player }))).toBeNull();
    });

    it('buys up to a cheap next level (L2, 10xp -> 12g cost at 4xp/4g rounding)', () => {
        const player = makePlayer({ level: 1, xp: 0, maxXp: 10, gold: 100 });
        const action = chooseXpPurchase(makeDraftObs({ player }));
        expect(action).toEqual({ type: 'level_up', reason: expect.any(String) });
    });

    it('will not buy an expensive level even with plenty of gold', () => {
        // L4 costs 55 xp -> 56 gold, far past XP_BUY_GOLD_CEILING.
        const player = makePlayer({ level: 3, xp: 0, maxXp: 55, gold: 1000 });
        expect(chooseXpPurchase(makeDraftObs({ player }))).toBeNull();
    });

    it('does not spend below the minimum gold buffer', () => {
        const player = makePlayer({ level: 1, xp: 0, maxXp: 10, gold: 10 }); // cost 12 > gold - buffer(6) never possible
        expect(chooseXpPurchase(makeDraftObs({ player }))).toBeNull();
    });
});

describe('chooseTalentAction', () => {
    it('returns null with 0 offered talents', () => {
        expect(chooseTalentAction(makeDraftObs({ remainingTalentPoints: 1, availableTalents: [] }))).toBeNull();
    });

    it('handles 1-2 offered talents (only 4 tier-5 talents exist in the real game)', () => {
        const talents = [makeTalent({ talentId: 501, tier: 5 })];
        const action = chooseTalentAction(makeDraftObs({
            remainingTalentPoints: 1, availableTalents: talents, talentRerollUsed: [false],
        }));
        expect(action).not.toBeNull();
    });

    it('rerolls a weak, not-yet-rerolled slot before selecting', () => {
        const talents = [
            makeTalent({ talentId: 1, affectedStats: {} }), // weak
            makeTalent({ talentId: 2, affectedStats: { strength: 50 } }), // strong
        ];
        const action = chooseTalentAction(makeDraftObs({
            remainingTalentPoints: 1, availableTalents: talents, talentRerollUsed: [false, false],
        }));
        expect(action).toEqual({ type: 'refresh_talent_slot', talentId: 1, reason: expect.any(String) });
    });

    it('never rerolls the same slot twice, regardless of NODE_ENV — the server only blocks a second reroll in production, so the policy must self-limit', () => {
        const talents = [
            makeTalent({ talentId: 1, affectedStats: {} }),
            makeTalent({ talentId: 2, affectedStats: {} }),
        ];
        const obs = makeDraftObs({
            remainingTalentPoints: 1, availableTalents: talents, talentRerollUsed: [true, true],
        });
        const originalEnv = process.env.NODE_ENV;
        try {
            process.env.NODE_ENV = 'development';
            const devAction = chooseTalentAction(obs);
            process.env.NODE_ENV = 'production';
            const prodAction = chooseTalentAction(obs);
            expect(devAction!.type).toBe('select_talent');
            expect(prodAction!.type).toBe('select_talent');
            expect(devAction).toEqual(prodAction);
        } finally {
            process.env.NODE_ENV = originalEnv;
        }
    });

    it('breaks ties by ascending talentId for reproducibility', () => {
        const talents = [
            makeTalent({ talentId: 5, affectedStats: { strength: 10 } }),
            makeTalent({ talentId: 2, affectedStats: { strength: 10 } }),
        ];
        const action = chooseTalentAction(makeDraftObs({
            remainingTalentPoints: 1, availableTalents: talents, talentRerollUsed: [true, true],
        }));
        expect(action).toEqual({ type: 'select_talent', talentId: 2, reason: expect.any(String) });
    });
});

describe('chooseEquipAction', () => {
    it('equips into an empty slot', () => {
        const item = makeItem({ uid: 9, equipOptions: ['helmet'], affectedStats: { defense: 5 } });
        const player = makePlayer({ inventory: [item], equipped: {} });
        expect(chooseEquipAction(makeDraftObs({ player }))).toEqual({ type: 'equip', uid: 9, slot: 'helmet', reason: 'empty_slot' });
    });

    it('does not swap for a marginal (<15%) improvement', () => {
        const incumbent = makeItem({ uid: 1, equipOptions: ['helmet'], affectedStats: { defense: 10 } });
        const candidate = makeItem({ uid: 2, equipOptions: ['helmet'], affectedStats: { defense: 10.5 } });
        const player = makePlayer({ inventory: [candidate], equipped: { helmet: incumbent } });
        expect(chooseEquipAction(makeDraftObs({ player }))).toBeNull();
    });

    it('swaps for a clear (>15%) improvement', () => {
        const incumbent = makeItem({ uid: 1, equipOptions: ['helmet'], affectedStats: { defense: 10 } });
        const candidate = makeItem({ uid: 2, equipOptions: ['helmet'], affectedStats: { defense: 20 } });
        const player = makePlayer({ inventory: [candidate], equipped: { helmet: incumbent } });
        expect(chooseEquipAction(makeDraftObs({ player }))).toEqual({ type: 'equip', uid: 2, slot: 'helmet', reason: 'beats_incumbent' });
    });
});

describe('chooseSellAction', () => {
    it('never sells an item that is the upgrade source of a current shop preview', () => {
        const ownedWeapon = makeItem({ uid: 1, itemId: 42, sellPrice: 100, affectedStats: {} }); // low score, would otherwise sell
        const preview = makeItem({ itemId: 42, upgradePreview: true, price: 5, affectedStats: { strength: 500 } });
        const player = makePlayer({ gold: 0, inventory: [ownedWeapon] });
        const action = chooseSellAction(makeDraftObs({ player, shop: [preview] }));
        expect(action).toBeNull();
    });

    it('sells a weak item to afford a much better shop item', () => {
        const weakOwned = makeItem({ uid: 1, itemId: 99, sellPrice: 50, affectedStats: {} });
        const greatShopItem = makeItem({ itemId: 7, price: 40, affectedStats: { strength: 500 } });
        const player = makePlayer({ gold: 0, inventory: [weakOwned] });
        const action = chooseSellAction(makeDraftObs({ player, shop: [greatShopItem] }));
        expect(action).toEqual({ type: 'sell', uid: 1, reason: expect.any(String) });
    });
});

describe('chooseLossReward', () => {
    it('prefers gold at level 5 with no item upgrade available', () => {
        const player = makePlayer({ level: 5 });
        expect(chooseLossReward(makeLossRewardObs({ player, itemUpgradeAvailable: false }))).toBe('gold');
    });

    it('prefers item_upgrade when 2+ equipped class items are below Legendary', () => {
        const player = makePlayer({
            level: 5,
            equipped: {
                mainHand: makeItem({ class: 'warrior', rarity: 2 }),
                offHand: makeItem({ class: 'warrior', rarity: 1 }),
            },
        });
        expect(chooseLossReward(makeLossRewardObs({ player, itemUpgradeAvailable: true }))).toBe('item_upgrade');
    });

    it('prefers xp when it covers a big chunk of the next level and no upgrade is on offer', () => {
        const player = makePlayer({ level: 1, xp: 0, maxXp: 10 });
        expect(chooseLossReward(makeLossRewardObs({ player, itemUpgradeAvailable: false, xpAmount: 20 }))).toBe('xp');
    });
});

describe('nextDraftAction fuzzing', () => {
    function randomItem(id: number): ItemView {
        return makeItem({
            uid: id, itemId: id, price: Math.floor(Math.random() * 30),
            sellPrice: Math.floor(Math.random() * 20), rarity: 1 + Math.floor(Math.random() * 5),
            class: ['', 'rogue', 'warrior', 'merchant'][Math.floor(Math.random() * 4)],
            equipOptions: [['mainHand'], ['offHand'], ['armor'], ['helmet'], ['drink']][Math.floor(Math.random() * 5)],
            affectedStats: { strength: Math.random() * 20 - 5, defense: Math.random() * 10 },
            upgradePreview: Math.random() < 0.2,
            luckyFindSteps: Math.random() < 0.1 ? 1 : 0,
            sold: Math.random() < 0.1,
        });
    }

    function randomTalent(id: number): TalentView {
        return makeTalent({
            talentId: id, tier: 1 + Math.floor(Math.random() * 5),
            tags: Math.random() < 0.5 ? ['warrior'] : [],
            affectedStats: { strength: Math.random() * 10 },
        });
    }

    function randomObs(i: number): DraftObservation {
        const shop = Array.from({ length: 6 }, (_, k) => randomItem(100 + i * 10 + k));
        const inventory = Math.random() < 0.5
            ? Array.from({ length: 1 + Math.floor(Math.random() * 3) }, (_, k) => randomItem(200 + i * 10 + k))
            : [];
        const availableTalents = Math.random() < 0.7
            ? Array.from({ length: Math.floor(Math.random() * 4) }, (_, k) => randomTalent(300 + i * 10 + k))
            : [];
        const player = makePlayer({
            gold: Math.floor(Math.random() * 50),
            level: 1 + Math.floor(Math.random() * 5),
            round: 1 + Math.floor(Math.random() * 15),
            rerollsThisRound: Math.floor(Math.random() * 4),
            freeRerolls: Math.random() < 0.1,
            freeRerollCharges: Math.random() < 0.2 ? 1 : 0,
            inventory,
        });
        return makeDraftObs({
            player, shop, availableTalents,
            remainingTalentPoints: Math.random() < 0.5 ? 1 : 0,
            talentRerollUsed: availableTalents.map(() => Math.random() < 0.5),
        });
    }

    it('every returned action references an id actually present in that observation', () => {
        for (let i = 0; i < 1000; i++) {
            const obs = randomObs(i);
            let action: BotAction | null;
            try {
                action = nextDraftAction(obs);
            } catch (err) {
                throw new Error(`nextDraftAction threw on iteration ${i}: ${err}\nobs=${JSON.stringify(obs)}`);
            }
            if (!action) continue;
            switch (action.type) {
                case 'buy':
                    expect(obs.shop.some((item) => item.itemId === (action as any).itemId)).toBe(true);
                    break;
                case 'sell':
                    expect(obs.player.inventory.some((item) => item.uid === (action as any).uid)).toBe(true);
                    break;
                case 'equip':
                    expect(obs.player.inventory.some((item) => item.uid === (action as any).uid)).toBe(true);
                    break;
                case 'select_talent':
                case 'refresh_talent_slot':
                    expect(obs.availableTalents.some((t) => t.talentId === (action as any).talentId)).toBe(true);
                    break;
                default:
                    break;
            }
        }
    });
});
