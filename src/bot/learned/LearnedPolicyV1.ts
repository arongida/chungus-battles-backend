/**
 * learned-v1: heuristic-v2's decision machinery (economy, rerolls, talents, class-locked
 * archetypes) with its hand-made combat model swapped for a model trained on real fight results
 * (src/bot/ml/, trained in ml/).
 *
 * A board is worth the log-odds that it beats the field:
 *
 *     p     = w * P(board beats scouted next enemy) + (1 - w) * mean P(board beats reference opponent)
 *     value = VALUE_SCALE * logit(p)
 *
 * `w` is the same stakes-based scout weight v2 uses. The field is a sample of stored same-round
 * builds the runner attaches to each observation.
 *
 * Why log-odds and not the probability itself: once the bot out-classes its opponents, p sits near
 * 1 for every candidate board and the differences between them vanish — the bot would stop caring
 * about getting stronger exactly when later, tougher rounds make it matter. Log-odds keep those
 * differences visible (0.99 -> 0.995 is as big a step as 0.5 -> 0.67).
 */
import { DraftObservation } from '../BotPolicy';
import { BoardValuer, HeuristicPolicyV2, HeuristicPolicyV2Options } from '../v2/HeuristicPolicyV2';
import { boardFromEnemyBuild, CombatBoard } from '../../ml/board';
import { FightModel, loadFightModel } from '../ml/fightModel';
import { scoutWeight } from '../v2/economy';
import { GAME_VERSION } from '../../common/types';

/** Scale of one value unit: 10 units = 1 logit (~ +23 percentage points around a coin flip). Puts
 *  v2's absolute thresholds (ACTION_EPSILON 0.05, EQUIP_HYSTERESIS_ABS 0.5) at sensible sizes. */
export const VALUE_SCALE = 10;
const P_CLAMP = 1e-4;
export const REFERENCE_OPPONENTS = 8;

function logit(p: number): number {
    const q = Math.min(1 - P_CLAMP, Math.max(P_CLAMP, p));
    return Math.log(q / (1 - q));
}

export interface LearnedPolicyV1Options extends HeuristicPolicyV2Options {
    /** Injected in tests; defaults to the committed model for the current GAME_VERSION. */
    model?: FightModel;
}

export class LearnedPolicyV1 extends HeuristicPolicyV2 {
    readonly id: string = 'learned-v1';
    readonly version: string = '1.0.0';
    readonly referenceOpponentCount = REFERENCE_OPPONENTS;
    private readonly model: FightModel;

    constructor(opts: LearnedPolicyV1Options = {}) {
        super(opts);
        const model = opts.model ?? loadFightModel(GAME_VERSION);
        if (!model) {
            throw new Error(`learned-v1: no fight model for game version ${GAME_VERSION} (expected src/bot/ml/models/fight-v${GAME_VERSION}.json)`);
        }
        this.model = model;
    }

    protected makeValuer(obs: DraftObservation): BoardValuer | undefined {
        const field = (obs.referenceOpponents ?? []).map(boardFromEnemyBuild);
        const scouted = obs.nextEnemyBuild ? boardFromEnemyBuild(obs.nextEnemyBuild) : null;
        if (!scouted && field.length === 0) return undefined; // nothing to measure against: v2 fallback
        const w = scouted ? (field.length ? scoutWeight(obs.player) : 1) : 0;
        const round = obs.round;
        return (board: CombatBoard) => {
            const vsScouted = scouted ? this.model.winProbability(board, scouted, round) : 0;
            const vsField = field.length
                ? field.reduce((sum, opp) => sum + this.model.winProbability(board, opp, round), 0) / field.length
                : 0;
            return VALUE_SCALE * logit(w * vsScouted + (1 - w) * vsField);
        };
    }
}
