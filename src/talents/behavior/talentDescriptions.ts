import { TalentType } from '../types/TalentTypes';
import { JOKER_BASE_DESCRIPTION } from './jokerState';

/** Keep catalog/offers/current loaded talents consistent with code-owned behavior changes. */
export function currentTalentDescription(talent: { talentId?: number; description?: string }): string {
    if (talent.talentId === TalentType.JOKER) return JOKER_BASE_DESCRIPTION;
    if (talent.talentId === TalentType.WARRIOR_2) {
        return talent.description?.replace('attack, regenerate, use skills', 'attack, use skills') ?? '';
    }
    return talent.description ?? '';
}
