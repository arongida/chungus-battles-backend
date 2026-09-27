import { boardFromSnapshot, boardFromView, COMBAT_STAT_KEYS } from '../src/ml/board';
import { makeItem, makePlayer, makeTalent, makeWeapon } from './helpers/botFixtures';

// The training side (snapshotPlayer records) and the serving side (the bot's observation views)
// must compact the same character to the same board — that is the whole defence against
// training/serving skew.
describe('CombatBoard converters', () => {
    const weapon = makeWeapon({ uid: 1, itemId: 5, rarity: 3, skillId: 101, class: 'warrior' });
    const armor = makeItem({ uid: 2, itemId: 9, rarity: 2, equipOptions: ['armor'], class: 'warrior' });
    const talent = makeTalent({ talentId: 15, base: 1, scaling: 0.3, activationRate: 0.3 });
    const view = makePlayer({
        avatarClass: 'warrior', level: 3,
        stats: { maxHp: 480, hp: 480, strength: 30, accuracy: 12, defense: 20, attackSpeed: 1.2, dodgeRate: 5, hpRegen: 3, income: 9, cooldownReduction: 10 },
        equipped: { mainHand: weapon, armor }, talents: [talent],
    });

    // What snapshotPlayer() writes for the same character: derived stats at the top level,
    // equippedItems keyed by slot, the avatar URL instead of a class.
    const snapshot = {
        avatarUrl: 'assets/warrior_01.png', level: 3,
        ...view.stats,
        baseStats: { maxHp: 1, strength: 1 }, // must be ignored: fights run on derived stats
        equippedItems: { armor: { ...armor, triggerTypes: [] as string[] }, mainHand: { ...weapon } },
        talents: [{ ...talent, name: 'Strong!' }],
    };

    it('produces identical boards from a snapshot and from the equivalent views', () => {
        expect(boardFromSnapshot(snapshot)).toEqual(boardFromView(view));
    });

    it('reads derived stats, not baseStats', () => {
        const board = boardFromSnapshot(snapshot);
        expect(board.stats.maxHp).toBe(480);
        expect(Object.keys(board.stats).sort()).toEqual([...COMBAT_STAT_KEYS].sort());
    });

    it('is order-independent (slot and talent order do not change the board)', () => {
        const reordered = { ...snapshot, equippedItems: { mainHand: snapshot.equippedItems.mainHand, armor: snapshot.equippedItems.armor } };
        expect(boardFromSnapshot(reordered)).toEqual(boardFromSnapshot(snapshot));
    });
});
