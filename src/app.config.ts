import config from '@colyseus/tools';
import { monitor } from '@colyseus/monitor';
import { playground } from '@colyseus/playground';
import cors from 'cors';

/**
 * Import your Room files
 */
import { FightRoom } from './rooms/FightRoom';
import { DraftRoom } from './rooms/DraftRoom';
import { getNextPlayerId } from './db/Player';

export default config({
  initializeGameServer: (gameServer) => {
    /**
     * Define your room handlers:
     */
    gameServer.define('fight_room', FightRoom);
    gameServer.define('draft_room', DraftRoom);
  },

  initializeExpress: (app) => {
    if (process.env.NODE_ENV === 'production') {
      const corsOptions = { origin: 'https://arongida.github.io' };
      app.use(cors(corsOptions));
    }

    /**
     * Bind your custom express routes here:
     * Read more: https://expressjs.com/en/starter/basic-routing.html
     */
    app.get('/playerid', async (req, res) => {
      const playerId = await getNextPlayerId();
      res.status(200).send({ playerId: playerId });
    });

    /**
     * Use @colyseus/playground
     * (It is not recommended to expose this route in a production environment)
     */
    if (process.env.NODE_ENV !== 'production') {
      app.use('/', playground);
    }

    /**
     * Use @colyseus/monitor
     * It is recommended to protect this route with a password
     * Read more: https://docs.colyseus.io/tools/monitor/#restrict-access-to-the-panel-using-a-password
     */
    app.use('/colyseus', monitor());
  },

  beforeListen: () => {},
});
