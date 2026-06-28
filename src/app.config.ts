import {defineServer, defineRoom} from "colyseus"
import {monitor} from '@colyseus/monitor';
import {playground} from '@colyseus/playground';
import cors from 'cors';

/**
 * Import your Room files
 */
import {FightRoom} from './rooms/FightRoom';
import {DraftRoom} from './rooms/DraftRoom';
import {getNextPlayerId, getPlayer, getPlayerRank, getLeaderboard, playerToPlainObject} from './players/db/Player';
import {GAME_VERSION} from './common/types';
import { getAllItems } from "./items/db/Item";
import { getItemRollPreview } from "./items/stats/itemRollPreview";
import { ItemType } from "./items/types/ItemTypes";
import { shieldDescription } from "./commands/ShopUpgradeUtils";
import { getAllTalents } from "./talents/db/Talent";
import { getReplaysByOriginalPlayer, getReplayById } from './replay/db/Replay';
import { SEASONS } from './common/seasons';

export const server = defineServer({

    devMode: true,

    rooms: {
        draft_room: defineRoom(DraftRoom),
        fight_room: defineRoom(FightRoom)
    },

    express: (app) => {

        app.use(cors());


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
            const rankForOriginalPlayerId = req.query.rankForOriginalPlayerId ? Number(req.query.rankForOriginalPlayerId) : undefined;
            const result = await getLeaderboard({ limit, skip, gameVersion: currentVersion ? GAME_VERSION : undefined, name, avatar, minRound, level, rankForOriginalPlayerId });
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
            const rank = await getPlayerRank(playerId);
            const player = await getPlayer(playerId);
            res.status(200).send({rank: rank, name: player.name, wins: player.wins, originalPlayerId: player.originalPlayerId});
        });

        app.get('/items', async (req, res)=>{
            const items = await getAllItems();
            res.status(200).send(items.map(item => ({
                ...item.toJSON(),
                // Shield descriptions are generated at roll time; the authored one is stale.
                description: item.type === ItemType.SHIELD ? shieldDescription(item.tier) : item.description,
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

        app.get('/replays', async (req, res) => {
            const originalPlayerId = Number(req.query.originalPlayerId);
            if (!originalPlayerId) return res.status(400).send({ error: 'originalPlayerId required' });
            const replays = await getReplaysByOriginalPlayer(originalPlayerId);
            res.status(200).json(replays);
        });

        app.get('/replays/:id', async (req, res) => {
            const replay = await getReplayById(req.params.id);
            if (!replay) return res.status(404).send({ error: 'Replay not found' });
            res.status(200).json(replay);
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
