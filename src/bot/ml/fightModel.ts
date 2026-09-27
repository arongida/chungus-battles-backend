/**
 * P(board A beats board B), from a trained fight-outcome model.
 *
 * Symmetric by construction: the model sees the matchup from both sides and the two views are
 * averaged, so winProbability(a, b) + winProbability(b, a) is exactly 1 even where the trained
 * trees are slightly lopsided.
 */
import * as fs from 'fs';
import * as path from 'path';
import { CombatBoard } from '../../ml/board';
import { FEATURE_NAMES, FEATURE_SPEC_HASH, featurize } from '../../ml/features';
import { GbdtArtifact, predictProbability } from './gbdt';

/** Always the source tree's models folder: `tsc` doesn't copy JSON into build/, and three levels up
 *  from both src/bot/ml and build/bot/ml is the repo root (the Docker image ships src/ too). */
export const MODELS_DIR = path.resolve(__dirname, '../../../src/bot/ml/models');

export class FightModel {
    constructor(readonly artifact: GbdtArtifact) {
        if (artifact.format !== 'chungus-gbdt-v1') throw new Error(`unknown model format ${artifact.format}`);
        if (artifact.featureSpecHash !== FEATURE_SPEC_HASH) {
            throw new Error(
                `fight model was trained on feature spec ${artifact.featureSpecHash}, `
                + `but src/ml/features.ts is now ${FEATURE_SPEC_HASH} — re-export the data and retrain`,
            );
        }
        if (artifact.featureNames.length !== FEATURE_NAMES.length) throw new Error('fight model feature count mismatch');
    }

    static load(file: string): FightModel {
        return new FightModel(JSON.parse(fs.readFileSync(file, 'utf8')) as GbdtArtifact);
    }

    /** One raw orientation — only exposed for the parity test. */
    predictFeatures(features: ArrayLike<number>): number {
        return predictProbability(this.artifact, features);
    }

    winProbability(a: CombatBoard, b: CombatBoard, round: number): number {
        const ab = this.predictFeatures(featurize(a, b, round));
        const ba = this.predictFeatures(featurize(b, a, round));
        return (ab + (1 - ba)) / 2;
    }
}

let cached: { file: string; model: FightModel } | null = null;

/** The newest committed model for `gameVersion` (src/bot/ml/models/fight-v<ver>.json), or null. */
export function loadFightModel(gameVersion: number): FightModel | null {
    const file = path.join(MODELS_DIR, `fight-v${gameVersion}.json`);
    if (cached?.file === file) return cached.model;
    if (!fs.existsSync(file)) return null;
    cached = { file, model: FightModel.load(file) };
    return cached.model;
}
