import { ITEM_SKILLS, skillValues } from '../src/items/behavior/itemSkillBalance';
import { ItemRarity } from '../src/items/types/ItemTypes';
import { SKILL_HINTS } from '../src/bot/v2/skillCatalog';
import { TALENT_HINTS } from '../src/bot/v2/talentCatalog';
import { TalentType } from '../src/talents/types/TalentTypes';
import { ARCHETYPES } from '../src/bot/v2/archetypes';
import { buildActivationContext } from '../src/bot/v2/synergy';
import { buildPowerContext } from '../src/bot/v2/combatModel';
import { makeDraftObs, makePlayer, makeWeapon } from './helpers/botFixtures';

// Guards the two hand-written catalogs the v2 bot policy reads. A skill or talent shipped without
// a hint is invisible to the bot, and a renamed tuning key silently turns a hint into NaN — both
// fail here rather than quietly degrading every bot run.

function ctx() {
    const obs = makeDraftObs({
        player: makePlayer({
            gold: 20, luckyFindChance: 0.2,
            stats: {
                maxHp: 800, hp: 800, strength: 30, accuracy: 15, defense: 50, attackSpeed: 1.2,
                dodgeRate: 25, hpRegen: 5, income: 8, cooldownReduction: 20,
            },
            equipped: { mainHand: makeWeapon() },
        }),
    });
    return buildActivationContext(obs, buildPowerContext(obs));
}

describe('item skill catalog coverage', () => {
    it('has a hint for every skill in ITEM_SKILLS', () => {
        const missing = Object.values(ITEM_SKILLS)
            .filter((def) => !SKILL_HINTS[def.id])
            .map((def) => `${def.id} (${def.name})`);
        expect(missing).toEqual([]);
    });

    it('has no hint for a skill that no longer exists', () => {
        const orphans = Object.keys(SKILL_HINTS).map(Number).filter((id) => !ITEM_SKILLS[id]);
        expect(orphans).toEqual([]);
    });

    // The assertion a plain coverage test misses: a hint can reference a tuning key that has been
    // renamed in itemSkillBalance.ts, which yields undefined -> NaN and silently poisons scoring.
    it('produces finite numbers against every defined rarity bracket', () => {
        const activation = ctx();
        const broken: string[] = [];

        for (const def of Object.values(ITEM_SKILLS)) {
            const hint = SKILL_HINTS[def.id];
            if (!hint) continue;
            for (const rarity of [ItemRarity.COMMON, ItemRarity.LEGENDARY, ItemRarity.MYTHIC]) {
                const v = skillValues(def, rarity);
                const label = `${def.id} ${def.name} @${rarity}`;
                const check = (what: string, n: number | undefined) => {
                    if (n !== undefined && !Number.isFinite(n)) broken.push(`${label} ${what} -> ${n}`);
                };
                check('damagePerProc', hint.damagePerProc?.(v, activation));
                check('ehpPerProc', hint.ehpPerProc?.(v, activation));
                check('goldPerFight', hint.goldPerFight?.(v, activation));
                check('goldPerRound', hint.goldPerRound?.(v, activation));
                for (const [stat, value] of Object.entries(hint.auraStats?.(v, activation) ?? {})) {
                    check(`auraStats.${stat}`, value as number);
                }
            }
        }

        expect(broken).toEqual([]);
    });

    it('marks every scaling-graph skill as measured by the aura pass', () => {
        // A scaling skill's output is already in player.stats once equipped; a hint that also
        // scored it would double-count. This catches a new scaling skill added without the flag.
        const unflagged = Object.values(ITEM_SKILLS)
            .filter((def) => def.scaling && !SKILL_HINTS[def.id]?.measuredByAura)
            .map((def) => `${def.id} (${def.name})`);
        expect(unflagged).toEqual([]);
    });
});

describe('talent catalog coverage', () => {
    it('has a hint for every TalentType', () => {
        const missing = Object.entries(TalentType)
            .filter(([, id]) => typeof id === 'number')
            .filter(([, id]) => !TALENT_HINTS[id as number])
            .map(([name, id]) => `${id} (${name})`);
        expect(missing).toEqual([]);
    });

    it('has no hint for a talent id that is not in the enum', () => {
        const known = new Set(Object.values(TalentType).filter((v) => typeof v === 'number'));
        const orphans = Object.keys(TALENT_HINTS).map(Number).filter((id) => !known.has(id));
        expect(orphans).toEqual([]);
    });
});

describe('archetypes', () => {
    it('keys every entry by its own id', () => {
        for (const [id, weights] of Object.entries(ARCHETYPES)) expect(weights.id).toBe(id);
    });

    it('includes a neutral control arm', () => {
        const balanced = ARCHETYPES.balanced;
        expect(balanced.economyWeight).toBe(1);
        expect(balanced.rerollAppetite).toBe(1);
        expect(balanced.riskTolerance).toBe(1);
        expect(balanced.skillPremium).toBe(1);
        expect(balanced.statAffinity).toEqual({});
        expect(balanced.triggerAffinity).toEqual({});
    });
});
