import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// The server only sends/accepts emote ids; the frontend owns the display text. If the two
// catalogs drift, a battle cry or reaction renders as an empty bubble (unknown id on the client)
// or gets rejected by the server (unknown id on the backend) — with no build error either way.

const BACKEND_ROOT = path.resolve(__dirname, '..');
const FRONTEND_ROOT = path.resolve(__dirname, '../../chungus-battles-frontend');
const READER = path.resolve(__dirname, 'helpers/readEmoteCatalog.ts');
const FRONTEND_CATALOG = path.join(FRONTEND_ROOT, 'src/app/common/social/emote-catalog.ts');

const frontendAvailable = fs.existsSync(FRONTEND_CATALOG);

function readCatalog(cwd: string, file: string): Record<string, string> {
    const out = execFileSync('npx', ['tsx', READER, file], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
    return JSON.parse(out);
}

(frontendAvailable ? describe : describe.skip)('emote catalog parity (backend ↔ frontend)', () => {
    it('has the same ids with the same slots on both sides', () => {
        const backend = readCatalog(BACKEND_ROOT, path.join(BACKEND_ROOT, 'src/social/emotes.ts'));
        const frontend = readCatalog(FRONTEND_ROOT, FRONTEND_CATALOG);
        expect(frontend).toEqual(backend);
    });
});
