/**
 * The one shape a fight-outcome model sees a character as. Built from two very different sources,
 * and it has to come out identical from both, or the model is scored on data that doesn't look
 * like what it was trained on ("training/serving skew"):
 *  - a snapshotPlayer() record (a replay's initialState, a fightSamples doc) — training data;
 *  - the bot's plain observation views (PlayerView / EnemyBuildView) — the live bot.
 *
 * Pure: no Colyseus or Mongoose imports, so the export script, the fight farm and the bot policy
 * can all share it.
 */
import { BotClass, EnemyBuildView, ItemView, PlayerView, StatBlock, TalentView } from '../bot/BotPolicy';

export type CombatStatKey =
    | 'maxHp' | 'strength' | 'accuracy' | 'defense' | 'attackSpeed'
    | 'dodgeRate' | 'hpRegen' | 'cooldownReduction' | 'income';

export const COMBAT_STAT_KEYS: CombatStatKey[] = [
    'maxHp', 'strength', 'accuracy', 'defense', 'attackSpeed', 'dodgeRate', 'hpRegen', 'cooldownReduction', 'income',
];

export type CombatStats = Record<CombatStatKey, number>;

export interface CompactItem {
    itemId: number;
    slot: string;
    rarity: number;
    type: string;
    class: string;
    skillId: number;
    skillId2: number;
    baseMinDamage: number;
    baseMaxDamage: number;
    bonusMaxDamage: number;
    baseAttackSpeed: number;
    strengthScaling: number;
    triggerTypes: string[];
    activationRate: number;
}

export interface CompactTalent {
    talentId: number;
    base: number;
    scaling: number;
    activationRate: number;
}

export interface CombatBoard {
    avatarClass: BotClass | null;
    level: number;
    /** Derived (post-recalculation) stats — what the fight actually runs on. */
    stats: CombatStats;
    equipped: CompactItem[];
    talents: CompactTalent[];
}

const AVATAR_CLASS: Record<string, BotClass> = {
    'assets/thief_01.png': 'rogue',
    'assets/warrior_01.png': 'warrior',
    'assets/merchant_01.png': 'merchant',
};

function num(v: unknown, fallback = 0): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

function statsFrom(source: Record<string, any>): CombatStats {
    const out = {} as CombatStats;
    for (const key of COMBAT_STAT_KEYS) out[key] = num(source?.[key], key === 'attackSpeed' ? 1 : 0);
    return out;
}

function compactItem(item: Record<string, any>, slot: string): CompactItem {
    return {
        itemId: num(item.itemId),
        slot,
        rarity: num(item.rarity, 1),
        type: String(item.type ?? ''),
        class: String(item.class ?? ''),
        skillId: num(item.skillId),
        skillId2: num(item.skillId2),
        baseMinDamage: num(item.baseMinDamage),
        baseMaxDamage: num(item.baseMaxDamage),
        bonusMaxDamage: num(item.bonusMaxDamage),
        baseAttackSpeed: num(item.baseAttackSpeed),
        strengthScaling: num(item.strengthScaling, 1),
        triggerTypes: Array.from((item.triggerTypes ?? []) as Iterable<string>).map(String),
        activationRate: num(item.activationRate),
    };
}

function compactTalent(talent: Record<string, any>): CompactTalent {
    return {
        talentId: num(talent.talentId),
        base: num(talent.base),
        scaling: num(talent.scaling),
        activationRate: num(talent.activationRate),
    };
}

/** Sorted so the same build always compacts to the same document regardless of Map order. */
function sortBoard(board: CombatBoard): CombatBoard {
    board.equipped.sort((a, b) => a.slot.localeCompare(b.slot));
    board.talents.sort((a, b) => a.talentId - b.talentId);
    return board;
}

/** From a snapshotPlayer() record (replay initialState.player/.enemy). Its stats are the derived
 *  top-level fields, not baseStats. */
export function boardFromSnapshot(snapshot: Record<string, any>): CombatBoard {
    const equipped = Object.entries((snapshot.equippedItems ?? {}) as Record<string, Record<string, any>>)
        .filter(([, item]) => !!item)
        .map(([slot, item]) => compactItem(item, slot));
    return sortBoard({
        avatarClass: AVATAR_CLASS[snapshot.avatarUrl] ?? null,
        level: num(snapshot.level, 1),
        stats: statsFrom(snapshot),
        equipped,
        talents: ((snapshot.talents ?? []) as Record<string, any>[]).map(compactTalent),
    });
}

/** From the bot's own observation shapes — a PlayerView, an EnemyBuildView, or a hypothetical
 *  board the policy is scoring (its stats come from evaluateLoadout). */
export function boardFromView(view: {
    avatarClass?: BotClass;
    level: number;
    stats: StatBlock;
    equipped: Partial<Record<string, ItemView>>;
    talents: TalentView[];
}): CombatBoard {
    const equipped = Object.entries(view.equipped)
        .filter(([, item]) => !!item)
        .map(([slot, item]) => compactItem(item as unknown as Record<string, any>, slot));
    return sortBoard({
        avatarClass: view.avatarClass ?? null,
        level: view.level,
        stats: statsFrom(view.stats),
        equipped,
        talents: view.talents.map((t) => compactTalent(t as unknown as Record<string, any>)),
    });
}

export function boardFromPlayerView(player: PlayerView): CombatBoard {
    return boardFromView(player);
}

export function boardFromEnemyBuild(enemy: EnemyBuildView): CombatBoard {
    return boardFromView(enemy);
}
