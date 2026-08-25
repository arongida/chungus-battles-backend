import { matchMaker } from '@colyseus/core';
import { randomUUID } from 'crypto';
import { TournamentFightRoom, HeadlessFightOutcome } from './TournamentFightRoom';
import { getPlayer, getWallOfFame, snapshotPlayer } from '../players/db/Player';
import { deleteReplayById, saveReplay } from '../replay/db/Replay';
import { FightSideStats, FightStatsMessage } from '../common/MessageTypes';
import {
    createTournamentDoc,
    getTournamentBySeason,
    markTournamentFailed,
    saveTournamentProgress,
    TournamentGameResult,
    TournamentMatch,
    TournamentPairing,
    TournamentRosterEntry,
    TournamentStandingRow,
} from './db/Tournament';

// How many fights each character should end up playing across the whole gauntlet — the number of
// games per pairing is derived from this and the roster size (see computeGamesPerPairing), not
// hardcoded, so a small season (few winners) still gets a meaningful sample and a big one doesn't
// explode the fight count.
const TARGET_FIGHTS_PER_CHARACTER = 60;
const MIN_GAMES_PER_PAIRING = 2;
const MAX_GAMES_PER_PAIRING = 20;
const PLAYOFF_BEST_OF = 5;
// Hard cap on games played in a single playoff match — only reachable if repeated draws keep a
// best-of-5 from resolving normally; see runMatch's decider-game comment.
const PLAYOFF_GAME_CAP = 8;
// Capped at 8x and one room at a time: fly.io runs this on a single 1-shared-CPU/1GB machine
// (fly.toml), and FightRoom's tick derives deltaTime from wall-clock elapsed time × this scale —
// an overloaded event loop would produce oversized deltas and coarser combat resolution, i.e.
// fights that no longer match live fidelity. See the plan's "Headless fights" section.
const DEFAULT_TIME_SCALE = 8;

// Only one tournament run per season per process at a time — guards against a duplicate
// POST /admin/tournament firing a second run while the first is still going.
const runningSeasons = new Set<number>();

export function isTournamentRunning(season: number): boolean {
    return runningSeasons.has(season);
}

// ---------------------------------------------------------------------------------------------
// Pure helpers — exported for unit testing (see plan's Verification §1).
// ---------------------------------------------------------------------------------------------

/** K = clamp(evenize(ceil(target / (n-1))), MIN, MAX). Even so gauntlet sides split exactly
 *  50/50 per pairing. Returns 0 for n < 2 (no pairings possible). */
export function computeGamesPerPairing(n: number, target = TARGET_FIGHTS_PER_CHARACTER): number {
    if (n < 2) return 0;
    const raw = Math.ceil(target / (n - 1));
    const even = raw % 2 === 0 ? raw : raw + 1;
    return Math.min(MAX_GAMES_PER_PAIRING, Math.max(MIN_GAMES_PER_PAIRING, even));
}

function estimatePlayoffGames(n: number, bestOf = PLAYOFF_BEST_OF): number {
    if (n < 2) return 0;
    const matches = n === 2 ? 1 : n === 3 ? 2 : 3;
    return matches * bestOf;
}

/** Gauntlet games alternate sides evenly across an even gamesPerPairing: A occupies state.player
 *  on even game indices, state.enemy on odd ones — an exact 50/50 split, the fair baseline the
 *  playoff's decider-game rule (see sideForPlayoffGame) deliberately departs from. */
export function sideForGauntletGame(gameIndex: number): boolean {
    return gameIndex % 2 === 0;
}

/** Games 1-4 (index 0-3) of a playoff match alternate sides evenly, same as the gauntlet. From
 *  game 5 on (index >= 4 — reached only if draws pushed the match past 4 decisive-or-not games),
 *  `a` (always the higher/better seed — see runPlayoffStage's seed-ordering swap) takes the
 *  `enemy` slot. That slot carries a small structural edge: FightRoom's patched clock walks the
 *  Delayed timer list in reverse, and startBattle() registers the player's attack timers before
 *  the enemy's, so on a same-tick simultaneous resolution the enemy side resolves first. Handing
 *  that edge to the higher seed on the match's true decider is the reward the gauntlet standing
 *  is supposed to buy — not a coin flip. */
export function sideForPlayoffGame(gameIndex: number): boolean {
    return gameIndex < 4 ? gameIndex % 2 === 0 : false;
}

function translateResult(result: 'win' | 'lose' | 'draw', aIsPlayer: boolean): 'win' | 'lose' | 'draw' {
    if (result === 'draw') return 'draw';
    if (aIsPlayer) return result;
    return result === 'win' ? 'lose' : 'win';
}

function sumDamage(side: FightSideStats): number {
    return side.damageDealt.weapon + side.damageDealt.skill + side.damageDealt.burn + side.damageDealt.poison;
}

function computeDamageForA(stats: FightStatsMessage | null, aIsPlayer: boolean): { aDamageDealt: number; aDamageTaken: number } {
    if (!stats) return { aDamageDealt: 0, aDamageTaken: 0 };
    const aSide = aIsPlayer ? stats.player : stats.enemy;
    const bSide = aIsPlayer ? stats.enemy : stats.player;
    return { aDamageDealt: sumDamage(aSide), aDamageTaken: sumDamage(bSide) };
}

/** Winner's remaining HP as a fraction of their max HP — the "how close was this fight" metric
 *  used to pick each gauntlet pairing's showcase replay. A draw (both sides hit 0 simultaneously)
 *  is definitionally the closest possible finish, so it's scored 0 — beating any decisive game
 *  whose winner survived with hp > 0. */
function computeWinnerHpFraction(outcome: HeadlessFightOutcome): number {
    if (outcome.result === 'draw') return 0;
    const winnerHp = outcome.result === 'win' ? outcome.playerFinalHp : outcome.enemyFinalHp;
    const winnerMaxHp = outcome.result === 'win' ? outcome.playerMaxHp : outcome.enemyMaxHp;
    return winnerMaxHp > 0 ? Math.max(0, winnerHp) / winnerMaxHp : 0;
}

interface StandingAccumulator extends TournamentStandingRow {
    totalDurationMs: number;
}

/** Rebuilds gauntlet standings purely from the roster and the persisted pairings — no re-running
 *  fights needed, which is what makes this both unit-testable and resume-safe. Ranked on fight
 *  win-rate (wins + 0.5*draws)/fights, not match wins — see the plan's "why this format" section
 *  for why a long mirrored round-robin scored this way is the fair measure of "strongest", not
 *  round-count-limited match wins.
 *
 *  Tiebreakers: head-to-head record → (damage dealt − damage taken) → lower avg fight duration →
 *  lower originalPlayerId. Head-to-head is only applied between an isolated pair of tied rows —
 *  with 3+ mutually-tied rows a strict head-to-head resolution can be non-transitive (circular
 *  records: A beat B, B beat C, C beat A), so larger tied groups skip straight to the damage
 *  tiebreaker rather than risk an unstable sort. */
export function buildStandings(
    roster: { originalPlayerId: number; name: string; avatarUrl?: string }[],
    pairings: TournamentPairing[]
): TournamentStandingRow[] {
    const rows = new Map<number, StandingAccumulator>();
    for (const r of roster) {
        rows.set(r.originalPlayerId, {
            originalPlayerId: r.originalPlayerId,
            name: r.name,
            avatarUrl: r.avatarUrl,
            seed: 0,
            fights: 0,
            wins: 0,
            losses: 0,
            draws: 0,
            winRate: 0,
            damageDealt: 0,
            damageTaken: 0,
            avgDurationMs: 0,
            totalDurationMs: 0,
        });
    }

    for (const pairing of pairings) {
        const a = rows.get(pairing.aId);
        const b = rows.get(pairing.bId);
        if (!a || !b) continue;
        for (const g of pairing.games) {
            a.fights++;
            b.fights++;
            a.damageDealt += g.aDamageDealt;
            a.damageTaken += g.aDamageTaken;
            b.damageDealt += g.aDamageTaken;
            b.damageTaken += g.aDamageDealt;
            a.totalDurationMs += g.durationMs;
            b.totalDurationMs += g.durationMs;
            if (g.result === 'win') { a.wins++; b.losses++; }
            else if (g.result === 'lose') { a.losses++; b.wins++; }
            else { a.draws++; b.draws++; }
        }
    }

    const list = Array.from(rows.values()).map(r => ({
        ...r,
        winRate: r.fights ? (r.wins + 0.5 * r.draws) / r.fights : 0,
        avgDurationMs: r.fights ? Math.round(r.totalDurationMs / r.fights) : 0,
    }));

    const headToHead = (x: StandingAccumulator, y: StandingAccumulator): number | null => {
        const pairing = pairings.find(
            p => (p.aId === x.originalPlayerId && p.bId === y.originalPlayerId) || (p.aId === y.originalPlayerId && p.bId === x.originalPlayerId)
        );
        if (!pairing) return null;
        const xIsA = pairing.aId === x.originalPlayerId;
        const xWins = xIsA ? pairing.aWins : pairing.bWins;
        const yWins = xIsA ? pairing.bWins : pairing.aWins;
        return xWins - yWins;
    };

    list.sort((x, y) => {
        if (y.winRate !== x.winRate) return y.winRate - x.winRate;
        const tiedGroupSize = list.filter(r => r.winRate === x.winRate).length;
        if (tiedGroupSize === 2) {
            const h2h = headToHead(x, y);
            if (h2h !== null && h2h !== 0) return -h2h;
        }
        const diffX = x.damageDealt - x.damageTaken;
        const diffY = y.damageDealt - y.damageTaken;
        if (diffY !== diffX) return diffY - diffX;
        if (x.avgDurationMs !== y.avgDurationMs) return x.avgDurationMs - y.avgDurationMs;
        return x.originalPlayerId - y.originalPlayerId;
    });

    return list.map((r, i) => {
        const { totalDurationMs, ...row } = r;
        return { ...row, seed: i + 1 };
    });
}

// ---------------------------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------------------------

async function buildRoster(season: number): Promise<TournamentRosterEntry[]> {
    // Exactly this season's 12-win characters — same filter/dedup getWallOfFame uses (one doc
    // per originalPlayerId, preferring fewest losses), just unpaginated.
    const { players } = await getWallOfFame({ season, limit: 1000 });
    const entries: TournamentRosterEntry[] = [];
    for (const p of players) {
        const player = await getPlayer(p.playerId);
        if (!player) continue; // defensive: doc could vanish between the two reads
        entries.push({
            playerId: player.playerId,
            originalPlayerId: player.originalPlayerId,
            name: player.name,
            avatarUrl: player.avatarUrl,
            snapshot: snapshotPlayer(player),
        });
    }
    // Stable, deterministic order independent of getWallOfFame's own (runsEnded/recency) sort —
    // pairing enumeration below walks this array by index, and that enumeration must stay
    // identical across a resumed run.
    entries.sort((a, b) => a.name.localeCompare(b.name) || a.originalPlayerId - b.originalPlayerId);
    return entries;
}

async function createHeadlessRoom(): Promise<TournamentFightRoom> {
    const listing = await matchMaker.createRoom('tournament_fight', {});
    const room = matchMaker.getLocalRoomById(listing.roomId) as unknown as TournamentFightRoom;
    await room.initialize();
    return room;
}

async function runGauntletStage(season: number, room: TournamentFightRoom, doc: Record<string, any>): Promise<void> {
    const roster: TournamentRosterEntry[] = doc.roster;
    const n = roster.length;
    const gamesPerPairing: number = doc.config.gamesPerPairing;
    const pairIndexes: [number, number][] = [];
    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) pairIndexes.push([i, j]);
    }

    for (let idx = 0; idx < pairIndexes.length; idx++) {
        const [ai, bi] = pairIndexes[idx];
        const a = roster[ai];
        const b = roster[bi];

        let pairing: TournamentPairing = doc.gauntlet.pairings[idx] ?? {
            aId: a.originalPlayerId,
            bId: b.originalPlayerId,
            aWins: 0,
            bWins: 0,
            draws: 0,
            games: [],
        };

        // Resuming a partially-played pairing: re-derive the current showcase bar purely from
        // the persisted per-game summaries (winnerHpFraction), so a crash mid-pairing doesn't
        // lose track of which already-played game was the closest finish.
        let bestFraction = Infinity;
        for (const g of pairing.games) {
            const frac = g.result === 'draw' ? 0 : g.winnerHpFraction ?? Infinity;
            if (frac < bestFraction) bestFraction = frac;
        }

        for (let gi = pairing.games.length; gi < gamesPerPairing; gi++) {
            const aIsPlayer = sideForGauntletGame(gi);
            const outcome = await room.runFight(
                aIsPlayer ? a.snapshot : b.snapshot,
                aIsPlayer ? b.snapshot : a.snapshot,
                doc.config.timeScale
            );

            const resultForA = translateResult(outcome.result, aIsPlayer);
            if (resultForA === 'win') pairing.aWins++;
            else if (resultForA === 'lose') pairing.bWins++;
            else pairing.draws++;

            const { aDamageDealt, aDamageTaken } = computeDamageForA(outcome.stats, aIsPlayer);
            const winnerHpFraction = computeWinnerHpFraction(outcome);
            const closenessFraction = resultForA === 'draw' ? 0 : winnerHpFraction;

            const game: TournamentGameResult = {
                gameIndex: gi,
                aIsPlayer,
                result: resultForA,
                durationMs: outcome.durationMs,
                winnerHpFraction,
                aDamageDealt,
                aDamageTaken,
            };

            // Exactly one showcase replay survives per pairing — see the plan's storage section.
            if (outcome.replay && closenessFraction < bestFraction) {
                if (pairing.showcaseReplayId) await deleteReplayById(pairing.showcaseReplayId);
                const replayId = randomUUID();
                await saveReplay({
                    replayId,
                    originalPlayerId: a.originalPlayerId,
                    playerId: a.playerId,
                    round: 0,
                    playerName: a.name,
                    enemyName: b.name,
                    result: resultForA,
                    gameVersion: season,
                    durationMs: outcome.durationMs,
                    initialState: outcome.replay.initialState,
                    events: outcome.replay.events,
                    truncated: outcome.replay.truncated,
                    stats: outcome.stats ?? undefined,
                    kind: 'tournament',
                    tournamentId: doc.tournamentId,
                    stage: 'gauntlet',
                    matchId: `${a.originalPlayerId}-${b.originalPlayerId}`,
                    gameIndex: gi,
                });
                game.replayId = replayId;
                pairing.showcaseReplayId = replayId;
                bestFraction = closenessFraction;
            }

            pairing.games.push(game);
            doc.gauntlet.pairings[idx] = pairing;
            doc.progress.fightsDone++;
            await saveTournamentProgress(season, {
                [`gauntlet.pairings.${idx}`]: pairing,
                'progress.fightsDone': doc.progress.fightsDone,
            });
        }
    }

    const table = buildStandings(roster, doc.gauntlet.pairings);
    doc.gauntlet.table = table;
    doc.progress.stage = 'playoff';
    await saveTournamentProgress(season, { 'gauntlet.table': table, 'progress.stage': 'playoff' });
}

async function runMatch(
    room: TournamentFightRoom,
    doc: Record<string, any>,
    match: TournamentMatch,
    aEntry: TournamentRosterEntry,
    bEntry: TournamentRosterEntry,
    matchIndex: number
): Promise<void> {
    const needed = Math.ceil(PLAYOFF_BEST_OF / 2);

    while (match.aWins < needed && match.bWins < needed && match.games.length < PLAYOFF_GAME_CAP) {
        const gi = match.games.length;
        const aIsPlayer = sideForPlayoffGame(gi);

        const outcome = await room.runFight(
            aIsPlayer ? aEntry.snapshot : bEntry.snapshot,
            aIsPlayer ? bEntry.snapshot : aEntry.snapshot,
            doc.config.timeScale
        );

        const resultForA = translateResult(outcome.result, aIsPlayer);
        if (resultForA === 'win') match.aWins++;
        else if (resultForA === 'lose') match.bWins++;
        // A draw counts toward the game cap but neither side's win tally.

        const { aDamageDealt, aDamageTaken } = computeDamageForA(outcome.stats, aIsPlayer);
        const winnerHpFraction = computeWinnerHpFraction(outcome);

        // Every playoff game keeps its replay — this is the part worth watching.
        let replayId: string | undefined;
        if (outcome.replay) {
            replayId = randomUUID();
            await saveReplay({
                replayId,
                originalPlayerId: aEntry.originalPlayerId,
                playerId: aEntry.playerId,
                round: 0,
                playerName: aEntry.name,
                enemyName: bEntry.name,
                result: resultForA,
                gameVersion: doc.season,
                durationMs: outcome.durationMs,
                initialState: outcome.replay.initialState,
                events: outcome.replay.events,
                truncated: outcome.replay.truncated,
                stats: outcome.stats ?? undefined,
                kind: 'tournament',
                tournamentId: doc.tournamentId,
                stage: match.stage,
                matchId: match.matchId,
                gameIndex: gi,
            });
        }

        match.games.push({ gameIndex: gi, aIsPlayer, result: resultForA, durationMs: outcome.durationMs, winnerHpFraction, aDamageDealt, aDamageTaken, replayId });
        doc.progress.fightsDone++;
        await saveTournamentProgress(doc.season, {
            [`playoff.matches.${matchIndex}`]: match,
            'progress.fightsDone': doc.progress.fightsDone,
        });
    }
    // If the game cap is hit still tied (repeated draws), aWins is left <= bWins only if b
    // actually pulled ahead; a genuine tie at the cap resolves to `a` (the higher seed) in
    // runPlayoffStage's winner check (`match.aWins >= match.bWins`).
}

async function runPlayoffStage(room: TournamentFightRoom, doc: Record<string, any>): Promise<void> {
    const standings: TournamentStandingRow[] = doc.gauntlet.table;
    const top = standings.slice(0, Math.min(4, standings.length));

    if (top.length < 2) {
        await saveTournamentProgress(doc.season, { status: 'complete', completedAt: new Date(), 'progress.stage': 'done' });
        return;
    }

    const findEntry = (id: number): TournamentRosterEntry => doc.roster.find((r: TournamentRosterEntry) => r.originalPlayerId === id);

    async function playMatch(matchIndex: number, stage: 'SF1' | 'SF2' | 'FIN', rowA: TournamentStandingRow, rowB: TournamentStandingRow): Promise<TournamentStandingRow> {
        // `a` is always the better (numerically lower) seed — sideForPlayoffGame's decider rule
        // depends on this.
        const [better, worse] = rowB.seed < rowA.seed ? [rowB, rowA] : [rowA, rowB];
        let match: TournamentMatch = doc.playoff.matches[matchIndex] ?? {
            matchId: `${doc.season}-${stage}`,
            stage,
            aId: better.originalPlayerId,
            bId: worse.originalPlayerId,
            aWins: 0,
            bWins: 0,
            games: [],
        };
        await runMatch(room, doc, match, findEntry(match.aId), findEntry(match.bId), matchIndex);
        match.winnerId = match.aWins >= match.bWins ? match.aId : match.bId;
        doc.playoff.matches[matchIndex] = match;
        await saveTournamentProgress(doc.season, { [`playoff.matches.${matchIndex}`]: match });
        return match.winnerId === better.originalPlayerId ? better : worse;
    }

    let championRow: TournamentStandingRow;
    let runnerUpRow: TournamentStandingRow;

    if (top.length === 2) {
        const winner = await playMatch(0, 'FIN', top[0], top[1]);
        championRow = winner;
        runnerUpRow = winner === top[0] ? top[1] : top[0];
    } else if (top.length === 3) {
        const sf2Winner = await playMatch(0, 'SF2', top[1], top[2]);
        const finWinner = await playMatch(1, 'FIN', top[0], sf2Winner);
        championRow = finWinner;
        runnerUpRow = finWinner === top[0] ? sf2Winner : top[0];
    } else {
        const sf1Winner = await playMatch(0, 'SF1', top[0], top[3]);
        const sf2Winner = await playMatch(1, 'SF2', top[1], top[2]);
        const finWinner = await playMatch(2, 'FIN', sf1Winner, sf2Winner);
        championRow = finWinner;
        runnerUpRow = finWinner === sf1Winner ? sf2Winner : sf1Winner;
    }

    await saveTournamentProgress(doc.season, {
        championId: championRow.originalPlayerId,
        championName: championRow.name,
        championAvatarUrl: championRow.avatarUrl,
        runnerUpId: runnerUpRow.originalPlayerId,
        status: 'complete',
        completedAt: new Date(),
        'progress.stage': 'done',
    });
}

export interface RunTournamentResult {
    tournamentId: string;
    status: 'complete' | 'skipped';
}

export interface PreparedTournament {
    tournamentId: string;
    status: 'running' | 'skipped' | 'complete';
}

/**
 * The fast, synchronous half of starting a tournament: resolves the existing-tournament /
 * force-restart question, builds the roster (a handful of DB round trips — at most ~13
 * characters), and creates or reuses the tournament doc. No fight simulation happens here, so an
 * HTTP handler can await this directly and hand the caller a real `tournamentId` before returning
 * 202 — see app.config.ts's `POST /admin/tournament`. The actual fight simulation is
 * `executeTournament`, meant to be run in the background afterward.
 */
export async function prepareTournament(season: number, opts: { force?: boolean } = {}): Promise<PreparedTournament> {
    if (runningSeasons.has(season)) {
        throw new Error(`A tournament run for season ${season} is already in progress in this process.`);
    }

    const existing = await getTournamentBySeason(season);
    if (existing?.status === 'complete' && !opts.force) {
        throw new Error(`Season ${season}'s tournament is already complete. Pass force to re-run it from scratch.`);
    }

    // A 'running' doc (the process died mid-run) or a 'failed' one (the last attempt threw) both
    // resume from their persisted progress rather than restarting — executeTournament re-derives
    // its resume point from what's already saved. Only `force` discards it and starts over.
    if (existing && !opts.force) {
        return { tournamentId: existing.tournamentId, status: existing.status === 'skipped' ? 'skipped' : 'running' };
    }

    const roster = await buildRoster(season);
    const tournamentId = randomUUID();

    if (roster.length < 2) {
        await createTournamentDoc({
            tournamentId,
            season,
            config: { gamesPerPairing: 0, targetFightsPerCharacter: TARGET_FIGHTS_PER_CHARACTER, playoffBestOf: PLAYOFF_BEST_OF, timeScale: DEFAULT_TIME_SCALE },
            roster,
            fightsTotal: 0,
        });
        await saveTournamentProgress(season, { status: 'skipped', completedAt: new Date() });
        return { tournamentId, status: 'skipped' };
    }

    const gamesPerPairing = computeGamesPerPairing(roster.length);
    const pairCount = (roster.length * (roster.length - 1)) / 2;
    const fightsTotal = pairCount * gamesPerPairing + estimatePlayoffGames(roster.length);
    await createTournamentDoc({
        tournamentId,
        season,
        config: { gamesPerPairing, targetFightsPerCharacter: TARGET_FIGHTS_PER_CHARACTER, playoffBestOf: PLAYOFF_BEST_OF, timeScale: DEFAULT_TIME_SCALE },
        roster,
        fightsTotal,
    });
    return { tournamentId, status: 'running' };
}

/**
 * Runs the fight simulation for a tournament whose doc `prepareTournament` has already created
 * (status 'running') — the slow half, meant to run in the background. Safe to call again after a
 * crash: every stage persists after each game (gauntlet) or match (playoff), and re-entering
 * re-derives its resume point purely from what's already saved, no separate cursor needed.
 */
export async function executeTournament(season: number): Promise<RunTournamentResult> {
    if (runningSeasons.has(season)) {
        throw new Error(`A tournament run for season ${season} is already in progress in this process.`);
    }

    runningSeasons.add(season);
    try {
        let doc = await getTournamentBySeason(season);
        if (!doc) throw new Error(`No tournament doc for season ${season} — call prepareTournament first.`);
        if (doc.status === 'skipped' || doc.status === 'complete' || doc.roster.length < 2) {
            return { tournamentId: doc.tournamentId, status: doc.status === 'complete' ? 'complete' : 'skipped' };
        }
        if (doc.status === 'failed') {
            // Resuming a previously-failed attempt — clear the failure flag now that a fresh
            // attempt is actually underway; runGauntletStage/runPlayoffStage below re-derive
            // exactly where to continue from the persisted progress.
            await saveTournamentProgress(season, { status: 'running' }, ['error']);
            doc.status = 'running';
        }

        const room = await createHeadlessRoom();
        try {
            if (doc.progress.stage === 'gauntlet') {
                await runGauntletStage(season, room, doc);
                doc = await getTournamentBySeason(season);
            }
            if (doc!.progress.stage === 'playoff') {
                await runPlayoffStage(room, doc!);
            }
        } finally {
            room.disconnect();
        }

        return { tournamentId: doc!.tournamentId, status: 'complete' };
    } catch (err: any) {
        await markTournamentFailed(season, err?.message ?? String(err));
        throw err;
    } finally {
        runningSeasons.delete(season);
    }
}

/** Convenience wrapper for CLI/test use — prepares and immediately executes in the same call.
 *  The HTTP route (app.config.ts) calls prepareTournament and executeTournament separately so it
 *  can respond as soon as the doc exists, without waiting for the fight simulation. */
export async function runTournament(season: number, opts: { force?: boolean } = {}): Promise<RunTournamentResult> {
    const prepared = await prepareTournament(season, opts);
    if (prepared.status === 'skipped') return { tournamentId: prepared.tournamentId, status: 'skipped' };
    return executeTournament(season);
}
