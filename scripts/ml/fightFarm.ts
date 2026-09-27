// Fight farm: manufactures labelled training data by making stored character snapshots fight each
// other headlessly, several times per matchup. READ-ONLY against the database — results go to a
// local CSV, nothing is written back.
//
//   npx tsx scripts/ml/fightFarm.ts --db prod --matchups 200 [--repeats 4] [--concurrency 4]
//        [--timeScale 8] [--gameVersion 27] [--seed 1]
//
// Why repeat each matchup: one fight is a noisy coin flip. Four fights (two with each side as the
// room's "player", which cancels the small player/enemy asymmetry) give a soft label — the share
// A won — which carries far more information per matchup than a single 0/1.
//
// Safety: this does NOT boot src/app.config.ts. That server's beforeListen clears every session
// claim, which against prod would release live players' sessions. The farm registers only the
// tournament fight room (it never touches `players`, never saves replays), and connects with
// autoIndex/autoCreate off so a read-only run can't create indexes or collections either.
import mongoose from 'mongoose';
import * as path from 'path';
import { defineRoom, defineServer, matchMaker } from 'colyseus';
import { arg, loadDbEnv, numArg, CsvWriter, ML_DATA_DIR, writeFeatureSpec } from './common';
import { TournamentFightRoom } from '../../src/tournament/TournamentFightRoom';
import { getPlayerSchemaObject, playerModel, snapshotPlayer } from '../../src/players/db/Player';
import { recalculatePlayerStats } from '../../src/common/statsUtils';
import { boardFromSnapshot } from '../../src/ml/board';
import { featurize } from '../../src/ml/features';
import { GAME_VERSION } from '../../src/common/types';
import { mulberry32 } from '../../src/bot/v2/rng';

const META = ['source', 'kind', 'round', 'gameVersion', 'createdAt', 'aOriginalPlayerId', 'bOriginalPlayerId',
    'aIsBot', 'bIsBot', 'repeats', 'winsA', 'draws', 'label'];
/** Human snapshots are drawn this many times more often than bot snapshots — the bot must learn
 *  to beat the builds real players make. */
const HUMAN_WEIGHT = 3;
/** Share of matchups that pair across adjacent rounds, so the model also sees mismatched power. */
const CROSS_ROUND_SHARE = 0.15;

interface PoolEntry { doc: Record<string, any>; weight: number }

function pickWeighted(pool: PoolEntry[], rand: () => number, exclude?: number): PoolEntry | null {
    const candidates = exclude === undefined ? pool : pool.filter((p) => p.doc.originalPlayerId !== exclude);
    const total = candidates.reduce((s, p) => s + p.weight, 0);
    if (total <= 0) return null;
    let r = rand() * total;
    for (const p of candidates) {
        r -= p.weight;
        if (r <= 0) return p;
    }
    return candidates[candidates.length - 1];
}

/** A fight-ready snapshot of `doc`, with stats recomputed against `opponentDoc` exactly as a live
 *  fight room does (the opponent's talents can debuff this side's stats). */
function fightSnapshot(doc: Record<string, any>, opponentDoc: Record<string, any>): Record<string, any> {
    const self = getPlayerSchemaObject(structuredClone(doc));
    const opponent = getPlayerSchemaObject(structuredClone(opponentDoc));
    recalculatePlayerStats(opponent);
    recalculatePlayerStats(self, opponent);
    self.hp = self.maxHp;
    return snapshotPlayer(self);
}

async function main() {
    const db = loadDbEnv();
    const gameVersion = numArg('--gameVersion', GAME_VERSION);
    const matchups = numArg('--matchups', 200);
    const repeats = Math.max(2, Math.round(numArg('--repeats', 4) / 2) * 2);
    const concurrency = numArg('--concurrency', 4);
    const timeScale = numArg('--timeScale', 8);
    const seed = numArg('--seed', Date.now() % 1e9);
    const rand = mulberry32(seed);
    const outFile = arg('--out') ?? path.join(ML_DATA_DIR, `farm-v${gameVersion}.csv`);

    await mongoose.connect(process.env.DB_CONNECTION_STRING!, { autoIndex: false, autoCreate: false });
    const docs = await playerModel.find({ gameVersion, round: { $gte: 2 } }).lean();
    const byRound = new Map<number, PoolEntry[]>();
    for (const doc of docs as Record<string, any>[]) {
        const entry = { doc, weight: doc.isBot ? 1 : HUMAN_WEIGHT };
        byRound.set(doc.round, [...(byRound.get(doc.round) ?? []), entry]);
    }
    const rounds = [...byRound.keys()].filter((r) => byRound.get(r)!.length >= 2).sort((a, b) => a - b);
    console.log(`[farm] db=${db} v${gameVersion} snapshots=${docs.length} rounds=${rounds.join(',')} seed=${seed}`);

    // Rounds are drawn in proportion to how many snapshots they hold.
    const roundPool: PoolEntry[] = rounds.map((r) => ({ doc: { round: r }, weight: byRound.get(r)!.length }));

    const farmServer = defineServer({ rooms: { farm_fight: defineRoom(TournamentFightRoom) } });
    // Its own port, so a farm can run alongside the dev server (2567) and the Jest suites (2568).
    // (@colyseus/testing's boot() ignores its port argument for a Server instance.)
    await farmServer.listen(numArg('--port', 2590));
    const out = new CsvWriter(outFile, META, true);
    writeFeatureSpec();

    let next = 0;
    let fights = 0;
    const started = Date.now();

    async function worker() {
        const listing = await matchMaker.createRoom('farm_fight', {});
        const room = matchMaker.getLocalRoomById(listing.roomId) as unknown as TournamentFightRoom;
        await room.initialize();
        while (next < matchups) {
            next++;
            const round = pickWeighted(roundPool, rand)!.doc.round as number;
            const a = pickWeighted(byRound.get(round)!, rand)!.doc;
            const bRound = rand() < CROSS_ROUND_SHARE
                ? rounds[Math.max(0, Math.min(rounds.length - 1, rounds.indexOf(round) + (rand() < 0.5 ? -1 : 1)))]
                : round;
            const b = pickWeighted(byRound.get(bRound)!, rand, a.originalPlayerId)?.doc;
            if (!b) continue;

            let winsA = 0;
            let draws = 0;
            let features: number[] | null = null;
            for (let k = 0; k < repeats; k++) {
                const aIsPlayer = k % 2 === 0;
                const [p, e] = aIsPlayer ? [a, b] : [b, a];
                const outcome = await room.runFight(fightSnapshot(p, e), fightSnapshot(e, p), timeScale);
                fights++;
                if (outcome.result === 'draw') draws++;
                else if ((outcome.result === 'win') === aIsPlayer) winsA++;
                // Features from the first A-as-player fight's own t=0 snapshot: exactly what a
                // live fight would have recorded.
                if (!features && aIsPlayer && outcome.replay?.initialState) {
                    const init = outcome.replay.initialState;
                    features = featurize(boardFromSnapshot(init.player), boardFromSnapshot(init.enemy), round);
                }
            }
            if (!features) continue;
            const decided = repeats - draws;
            out.write({
                source: 'farm', kind: 'farm', round, gameVersion, createdAt: new Date().toISOString(),
                aOriginalPlayerId: a.originalPlayerId, bOriginalPlayerId: b.originalPlayerId,
                aIsBot: a.isBot ? 1 : 0, bIsBot: b.isBot ? 1 : 0,
                repeats, winsA, draws, label: decided > 0 ? winsA / decided : 0.5,
            }, features);
            if (out.count % 25 === 0) {
                const perHour = (fights / ((Date.now() - started) / 3_600_000)).toFixed(0);
                console.log(`[farm] ${out.count}/${matchups} matchups, ${fights} fights (${perHour} fights/h)`);
            }
        }
    }

    try {
        await Promise.all(Array.from({ length: concurrency }, () => worker()));
    } finally {
        await out.close();
        await farmServer.gracefullyShutdown(false).catch(() => {});
        await mongoose.disconnect();
    }
    const minutes = ((Date.now() - started) / 60000).toFixed(1);
    console.log(`[farm] done: ${out.count} matchups, ${fights} fights in ${minutes} min -> ${outFile}`);
    process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
