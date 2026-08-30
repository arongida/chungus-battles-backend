import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// Both DraftRoom and FightRoom use skipHandshake, which makes @type() field declaration
// order a silent wire contract with the frontend mirrors in
// ../chungus-battles-frontend/src/app/models/colyseus-schema/. If the two sides diverge,
// decoding produces wrong values with no exception and no build error — see the comments at
// src/rooms/schema/DraftState.ts and the frontend's PlayerSchema.ts/DraftState.ts.
//
// This test reads live decorator metadata (Symbol.metadata) from both sides rather than
// parsing source, so it keeps working across the @colyseus/schema v4 -> v5 metadata change.

const BACKEND_ROOT = path.resolve(__dirname, '..');
const FRONTEND_ROOT = path.resolve(__dirname, '../../chungus-battles-frontend');
const READER = path.resolve(__dirname, 'helpers/readSchemaFields.ts');

const frontendAvailable = fs.existsSync(FRONTEND_ROOT);

interface Pair {
    name: string;
    backendFile: string;
    backendExport: string;
    frontendFile: string;
    frontendExport: string;
}

const PAIRS: Pair[] = [
    {
        name: 'Player',
        backendFile: 'src/players/schema/PlayerSchema.ts',
        backendExport: 'Player',
        frontendFile: 'src/app/models/colyseus-schema/PlayerSchema.ts',
        frontendExport: 'Player',
    },
    {
        name: 'Item',
        backendFile: 'src/items/schema/ItemSchema.ts',
        backendExport: 'Item',
        frontendFile: 'src/app/models/colyseus-schema/ItemSchema.ts',
        frontendExport: 'default',
    },
    {
        name: 'Talent',
        backendFile: 'src/talents/schema/TalentSchema.ts',
        backendExport: 'Talent',
        frontendFile: 'src/app/models/colyseus-schema/TalentSchema.ts',
        frontendExport: 'Talent',
    },
    {
        name: 'DraftState',
        backendFile: 'src/rooms/schema/DraftState.ts',
        backendExport: 'DraftState',
        frontendFile: 'src/app/models/colyseus-schema/DraftState.ts',
        frontendExport: 'DraftState',
    },
    {
        name: 'FightState',
        backendFile: 'src/rooms/schema/FightState.ts',
        backendExport: 'FightState',
        frontendFile: 'src/app/models/colyseus-schema/FightState.ts',
        frontendExport: 'FightState',
    },
    {
        name: 'AffectedStats',
        backendFile: 'src/common/schema/AffectedStatsSchema.ts',
        backendExport: 'AffectedStats',
        frontendFile: 'src/app/models/colyseus-schema/AffectedStatsSchema.ts',
        frontendExport: 'AffectedStats',
    },
];

function readFields(cwd: string, absoluteFilePath: string, exportName: string): string[] {
    const out = execFileSync('npx', ['tsx', READER, absoluteFilePath, exportName], {
        cwd, // must run with the owning project's cwd so its tsconfig.json (experimentalDecorators) is picked up
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'inherit'],
    });
    return JSON.parse(out);
}

if (!frontendAvailable) {
    // eslint-disable-next-line no-console
    console.warn(
        `[schemaParity] Skipping — sibling frontend repo not found at ${FRONTEND_ROOT} ` +
        `(expected when only this repo is checked out, e.g. in CI).`
    );
}

(frontendAvailable ? describe : describe.skip)('Colyseus schema field parity (skipHandshake wire contract)', () => {
    for (const pair of PAIRS) {
        it(`${pair.name}: frontend field order mirrors backend exactly`, () => {
            const backendFields = readFields(
                BACKEND_ROOT,
                path.join(BACKEND_ROOT, pair.backendFile),
                pair.backendExport
            );
            const frontendFields = readFields(
                FRONTEND_ROOT,
                path.join(FRONTEND_ROOT, pair.frontendFile),
                pair.frontendExport
            );
            expect(frontendFields).toEqual(backendFields);
        });
    }
});
