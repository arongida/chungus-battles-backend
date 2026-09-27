// Rebuilds a farm CSV from its raw-boards file with the CURRENT feature code — the fast path after
// any change to src/ml/features.ts (no fights are re-run). No database access.
//
//   npx tsx scripts/ml/refeaturizeFarm.ts [--gameVersion 27]
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { CsvWriter, FARM_META, ML_DATA_DIR, numArg, writeFeatureSpec } from './common';
import { featurize } from '../../src/ml/features';
import { GAME_VERSION } from '../../src/common/types';

async function main() {
    const gameVersion = numArg('--gameVersion', GAME_VERSION);
    const boardsFile = path.join(ML_DATA_DIR, `farm-v${gameVersion}-boards.jsonl`);
    const csvFile = path.join(ML_DATA_DIR, `farm-v${gameVersion}.csv`);
    if (!fs.existsSync(boardsFile)) throw new Error(`${boardsFile} not found — farm first (scripts/ml/fightFarm.ts)`);
    const out = new CsvWriter(csvFile, FARM_META, false);
    const lines = readline.createInterface({ input: fs.createReadStream(boardsFile) });
    for await (const line of lines) {
        if (!line.trim()) continue;
        const row = JSON.parse(line);
        out.write(row, featurize(row.a, row.b, row.round));
    }
    await out.close();
    writeFeatureSpec();
    console.log(`[refeaturize] ${out.count} matchups -> ${csvFile}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
