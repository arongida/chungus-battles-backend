import { boardFromView } from '../src/ml/board';
import { FEATURE_NAMES, FEATURE_SPEC_HASH, featurize, SKILL_VOCAB, TALENT_VOCAB, UNIQUE_ITEM_VOCAB } from '../src/ml/features';
import { ItemBehaviors } from '../src/items/behavior/ItemBehaviors';
import { TalentType } from '../src/talents/types/TalentTypes';
import { ItemSkillType } from '../src/items/types/ItemSkillTypes';
import { makeItem, makePlayer, makeTalent, makeWeapon } from './helpers/botFixtures';

const warrior = boardFromView(makePlayer({
    avatarClass: 'warrior', level: 3,
    stats: { maxHp: 600, hp: 600, strength: 40, accuracy: 15, defense: 30, attackSpeed: 1.1, dodgeRate: 0, hpRegen: 4, income: 8, cooldownReduction: 0 },
    equipped: { mainHand: makeWeapon({ uid: 1, itemId: 1, rarity: 4, skillId: ItemSkillType.REGENERATION, class: 'warrior' }), armor: makeItem({ uid: 2, itemId: 9, rarity: 2, class: 'warrior' }) },
    talents: [makeTalent({ talentId: TalentType.STRONG })],
}));
const rogue = boardFromView(makePlayer({
    avatarClass: 'rogue', level: 2,
    stats: { maxHp: 350, hp: 350, strength: 20, accuracy: 20, defense: 5, attackSpeed: 1.6, dodgeRate: 60, hpRegen: 0, income: 6, cooldownReduction: 20 },
    equipped: { mainHand: makeWeapon({ uid: 3, itemId: 2, baseAttackSpeed: 1.3 }) },
    talents: [],
}));

const idx = (name: string) => FEATURE_NAMES.indexOf(name);

describe('featurize', () => {
    it('returns one finite number per feature name', () => {
        const v = featurize(warrior, rogue, 5);
        expect(v).toHaveLength(FEATURE_NAMES.length);
        expect(v.every(Number.isFinite)).toBe(true);
        expect(new Set(FEATURE_NAMES).size).toBe(FEATURE_NAMES.length);
    });

    it('encodes class, talents and rarity-weighted skills', () => {
        const v = featurize(warrior, rogue, 5);
        expect(v[idx('a_class_warrior')]).toBe(1);
        expect(v[idx('b_class_rogue')]).toBe(1);
        expect(v[idx(`a_t_${TalentType.STRONG}`)]).toBe(1);
        expect(v[idx(`a_s_${ItemSkillType.REGENERATION}`)]).toBe(4);
        expect(TALENT_VOCAB.length).toBeGreaterThan(40);
        expect(SKILL_VOCAB.length).toBeGreaterThan(20);
    });

    it('mirrors exactly when the sides swap', () => {
        const ab = featurize(warrior, rogue, 5);
        const ba = featurize(rogue, warrior, 5);
        FEATURE_NAMES.forEach((name, i) => {
            if (name.startsWith('a_')) expect(ba[idx('b_' + name.slice(2))]).toBeCloseTo(ab[i], 9);
            else if (name.startsWith('diff_') || name.startsWith('log_')) expect(ba[i]).toBeCloseTo(-ab[i], 9);
            else if (name === 'round') expect(ba[i]).toBe(ab[i]);
        });
    });

    it('has one unique-item column per ItemBehaviors entry, rarity-weighted', () => {
        const behaviorIds = Object.keys(ItemBehaviors).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
        expect([...UNIQUE_ITEM_VOCAB].sort((a, b) => a - b)).toEqual(behaviorIds);
        const withDagger = boardFromView(makePlayer({ equipped: { mainHand: makeWeapon({ uid: 7, itemId: 18, rarity: 3 }) } }));
        expect(featurize(withDagger, rogue, 5)[idx('a_u_18')]).toBe(3);
        expect(featurize(withDagger, rogue, 5)[idx('b_u_18')]).toBe(0);
    });

    it('has a stable spec hash', () => {
        expect(FEATURE_SPEC_HASH).toMatch(/^[0-9a-f]+$/);
    });
});
