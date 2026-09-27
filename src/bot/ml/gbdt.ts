/**
 * Evaluates a LightGBM model exported by ml/export_model.py.
 *
 * A gradient-boosted model is a list of small binary decision trees. Each split node asks
 * "is feature f <= threshold t?" and goes left or right; each tree ends in a leaf holding a number.
 * The model's raw score is the SUM of the leaves the input lands in across all trees, and for a
 * probability objective the prediction is sigmoid(raw). That is all inference is — this file.
 *
 * Synchronous and dependency-free on purpose: the bot's scorers are synchronous and evaluate many
 * candidate boards per decision, and a few hundred shallow trees cost microseconds.
 */

export type GbdtNode =
    | { v: number }
    | { f: number; t: number; d: boolean; m: string; l: GbdtNode; r: GbdtNode };

export interface GbdtArtifact {
    format: 'chungus-gbdt-v1';
    gameVersion: number;
    featureSpecHash: string;
    featureNames: string[];
    objective: string;
    trainedAt: string;
    note?: string;
    trees: GbdtNode[];
}

/** LightGBM's routing rule for a numerical split, including its missing-value handling: a NaN
 *  (or, with missing_type "Zero", a zero) goes to the side the model learned for missing data. */
function goesLeft(node: { t: number; d: boolean; m: string }, x: number): boolean {
    if (Number.isNaN(x)) {
        if (node.m === 'NaN') return node.d;
        x = 0;
    }
    if (node.m === 'Zero' && x === 0) return node.d;
    return x <= node.t;
}

function leafValue(node: GbdtNode, features: ArrayLike<number>): number {
    let n = node;
    while (!('v' in n)) n = goesLeft(n, features[n.f]) ? n.l : n.r;
    return n.v;
}

export function rawScore(model: GbdtArtifact, features: ArrayLike<number>): number {
    let sum = 0;
    for (const tree of model.trees) sum += leafValue(tree, features);
    return sum;
}

export function predictProbability(model: GbdtArtifact, features: ArrayLike<number>): number {
    return 1 / (1 + Math.exp(-rawScore(model, features)));
}
