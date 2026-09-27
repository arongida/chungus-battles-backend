import * as path from 'path';
import * as fs from 'fs';
import { FightModel, MODELS_DIR } from '../src/bot/ml/fightModel';
import { FEATURE_SPEC_HASH } from '../src/ml/features';
import { boardFromView } from '../src/ml/board';
import { makePlayer, makeWeapon } from './helpers/botFixtures';

// Training happens in Python (ml/), inference in TypeScript. This proves the two agree: the
// fixture holds real feature rows plus LightGBM's own predictions for them, exported alongside the
// (toy, test-only) model by ml/export_model.py.
const fixtures = path.join(__dirname, 'fixtures');
const parity = require(path.join(fixtures, 'fightModelParity.json')) as { featureSpecHash: string; rows: number[][]; expected: number[] };

describe('fight model runtime', () => {
    const model = FightModel.load(path.join(fixtures, 'fightModelToy.json'));

    it('reproduces LightGBM\'s predictions exactly', () => {
        expect(parity.featureSpecHash).toBe(FEATURE_SPEC_HASH);
        parity.rows.forEach((row, i) => {
            expect(Math.abs(model.predictFeatures(row) - parity.expected[i])).toBeLessThan(1e-9);
        });
    });

    it('is symmetric: P(A beats B) + P(B beats A) = 1', () => {
        const strong = boardFromView(makePlayer({ level: 4, stats: { ...makePlayer().stats, maxHp: 900, strength: 60 }, equipped: { mainHand: makeWeapon() } }));
        const weak = boardFromView(makePlayer({ level: 1, equipped: { mainHand: makeWeapon() } }));
        const p = model.winProbability(strong, weak, 5);
        expect(p + model.winProbability(weak, strong, 5)).toBeCloseTo(1, 12);
        expect(p).toBeGreaterThan(0.5);
    });

    it('refuses a model trained on a different feature spec', () => {
        const artifact = { ...model.artifact, featureSpecHash: 'deadbeef' };
        expect(() => new FightModel(artifact)).toThrow(/feature spec/);
    });

    // Every committed real model must ship with its own parity fixture
    // (ml/export_model.py --parity ../test/fixtures/fightModelParity-v<ver>.json).
    const committed = fs.existsSync(MODELS_DIR) ? fs.readdirSync(MODELS_DIR).filter((f) => /^fight-v\d+\.json$/.test(f)) : [];
    for (const file of committed) {
        it(`committed model ${file} matches its Python parity fixture`, () => {
            const version = file.match(/\d+/)![0];
            const fixtureFile = path.join(fixtures, `fightModelParity-v${version}.json`);
            expect(fs.existsSync(fixtureFile)).toBe(true);
            const fixture = JSON.parse(fs.readFileSync(fixtureFile, 'utf8'));
            const real = FightModel.load(path.join(MODELS_DIR, file));
            fixture.rows.forEach((row: number[], i: number) => {
                expect(Math.abs(real.predictFeatures(row) - fixture.expected[i])).toBeLessThan(1e-9);
            });
        });
    }
});
