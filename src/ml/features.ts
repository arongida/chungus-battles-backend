/**
 * Turns a matchup (board A vs board B) into the fixed-length number vector the fight-outcome model
 * reads. This is the ONLY feature implementation: the dataset export, the fight farm and the live
 * bot all call featurize(), so the model is always fed exactly what it was trained on.
 *
 * Changing anything here (a feature, its order, a vocabulary) changes FEATURE_SPEC_HASH, and a
 * model trained on an older spec will refuse to load (src/bot/ml/fightModel.ts). Retrain after.
 *
 * Feature groups, per side (prefix a_ / b_):
 *   identity    class one-hot, level
 *   stats       the nine combat stats the fight runs on
 *   gear        weapon count, raw DPS, fastest swing, item count, rarity total, class counts
 *   matchup     DPS after the OTHER side's defense/dodge, effective HP, seconds to kill the other
 *   heuristic   the v2 bot's hand-made power estimate — handed to the model as a hint it can
 *               learn to trust or ignore
 *   talents     multi-hot over the offerable talents
 *   skills      item skills, weighted by the carrying item's rarity
 *   uniques     unique items whose special effect is code (ItemBehaviors.ts), not stats or a skill —
 *               Haste of Dagger's dodge counter, Dagger of Poison's stacks. Rarity-weighted, since
 *               their effects scale with rarity. Added in spec v1.1: without them the model could
 *               only guess these items from their stat side effects.
 * plus shared: round, A−B stat differences, and log ratios of kill time and heuristic power.
 */
import { StatBlock } from '../bot/BotPolicy';
import {
    estimateDps, estimateEhp, estimatePower, mitigation, referenceEnemy, swingingWeapons, WeaponProfile,
} from '../bot/v2/combatModel';
import { NON_OFFERABLE, TALENT_HINTS } from '../bot/v2/talentCatalog';
import { ItemSkillType } from '../items/types/ItemSkillTypes';
import { CombatBoard, COMBAT_STAT_KEYS } from './board';

const CLASSES = ['rogue', 'warrior', 'merchant'] as const;

/** Offerable talents only: a never-offered id can't appear in data, so it would be a dead column. */
export const TALENT_VOCAB: number[] = Object.entries(TALENT_HINTS)
    .filter(([, hint]) => hint !== NON_OFFERABLE)
    .map(([id]) => Number(id))
    .sort((a, b) => a - b);

export const SKILL_VOCAB: number[] = Object.values(ItemSkillType)
    .filter((v): v is number => typeof v === 'number')
    .sort((a, b) => a - b);

/** Items with a bespoke behavior in src/items/behavior/ItemBehaviors.ts, keyed by itemId. Kept as a
 *  literal here because that module pulls in database code; test/mlFeatures.test.ts fails if the
 *  two ever disagree (a new unique item needs a column, then a retrain). */
export const UNIQUE_ITEM_VOCAB: number[] = [4, 7, 8, 14, 18, 19, 27, 47, 59, 82, 702, 703];

/** Nominal fight length for effective HP (regen needs a duration). */
const EHP_FIGHT_SECONDS = 20;
/** Kill times are capped so a no-damage side doesn't produce Infinity. */
const MAX_KILL_SECONDS = 600;

function sideFeatureNames(p: 'a' | 'b'): string[] {
    return [
        ...CLASSES.map((c) => `${p}_class_${c}`),
        `${p}_level`,
        ...COMBAT_STAT_KEYS.map((k) => `${p}_${k}`),
        `${p}_n_weapons`, `${p}_raw_dps`, `${p}_max_swing_rate`, `${p}_n_items`, `${p}_rarity_total`,
        ...CLASSES.map((c) => `${p}_items_${c}`),
        `${p}_dps_vs_opp`, `${p}_ehp`, `${p}_kill_seconds`,
        `${p}_heur_power`,
        ...TALENT_VOCAB.map((id) => `${p}_t_${id}`),
        ...SKILL_VOCAB.map((id) => `${p}_s_${id}`),
        ...UNIQUE_ITEM_VOCAB.map((id) => `${p}_u_${id}`),
    ];
}

export const FEATURE_NAMES: string[] = [
    'round',
    ...sideFeatureNames('a'),
    ...sideFeatureNames('b'),
    ...COMBAT_STAT_KEYS.map((k) => `diff_${k}`),
    'log_kill_time_ratio',
    'log_heur_power_ratio',
];

/** FNV-1a over the feature names — identifies the spec a model was trained against. */
export const FEATURE_SPEC_HASH: string = (() => {
    const text = FEATURE_NAMES.join('|');
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16);
})();

function statBlock(board: CombatBoard): StatBlock {
    return { ...board.stats, hp: board.stats.maxHp };
}

function weaponsOf(board: CombatBoard): WeaponProfile[] {
    return board.equipped
        .filter((item) => item.baseAttackSpeed > 0)
        .map((item) => ({
            baseMinDamage: item.baseMinDamage,
            baseMaxDamage: item.baseMaxDamage,
            bonusMaxDamage: item.bonusMaxDamage,
            baseAttackSpeed: item.baseAttackSpeed,
            strengthScaling: item.strengthScaling,
        }));
}

interface SideSummary {
    stats: StatBlock;
    weapons: WeaponProfile[];
    ehp: number;
    heurPower: number;
}

function summarize(board: CombatBoard, round: number): SideSummary {
    const stats = statBlock(board);
    const weapons = weaponsOf(board);
    return {
        stats, weapons,
        ehp: estimateEhp(stats, EHP_FIGHT_SECONDS),
        heurPower: estimatePower(stats, weapons, referenceEnemy(round)),
    };
}

function sideFeatures(board: CombatBoard, self: SideSummary, opp: SideSummary): number[] {
    const out: number[] = [];
    for (const c of CLASSES) out.push(board.avatarClass === c ? 1 : 0);
    out.push(board.level);
    for (const k of COMBAT_STAT_KEYS) out.push(board.stats[k]);

    const swinging = swingingWeapons(self.weapons);
    out.push(
        self.weapons.length,
        estimateDps(self.stats, self.weapons, { defense: 0, dodgeRate: 0 }),
        Math.max(...swinging.map((w) => Math.max(0.1, w.baseAttackSpeed * self.stats.attackSpeed))),
        board.equipped.length,
        board.equipped.reduce((sum, item) => sum + item.rarity, 0),
    );
    for (const c of CLASSES) out.push(board.equipped.filter((item) => item.class === c).length);

    const dpsVsOpp = estimateDps(self.stats, self.weapons, opp.stats);
    out.push(dpsVsOpp, self.ehp, killSeconds(dpsVsOpp, opp), self.heurPower);

    const owned = new Set(board.talents.map((t) => t.talentId));
    for (const id of TALENT_VOCAB) out.push(owned.has(id) ? 1 : 0);

    const skillRarity = new Map<number, number>();
    for (const item of board.equipped) {
        for (const id of [item.skillId, item.skillId2]) {
            if (id) skillRarity.set(id, (skillRarity.get(id) ?? 0) + item.rarity);
        }
    }
    for (const id of SKILL_VOCAB) out.push(skillRarity.get(id) ?? 0);

    const uniqueRarity = new Map<number, number>();
    for (const item of board.equipped) {
        uniqueRarity.set(item.itemId, (uniqueRarity.get(item.itemId) ?? 0) + item.rarity);
    }
    for (const id of UNIQUE_ITEM_VOCAB) out.push(uniqueRarity.get(id) ?? 0);
    return out;
}

/** Seconds for a side dealing `dps` (already after the target's mitigation) to burn through the
 *  target's HP plus regen. The raw-HP version of effective HP, since dps is already mitigated. */
function killSeconds(dps: number, target: SideSummary): number {
    const rawPool = target.ehp * mitigation(target.stats);
    return Math.min(MAX_KILL_SECONDS, rawPool / Math.max(dps, 1e-6));
}

function safeLogRatio(num: number, den: number): number {
    return Math.log(Math.max(num, 1e-6) / Math.max(den, 1e-6));
}

/** The feature vector for "A fights B at `round`", in FEATURE_NAMES order. */
export function featurize(a: CombatBoard, b: CombatBoard, round: number): number[] {
    const sa = summarize(a, round);
    const sb = summarize(b, round);
    const aFeatures = sideFeatures(a, sa, sb);
    const bFeatures = sideFeatures(b, sb, sa);
    const aKill = killSeconds(estimateDps(sa.stats, sa.weapons, sb.stats), sb);
    const bKill = killSeconds(estimateDps(sb.stats, sb.weapons, sa.stats), sa);
    const out = [
        round,
        ...aFeatures,
        ...bFeatures,
        ...COMBAT_STAT_KEYS.map((k) => a.stats[k] - b.stats[k]),
        // Positive when A kills B faster than B kills A — the single most "fight-shaped" number.
        safeLogRatio(bKill, aKill),
        safeLogRatio(sa.heurPower, sb.heurPower),
    ];
    if (out.length !== FEATURE_NAMES.length) {
        throw new Error(`featurize: produced ${out.length} values for ${FEATURE_NAMES.length} names`);
    }
    return out;
}
