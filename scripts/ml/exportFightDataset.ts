// Exports every recorded fight of one game version as a training table for the fight-outcome
// model. READ-ONLY: it never writes to the database.
//
//   npx tsx scripts/ml/exportFightDataset.ts --db prod [--gameVersion 27]
//
// Sources, deduplicated by replayId:
//   1. fightSamples — the durable per-fight record FightRoom writes (src/ml/db/FightSample.ts);
//   2. replays that still carry initialState — the backfill for fights from before (1) existed.
// Draws are dropped (too rare to learn from). One row per fight, label = 1 if side A won.
// Output: ml/data/fights-v<ver>.csv plus ml/data/feature_spec.json.
import mongoose from 'mongoose';
import * as path from 'path';
import { loadDbEnv, numArg, CsvWriter, ML_DATA_DIR, writeFeatureSpec } from './common';
import { fightSampleModel, fightSampleFromInitialState, FightSampleDoc } from '../../src/ml/db/FightSample';
import { replayModel } from '../../src/replay/db/Replay';
import { featurize } from '../../src/ml/features';
import { GAME_VERSION } from '../../src/common/types';

const META = ['source', 'replayId', 'kind', 'round', 'gameVersion', 'createdAt',
    'aOriginalPlayerId', 'bOriginalPlayerId', 'aIsBot', 'bIsBot', 'label'];

async function main() {
    const db = loadDbEnv();
    const gameVersion = numArg('--gameVersion', GAME_VERSION);
    await mongoose.connect(process.env.DB_CONNECTION_STRING!);
    const out = new CsvWriter(path.join(ML_DATA_DIR, `fights-v${gameVersion}.csv`), META);
    const seen = new Set<string>();
    const counts: Record<string, number> = { sample: 0, replay: 0, draws: 0, broken: 0 };

    const emit = (source: 'sample' | 'replay', s: FightSampleDoc) => {
        if (s.replayId) {
            if (seen.has(s.replayId)) return;
            seen.add(s.replayId);
        }
        if (s.result !== 'win' && s.result !== 'lose') { counts.draws++; return; }
        let features: number[];
        try {
            features = featurize(s.a, s.b, s.round);
        } catch (err) {
            counts.broken++;
            return;
        }
        out.write({
            source, replayId: s.replayId, kind: s.kind, round: s.round, gameVersion: s.gameVersion,
            createdAt: s.createdAt ? new Date(s.createdAt).toISOString() : '',
            aOriginalPlayerId: s.aOriginalPlayerId, bOriginalPlayerId: s.bOriginalPlayerId,
            aIsBot: s.aIsBot ? 1 : 0, bIsBot: s.bIsBot ? 1 : 0,
            label: s.result === 'win' ? 1 : 0,
        }, features);
        counts[source]++;
    };

    for await (const doc of fightSampleModel.find({ gameVersion }).lean().cursor()) {
        emit('sample', doc as unknown as FightSampleDoc);
    }
    const replays = replayModel
        .find({ gameVersion, pruned: { $ne: true }, initialState: { $exists: true } })
        .select('replayId kind result round gameVersion durationMs createdAt initialState')
        .lean()
        .cursor();
    for await (const r of replays as AsyncIterable<any>) {
        if (!r.initialState?.player || !r.initialState?.enemy) { counts.broken++; continue; }
        emit('replay', fightSampleFromInitialState(r.initialState, {
            replayId: r.replayId, kind: r.kind ?? 'run', result: r.result, durationMs: r.durationMs,
            gameVersion: r.gameVersion, round: r.round, createdAt: r.createdAt,
        }));
    }

    await out.close();
    const spec = writeFeatureSpec();
    console.log(`[export] db=${db} gameVersion=${gameVersion} rows=${out.count}`, counts);
    console.log(`[export] wrote ${path.join(ML_DATA_DIR, `fights-v${gameVersion}.csv`)} and ${spec}`);
    await mongoose.disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
