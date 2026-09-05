// Scaling declarations for the 3 talents whose AURA behavior reads `attackerSnapshot` (see
// scalingGraph.ts). Talents are DB-backed and dispatched by ID (TalentBehaviors.ts), not from a
// static per-talent definition object the way itemSkillBalance.ts's `scaling` field is — so this
// is its own small map instead of a field alongside each behavior.

import { ScalingDeclaration, skillNode, talentNode } from '../../common/scalingGraph';
import { TalentType } from '../types/TalentTypes';
import { ItemSkillType } from '../../items/types/ItemSkillTypes';

export const TALENT_SCALING: Record<number, ScalingDeclaration> = {
  // Strong: +max HP (a fraction of current max HP) and a flat +10 strength. Runs before Bulwark
  // among the max-HP scalers — see BULWARK's `after` (itemSkillBalance.ts) for the STRONG<->
  // Bulwark tie-break reasoning: both read AND write maxHp, so left to natural edges alone they'd
  // cycle.
  [TalentType.STRONG]: {
    reads: ['maxHp'],
    writes: ['maxHp', 'strength'],
  },

  // Berserk — below `activationRate` HP, gain `scaling`x strength (and the same to attack speed,
  // untracked here — see StatKey's comment on why). Reads strength so it scales off Titan's
  // Might's / Strong's contribution too, not just base+item strength.
  [TalentType.BERSERK]: {
    reads: ['strength'],
    writes: ['strength'],
  },

  // Zealot: converts half your defense into attack speed. Reads and writes defense — the
  // self-edge the graph excludes by construction. `after: LAST_STAND` breaks the genuine cycle
  // with Last Stand (which also reads and writes defense): Zealot runs last so it converts the
  // full defense pool, including Last Stand's emergency bonus.
  [TalentType.ZEALOT]: {
    reads: ['defense'],
    writes: ['defense'],
    after: [skillNode(ItemSkillType.LAST_STAND)],
  },

  // Merchant's capstone: converts income into a percentage bonus on nearly every other stat.
  // Reads almost the whole stat block, so left to natural edges it would cycle with literally
  // every other scaling source (each of them both reads and writes some stat this also touches —
  // e.g. it reads AND writes strength, exactly like Berserk does, which is a mutual cycle on its
  // own). Forcing it after every other scaling node sidesteps all of that at once: it always
  // reads the fully-built board, and its own writes never feed back into an earlier node —
  // exactly right for a stat capping off the board, not a source other pieces are meant to
  // build on.
  [TalentType.MERCHANT_5]: {
    reads: ['income', 'strength', 'accuracy', 'defense', 'maxHp', 'dodgeRate', 'hpRegen'],
    writes: ['income', 'strength', 'accuracy', 'defense', 'maxHp', 'dodgeRate', 'hpRegen'],
    after: [
      talentNode(TalentType.STRONG),
      talentNode(TalentType.BERSERK),
      talentNode(TalentType.ZEALOT),
      skillNode(ItemSkillType.BULWARK),
      skillNode(ItemSkillType.TITANS_MIGHT),
      skillNode(ItemSkillType.IRONBLOOD),
      skillNode(ItemSkillType.LAST_STAND),
      skillNode(ItemSkillType.FLUID_MOTION),
      skillNode(ItemSkillType.COMPOUND_INTEREST),
    ],
  },
};
