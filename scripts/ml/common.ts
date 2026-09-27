// Shared bits for the ML scripts: pick a database from --db, and write rows as CSV.
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { FEATURE_NAMES, FEATURE_SPEC_HASH, SKILL_VOCAB, TALENT_VOCAB } from '../../src/ml/features';

export const ML_DATA_DIR = path.resolve(__dirname, '../../ml/data');

/** `--db dev` (default) reads .env.development, `--db prod` reads .env.production. The ML scripts
 *  only ever READ from the database. */
export function loadDbEnv(): 'dev' | 'prod' {
    const target = arg('--db') === 'prod' ? 'prod' : 'dev';
    dotenv.config({ path: path.resolve(__dirname, `../../.env.${target === 'prod' ? 'production' : 'development'}`), override: true });
    if (!process.env.DB_CONNECTION_STRING) throw new Error(`DB_CONNECTION_STRING missing for --db ${target}`);
    return target;
}

export function arg(name: string): string | undefined {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : undefined;
}

export function numArg(name: string, fallback: number): number {
    const v = Number(arg(name));
    return Number.isFinite(v) && arg(name) !== undefined ? v : fallback;
}

function csvCell(v: unknown): string {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return Number.isFinite(v) ? String(Math.round(v * 1e6) / 1e6) : '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Streams rows (meta columns first, then FEATURE_NAMES) into a CSV file. */
export class CsvWriter {
    private stream: fs.WriteStream;
    count = 0;

    constructor(file: string, private metaColumns: string[], append = false) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const exists = append && fs.existsSync(file) && fs.statSync(file).size > 0;
        this.stream = fs.createWriteStream(file, { flags: append ? 'a' : 'w' });
        if (!exists) this.stream.write([...metaColumns, ...FEATURE_NAMES].map(csvCell).join(',') + '\n');
    }

    write(meta: Record<string, unknown>, features: number[]): void {
        this.stream.write([...this.metaColumns.map((c) => meta[c]), ...features].map(csvCell).join(',') + '\n');
        this.count++;
    }

    close(): Promise<void> {
        return new Promise((resolve) => this.stream.end(resolve));
    }
}

/** The contract a trained model is tied to — the notebooks read it, the exporter embeds it. */
export function writeFeatureSpec(): string {
    const file = path.join(ML_DATA_DIR, 'feature_spec.json');
    fs.mkdirSync(ML_DATA_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ hash: FEATURE_SPEC_HASH, names: FEATURE_NAMES, talentVocab: TALENT_VOCAB, skillVocab: SKILL_VOCAB }, null, 2));
    return file;
}
