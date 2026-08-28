import {defineServer, defineRoom, matchMaker} from "colyseus"
import {monitor} from '@colyseus/monitor';
import {playground} from '@colyseus/playground';
import cors from 'cors';
import express from 'express';
import mongoose from 'mongoose';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { timingSafeEqual } from 'crypto';
import type { Response, NextFunction } from 'express';

// The game's real frontend origins — GitHub Pages (production), fly.io-hosted frontend
// deployments (production and dev), and the local Angular dev server. Overridable via
// ALLOWED_ORIGINS (comma-separated) so a new origin doesn't require a code change.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS?.split(',').map(s => s.trim()).filter(Boolean))
    ?? [
        'https://arongida.github.io',
        'https://chungus-battles-frontend.fly.dev',
        'https://chungus-battles-frontend-dev.fly.dev',
        'http://localhost:4200',
    ];

// Colyseus's own router installs a raw `server.prependListener('request', ...)` (see
// @colyseus/core/src/router/index.ts) that intercepts every OPTIONS preflight — including ones
// for our own /admin/* Express routes — and answers it directly with a hardcoded
// Access-Control-Allow-Headers list, before Express's `cors()` middleware below ever runs. That
// fixed list doesn't include the custom `x-admin-secret` header the admin panel sends, so the
// browser's preflight check fails and the actual request is never sent — no amount of `cors()`
// configuration can fix this, since the raw listener already ended the response. This is the
// documented override hook (see controller.ts's own doc comment) for reflecting the requested
// headers back, matching what `cors()`'s default behavior would do if it got the chance to run.
// Reflects the requesting origin only when it's on the allowlist (same list `cors()` below uses)
// — previously reflected ANY origin unconditionally.
matchMaker.controller.getCorsHeaders = (headers: Headers) => {
    const origin = headers.get('origin');
    return {
        'Access-Control-Allow-Origin': origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
        'Access-Control-Allow-Headers': headers.get('access-control-request-headers') || 'Origin, X-Requested-With, Content-Type, Accept, Authorization',
    };
};

/**
 * Import your Room files
 */
import {FightRoom} from './rooms/FightRoom';
import {DraftRoom} from './rooms/DraftRoom';
import {getNextPlayerId, getPlayer, getPlayerRank, getLeaderboard, getWallOfFame, playerToPlainObject} from './players/db/Player';
import {generatePlayerToken, reservePlayerId} from './players/db/PlayerToken';
import {GAME_VERSION} from './common/types';
import { getAllItems } from "./items/db/Item";
import { getItemRollPreview } from "./items/stats/itemRollPreview";
import { ItemRarity } from "./items/types/ItemTypes";
import { getAllTalents } from "./talents/db/Talent";
import { getReplaysByOriginalPlayer, getReplayById, getGameStats, pruneSeasonReplays } from './replay/db/Replay';
import { SEASONS } from './common/seasons';
import { definedRarityTiers, ITEM_SKILLS } from './items/behavior/itemSkillBalance';
import { TournamentFightRoom } from './tournament/TournamentFightRoom';
import { executeTournament, isTournamentRunning, prepareTournament } from './tournament/TournamentRunner';
import { getTournamentBySeason, listTournaments } from './tournament/db/Tournament';
import type { Request } from 'express';

// Guards the /admin/* endpoints (tournament trigger, replay pruning) — set this in the fly.io
// deployment's secrets, never committed. Requests without a matching x-admin-secret header are
// rejected; if the env var itself isn't set, every request is rejected (fail closed).
function isAuthorizedAdmin(req: Request): boolean {
    const expected = process.env.ADMIN_SECRET;
    if (!expected) return false;
    const provided = String(req.header('x-admin-secret') ?? '');
    const expectedBuf = Buffer.from(expected);
    const providedBuf = Buffer.from(provided);
    if (expectedBuf.length !== providedBuf.length) return false;
    return timingSafeEqual(expectedBuf, providedBuf);
}

// Guards /colyseus (the @colyseus/monitor dashboard). That panel's own API lets a caller invoke
// ANY method on any live room with attacker-chosen arguments (matchMaker.remoteRoomCall — see
// @colyseus/monitor's /room/call route), so leaving it open is equivalent to leaving the whole
// game's server-side API open. Basic Auth (rather than the x-admin-secret header the /admin/*
// routes use) because this route is meant to be opened directly in a browser, which can't attach
// a custom header to a plain navigation — the browser's native Basic Auth prompt can.
function isAuthorizedByBasicAuth(req: Request): boolean {
    const expected = process.env.ADMIN_SECRET;
    if (!expected) return false;
    const header = req.header('authorization') ?? '';
    if (!header.startsWith('Basic ')) return false;
    let decoded: string;
    try {
        decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8');
    } catch {
        return false;
    }
    // "username:password" — the username is ignored, only the password is checked against
    // ADMIN_SECRET (same secret the /admin/* routes already use).
    const providedPassword = decoded.slice(decoded.indexOf(':') + 1);
    const expectedBuf = Buffer.from(expected);
    const providedBuf = Buffer.from(providedPassword);
    if (expectedBuf.length !== providedBuf.length) return false;
    return timingSafeEqual(expectedBuf, providedBuf);
}

function requireBasicAuth(req: Request, res: Response, next: NextFunction) {
    if (isAuthorizedByBasicAuth(req)) return next();
    res.set('WWW-Authenticate', 'Basic realm="admin"');
    res.status(401).send('Unauthorized');
}

// Clamps a client-supplied numeric query param to a safe non-negative integer, defaulting when
// absent or malformed. Several routes below (`/leaderboard`, `/wallOfFame`, `/playerBuild`,
// `/rank`) previously did a bare `Number(req.query.x)` with no NaN/negative guard — an aggregation
// pipeline stage like `{ $skip: NaN }` throws inside an async Express 4 handler, which Express 4
// does not catch, producing an unhandled rejection that (absent the process-level handlers added
// in index.ts) used to crash the entire server from a single malformed request.
function parseQueryInt(value: unknown, fallback: number): number {
    if (value === undefined) return fallback;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

// Express 4 (unlike 5) does not forward a rejected promise from an async route handler to
// next()/error middleware on its own — an unhandled rejection there is dropped, relying entirely
// on the process-level 'unhandledRejection' handler in index.ts to avoid crashing the server, and
// the caller's request just hangs with no response. Every async route below is wrapped in this so
// a thrown/rejected error reaches the error-handling middleware and gets a real HTTP response.
function asyncHandler(fn: (req: Request, res: Response) => Promise<any>) {
    return (req: Request, res: Response, next: NextFunction) => {
        fn(req, res).catch(next);
    };
}

export const server = defineServer({

    // devMode caches every live room's state to disk (JSON.stringify of the whole room) on every
    // shutdown and restores it on boot — useful for local dev restarts, but on a production
    // fly.io machine with auto_stop_machines it runs on every stop, and it changes crash exit
    // codes to 0 (masking failures from fly/monitoring). Only ever intended for local dev.
    devMode: process.env.NODE_ENV !== 'production',

    rooms: {
        draft_room: defineRoom(DraftRoom),
        fight_room: defineRoom(FightRoom),
        // Never joined by a client (maxClients = 0) — created directly via matchMaker.createRoom
        // by TournamentRunner.ts to run headless season-end tournament fights. Registered here
        // because that's what makes the room name resolvable to matchMaker.createRoom at all.
        tournament_fight: defineRoom(TournamentFightRoom),
    },

    express: (app) => {

        // fly.io's edge proxy sets X-Forwarded-For; without this, express-rate-limit (and
        // anything else keying off req.ip) sees the proxy's IP for every request, i.e. one
        // shared bucket for the entire internet instead of one per client.
        app.set('trust proxy', 1);

        app.use(helmet());

        app.use(cors({
            origin: (origin, callback) => {
                // No Origin header (curl, server-to-server, same-origin requests) — browsers
                // always send Origin on cross-origin fetches, so this only allows non-browser
                // callers, which an origin allowlist can't restrict anyway.
                if (!origin || ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
                callback(new Error('Not allowed by CORS'));
            },
        }));

        // Generous global default — this only needs to stop scripted abuse, not normal play.
        app.use(rateLimit({ windowMs: 60_000, max: 300, standardHeaders: true, legacyHeaders: false }));

        // Tighter bucket for the routes worth throttling harder: /playerid mints a new player
        // slot per call, and /admin/* guards a 64-hex-char secret that's otherwise only
        // constant-time-compared, not rate-limited, against brute force.
        const strictLimiter = rateLimit({ windowMs: 60_000, max: 20, standardHeaders: true, legacyHeaders: false });

        // Only the two /admin/* POST routes read a JSON body (season/force) — added here rather
        // than left implicit since nothing previously registered a body parser.
        app.use(express.json());


        /**
         * Bind your custom express routes here:
         * Read more: https://expressjs.com/en/starter/basic-routing.html
         */
        app.get('/playerid', strictLimiter, asyncHandler(async (req, res) => {
            const playerId = await getNextPlayerId();
            // playerToken authenticates this id for every future join (see onAuth on
            // DraftRoom/FightRoom and PlayerToken.ts) — the client must persist and resend it.
            // Reserving it here (rather than only at character-creation time) is what lets onAuth
            // reject a join for an id nobody ever actually requested from this endpoint.
            const playerToken = generatePlayerToken();
            await reservePlayerId(playerId, playerToken);
            res.status(200).send({playerId: playerId, playerToken: playerToken});
        }));

        app.get('/leaderboard', asyncHandler(async (req, res) => {
            const limit = parseQueryInt(req.query.limit, 20);
            const skip = parseQueryInt(req.query.skip, 0);
            const currentVersion = req.query.currentVersion === 'true';
            const name = req.query.name ? String(req.query.name) : undefined;
            const avatar = req.query.avatar ? String(req.query.avatar) : undefined;
            const minRound = req.query.minRound !== undefined ? parseQueryInt(req.query.minRound, 0) : undefined;
            const level = req.query.level !== undefined ? parseQueryInt(req.query.level, 0) : undefined;
            const minWins = req.query.minWins !== undefined ? parseQueryInt(req.query.minWins, 0) : undefined;
            const rankForOriginalPlayerId = req.query.rankForOriginalPlayerId !== undefined ? parseQueryInt(req.query.rankForOriginalPlayerId, 0) || undefined : undefined;
            const result = await getLeaderboard({ limit, skip, gameVersion: currentVersion ? GAME_VERSION : undefined, name, avatar, minRound, level, minWins, rankForOriginalPlayerId });
            res.status(200).json(result);
        }));

        app.get('/wallOfFame', asyncHandler(async (req, res) => {
            const limit = parseQueryInt(req.query.limit, 20);
            const skip = parseQueryInt(req.query.skip, 0);
            const season = req.query.season !== undefined ? parseQueryInt(req.query.season, 0) : undefined;
            const result = await getWallOfFame({ limit, skip, season });
            res.status(200).json(result);
        }));

        app.get('/playerBuild', asyncHandler(async (req, res) => {
            const playerId = parseQueryInt(req.query.playerId, 0);
            if (!playerId) return res.status(400).send({error: 'playerId required'});
            const player = await getPlayer(playerId);
            if (!player) return res.status(404).send({error: 'Player not found'});
            res.status(200).json(playerToPlainObject(player));
        }));

        app.get('/rank', asyncHandler(async (req, res) => {
            const playerId = parseQueryInt(req.query.playerId, 0);
            if (!playerId) return res.status(400).send({error: 'playerId required'});
            const player = await getPlayer(playerId);
            if (!player) return res.status(404).send({error: 'Player not found'});
            const rank = await getPlayerRank(playerId);
            res.status(200).send({rank: rank, name: player.name, wins: player.wins, originalPlayerId: player.originalPlayerId});
        }));

        app.get('/items', asyncHandler(async (req, res)=>{
            const items = await getAllItems();
            res.status(200).send(items.map(item => ({
                ...item.toJSON(),
                // Shields (like class items) roll their skill per-player-owned instance, not on
                // the raw DB template this endpoint reads — skillName/skillDescription are blank
                // here by design, same as an un-upgraded class item's catalog entry. The shop/draft
                // item card shows the actual (per-player, spread-coordinated) skill preview before
                // Legendary instead — see ItemSchema.futureSkill* / itemSkillRoller.refreshFutureItemSkill.
                rollPreview: getItemRollPreview(item),
            })));
        }));

        app.get('/talents', asyncHandler(async (req, res)=> {
            const talents = await getAllTalents();
            res.status(200).send(talents);
        }));

        app.get('/seasons', (_req, res) => {
            res.json({ currentSeason: GAME_VERSION, seasons: SEASONS });
        });

        // Lets fly.io's health check (see fly.toml [[http_service.checks]]) distinguish "alive"
        // from "wedged" — mongoose.connection.readyState 1 === connected. There was previously no
        // health check at all, only a TCP probe, which can't detect a hung-but-listening process.
        app.get('/health', (_req, res) => {
            const dbConnected = mongoose.connection.readyState === 1;
            res.status(dbConnected ? 200 : 503).json({ ok: dbConnected, db: mongoose.connection.readyState });
        });

        // Item skill catalog (see items/behavior/itemSkillBalance.ts). describe() is a closure
        // over the definition, not JSON-serializable, so each entry is mapped to a plain object
        // rather than sending ITEM_SKILLS directly — same reasoning as /items' rollPreview above.
        // `descriptions` only includes the rarity tiers `d.values` actually defines — LEGENDARY
        // and MYTHIC for class skills, all 5 for shield skills (see definedRarityTiers) — so a
        // class skill doesn't show 3 redundant Common/Rare/Epic lines that would all resolve to
        // its Legendary text via skillValues' fallback.
        app.get('/itemSkills', (_req, res) => {
            res.json(Object.values(ITEM_SKILLS).map(d => ({
                id: d.id,
                name: d.name,
                class: d.class,
                slots: d.slots,
                triggerTypes: d.triggerTypes,
                descriptions: definedRarityTiers(d).map(r => ({
                    rarity: r,
                    label: ItemRarity[r].charAt(0) + ItemRarity[r].slice(1).toLowerCase(),
                    text: d.describe(r),
                })),
            })));
        });

        app.get('/replays', asyncHandler(async (req, res) => {
            const originalPlayerId = Number(req.query.originalPlayerId);
            if (!originalPlayerId) return res.status(400).send({ error: 'originalPlayerId required' });
            const replays = await getReplaysByOriginalPlayer(originalPlayerId);
            res.status(200).json(replays);
        }));

        app.get('/replays/:id', asyncHandler(async (req, res) => {
            const replay = await getReplayById(req.params.id);
            if (!replay) return res.status(404).send({ error: 'Replay not found' });
            // Distinct from 404 (which the replay viewer retries — the save is fire-and-forget
            // and can lag the end_battle broadcast) — a pruned replay will never come back, so it
            // gets its own status the frontend renders as an "archived" message instead of retrying.
            if (replay.pruned) return res.status(410).send({ error: 'Replay pruned', pruned: true, playerName: replay.playerName, enemyName: replay.enemyName, result: replay.result, gameVersion: replay.gameVersion });
            res.status(200).json(replay);
        }));

        app.get('/gameStats', asyncHandler(async (req, res) => {
            const originalPlayerId = Number(req.query.originalPlayerId);
            if (!originalPlayerId || Number.isNaN(originalPlayerId)) return res.status(400).send({ error: 'originalPlayerId required' });
            const result = await getGameStats(originalPlayerId);
            res.status(200).json(result);
        }));

        // --- Season-end Hall of Fame tournament -----------------------------------------------

        app.get('/tournament', asyncHandler(async (req, res) => {
            const season = req.query.season !== undefined ? Number(req.query.season) : GAME_VERSION;
            if (Number.isNaN(season)) return res.status(400).send({ error: 'invalid season' });
            const tournament = await getTournamentBySeason(season);
            if (!tournament) return res.status(404).send({ error: 'No tournament for this season' });
            res.status(200).json(tournament);
        }));

        app.get('/tournaments', asyncHandler(async (_req, res) => {
            res.status(200).json(await listTournaments());
        }));

        // Kicks off (or resumes) a season's tournament. prepareTournament is awaited — it's just
        // a handful of DB round trips — so the response carries the real tournamentId; the fight
        // simulation itself (minutes, not milliseconds) runs after the response is sent.
        app.post('/admin/tournament', strictLimiter, asyncHandler(async (req, res) => {
            if (!isAuthorizedAdmin(req)) return res.status(401).send({ error: 'unauthorized' });
            const season = req.body?.season !== undefined ? Number(req.body.season) : GAME_VERSION;
            const force = req.body?.force === true;
            if (Number.isNaN(season)) return res.status(400).send({ error: 'invalid season' });
            if (isTournamentRunning(season)) return res.status(409).send({ error: `Tournament for season ${season} is already running.` });

            let prepared;
            try {
                prepared = await prepareTournament(season, { force });
            } catch (err: any) {
                return res.status(409).send({ error: err?.message ?? String(err) });
            }

            res.status(202).json(prepared);
            if (prepared.status === 'running') {
                executeTournament(season).catch(err => console.error(`[Tournament] season ${season} run failed:`, err));
            }
        }));

        // Separate, deliberate call from the tournament trigger — run only after that season's
        // tournament reports status 'complete' (see CLAUDE.md's season-rollover procedure).
        app.post('/admin/pruneReplays', strictLimiter, asyncHandler(async (req, res) => {
            if (!isAuthorizedAdmin(req)) return res.status(401).send({ error: 'unauthorized' });
            const season = req.body?.season !== undefined ? Number(req.body.season) : undefined;
            if (!season || Number.isNaN(season)) return res.status(400).send({ error: 'season required' });
            const result = await pruneSeasonReplays(season);
            res.status(200).json(result);
        }));

        /**
         * Use @colyseus/playground
         * (It is not recommended to expose this route in a production environment)
         */
        if (process.env.NODE_ENV !== 'production') {
            app.use('/', playground());
        }

        /**
         * Use @colyseus/monitor
         * Protected by Basic Auth (see isAuthorizedByBasicAuth above) — its API lets a caller
         * invoke arbitrary methods on any live room, so it must never be reachable without auth.
         */
        app.use('/colyseus', requireBasicAuth, monitor());

        // Catches errors forwarded by asyncHandler (see above) from every async route — without
        // that wrapper, Express 4 (unlike 5) does not route a rejected promise here on its own,
        // so this middleware would never fire and the request would just hang.
        app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
            console.error('[Express]', req.method, req.path, err);
            if (res.headersSent) return;
            res.status(500).json({ error: 'Internal server error' });
        });
    },

    beforeListen: () => {
    },
});
