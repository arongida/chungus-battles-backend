import {defineServer, defineRoom, matchMaker} from "colyseus"
import {monitor} from '@colyseus/monitor';
import {playground} from '@colyseus/playground';
import cors from 'cors';
import express from 'express';
import { timingSafeEqual } from 'crypto';

// Colyseus's own router installs a raw `server.prependListener('request', ...)` (see
// @colyseus/core/src/router/index.ts) that intercepts every OPTIONS preflight — including ones
// for our own /admin/* Express routes — and answers it directly with a hardcoded
// Access-Control-Allow-Headers list, before Express's `cors()` middleware below ever runs. That
// fixed list doesn't include the custom `x-admin-secret` header the admin panel sends, so the
// browser's preflight check fails and the actual request is never sent — no amount of `cors()`
// configuration can fix this, since the raw listener already ended the response. This is the
// documented override hook (see controller.ts's own doc comment) for reflecting the requested
// headers back, matching what `cors()`'s default behavior would do if it got the chance to run.
matchMaker.controller.getCorsHeaders = (headers: Headers) => ({
    'Access-Control-Allow-Origin': headers.get('origin') || '*',
    'Access-Control-Allow-Headers': headers.get('access-control-request-headers') || 'Origin, X-Requested-With, Content-Type, Accept, Authorization',
});

/**
 * Import your Room files
 */
import {FightRoom} from './rooms/FightRoom';
import {DraftRoom} from './rooms/DraftRoom';
import {getNextPlayerId, getPlayer, getPlayerRank, getLeaderboard, getWallOfFame, playerToPlainObject} from './players/db/Player';
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

export const server = defineServer({

    devMode: true,

    rooms: {
        draft_room: defineRoom(DraftRoom),
        fight_room: defineRoom(FightRoom),
        // Never joined by a client (maxClients = 0) — created directly via matchMaker.createRoom
        // by TournamentRunner.ts to run headless season-end tournament fights. Registered here
        // because that's what makes the room name resolvable to matchMaker.createRoom at all.
        tournament_fight: defineRoom(TournamentFightRoom),
    },

    express: (app) => {

        app.use(cors());
        // Only the two /admin/* POST routes read a JSON body (season/force) — added here rather
        // than left implicit since nothing previously registered a body parser.
        app.use(express.json());


        /**
         * Bind your custom express routes here:
         * Read more: https://expressjs.com/en/starter/basic-routing.html
         */
        app.get('/playerid', async (req, res) => {
            const playerId = await getNextPlayerId();
            res.status(200).send({playerId: playerId});
        });

        app.get('/leaderboard', async (req, res) => {
            const limit = req.query.limit !== undefined ? Number(req.query.limit) : 20;
            const skip = req.query.skip !== undefined ? Number(req.query.skip) : 0;
            const currentVersion = req.query.currentVersion === 'true';
            const name = req.query.name ? String(req.query.name) : undefined;
            const avatar = req.query.avatar ? String(req.query.avatar) : undefined;
            const minRound = req.query.minRound !== undefined ? Number(req.query.minRound) : undefined;
            const level = req.query.level !== undefined ? Number(req.query.level) : undefined;
            const minWins = req.query.minWins !== undefined ? Number(req.query.minWins) : undefined;
            const rankForOriginalPlayerId = req.query.rankForOriginalPlayerId ? Number(req.query.rankForOriginalPlayerId) : undefined;
            const result = await getLeaderboard({ limit, skip, gameVersion: currentVersion ? GAME_VERSION : undefined, name, avatar, minRound, level, minWins, rankForOriginalPlayerId });
            res.status(200).json(result);
        });

        app.get('/wallOfFame', async (req, res) => {
            const limit = req.query.limit !== undefined ? Number(req.query.limit) : 20;
            const skip = req.query.skip !== undefined ? Number(req.query.skip) : 0;
            const season = req.query.season !== undefined ? Number(req.query.season) : undefined;
            const result = await getWallOfFame({ limit, skip, season });
            res.status(200).json(result);
        });

        app.get('/playerBuild', async (req, res) => {
            const playerId = Number(req.query.playerId);
            const player = await getPlayer(playerId);
            if (!player) return res.status(404).send({error: 'Player not found'});
            res.status(200).json(playerToPlainObject(player));
        });

        app.get('/rank', async (req, res) => {
            const playerId = Number(req.query.playerId);
            const player = await getPlayer(playerId);
            if (!player) return res.status(404).send({error: 'Player not found'});
            const rank = await getPlayerRank(playerId);
            res.status(200).send({rank: rank, name: player.name, wins: player.wins, originalPlayerId: player.originalPlayerId});
        });

        app.get('/items', async (req, res)=>{
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
        });

        app.get('/talents', async (req, res)=> {
            const talents = await getAllTalents();
            res.status(200).send(talents);
        });

        app.get('/seasons', (_req, res) => {
            res.json({ currentSeason: GAME_VERSION, seasons: SEASONS });
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

        app.get('/replays', async (req, res) => {
            const originalPlayerId = Number(req.query.originalPlayerId);
            if (!originalPlayerId) return res.status(400).send({ error: 'originalPlayerId required' });
            const replays = await getReplaysByOriginalPlayer(originalPlayerId);
            res.status(200).json(replays);
        });

        app.get('/replays/:id', async (req, res) => {
            const replay = await getReplayById(req.params.id);
            if (!replay) return res.status(404).send({ error: 'Replay not found' });
            // Distinct from 404 (which the replay viewer retries — the save is fire-and-forget
            // and can lag the end_battle broadcast) — a pruned replay will never come back, so it
            // gets its own status the frontend renders as an "archived" message instead of retrying.
            if (replay.pruned) return res.status(410).send({ error: 'Replay pruned', pruned: true, playerName: replay.playerName, enemyName: replay.enemyName, result: replay.result, gameVersion: replay.gameVersion });
            res.status(200).json(replay);
        });

        app.get('/gameStats', async (req, res) => {
            const originalPlayerId = Number(req.query.originalPlayerId);
            if (!originalPlayerId || Number.isNaN(originalPlayerId)) return res.status(400).send({ error: 'originalPlayerId required' });
            const result = await getGameStats(originalPlayerId);
            res.status(200).json(result);
        });

        // --- Season-end Hall of Fame tournament -----------------------------------------------

        app.get('/tournament', async (req, res) => {
            const season = req.query.season !== undefined ? Number(req.query.season) : GAME_VERSION;
            if (Number.isNaN(season)) return res.status(400).send({ error: 'invalid season' });
            const tournament = await getTournamentBySeason(season);
            if (!tournament) return res.status(404).send({ error: 'No tournament for this season' });
            res.status(200).json(tournament);
        });

        app.get('/tournaments', async (_req, res) => {
            res.status(200).json(await listTournaments());
        });

        // Kicks off (or resumes) a season's tournament. prepareTournament is awaited — it's just
        // a handful of DB round trips — so the response carries the real tournamentId; the fight
        // simulation itself (minutes, not milliseconds) runs after the response is sent.
        app.post('/admin/tournament', async (req, res) => {
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
        });

        // Separate, deliberate call from the tournament trigger — run only after that season's
        // tournament reports status 'complete' (see CLAUDE.md's season-rollover procedure).
        app.post('/admin/pruneReplays', async (req, res) => {
            if (!isAuthorizedAdmin(req)) return res.status(401).send({ error: 'unauthorized' });
            const season = req.body?.season !== undefined ? Number(req.body.season) : undefined;
            if (!season || Number.isNaN(season)) return res.status(400).send({ error: 'season required' });
            const result = await pruneSeasonReplays(season);
            res.status(200).json(result);
        });

        /**
         * Use @colyseus/playground
         * (It is not recommended to expose this route in a production environment)
         */
        if (process.env.NODE_ENV !== 'production') {
            app.use('/', playground());
        }

        /**
         * Use @colyseus/monitor
         * It is recommended to protect this route with a password
         * Read more: https://docs.colyseus.io/tools/monitor/#restrict-access-to-the-panel-using-a-password
         */
        app.use('/colyseus', monitor());
    },

    beforeListen: () => {
    },
});
