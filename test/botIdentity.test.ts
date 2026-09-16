import { generateBotName, listBotNameCandidates } from '../src/bot/botIdentity';
import { isNameClean } from '../src/common/profanity';
import { ARCHETYPE_IDS } from '../src/bot/v2/archetypes';

const SUFFIXES: Record<string, string> = {
    balanced: 'Balanced',
    'dodge-rogue': 'Rogue',
    'bruiser-warrior': 'Bruiser',
    'tank-paladin': 'Paladin',
    'economy-merchant': 'Merchant',
    'active-caster': 'Caster',
    highroller: 'Highroller',
};

describe('bot display names', () => {
    it.each(ARCHETYPE_IDS)('shows the %s archetype and keeps every candidate valid', (archetypeId) => {
        const candidates = listBotNameCandidates(archetypeId);
        expect(candidates.length).toBeGreaterThan(100);
        for (const name of candidates) {
            expect(name.endsWith(` ${SUFFIXES[archetypeId]}`)).toBe(true);
            expect(name).not.toMatch(/[\[\]]|\bBot\b|\d/);
            expect(name.length).toBeLessThanOrEqual(24);
            expect(isNameClean(name)).toBe(true);
        }
        expect(candidates).toContain(generateBotName(archetypeId));
    });

    it('retains ordinary generated names for policies without an archetype', () => {
        for (const name of listBotNameCandidates()) {
            expect(name).not.toMatch(/[\[\]]|\bBot\b|\d/);
            expect(name.length).toBeLessThanOrEqual(24);
            expect(isNameClean(name)).toBe(true);
        }
    });
});
