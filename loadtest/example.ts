// `colyseus.js` (the browser/frontend package name) isn't installed here — @colyseus/loadtest
// itself depends on @colyseus/sdk, which is the same client under the hood and is available.
import { Client, Room } from '@colyseus/sdk';
import { cli, Options } from '@colyseus/loadtest';

// Simulates one real player's draft_room session: mint a playerId+token the same way the
// frontend does (GET /playerid — see PlayerToken.ts/onAuth on DraftRoom), join with them, buy
// whatever the shop first offers if affordable, sit in the room briefly (roughly how long a
// human spends per shop phase), then leave. Run with (npm run loadtest, or directly), e.g.:
//   npx tsx loadtest/example.ts --endpoint ws://localhost:2567 --room draft_room --numClients 150
// (the installed @colyseus/loadtest's own `colyseus-loadtest <file>` CLI wrapper is deprecated/
// stubbed out in this version — run the file directly with tsx/node instead, per its own
// deprecation notice). Point --endpoint at the dev deployment
// (wss://chungus-battles-backend-dev.fly.dev) to load-test against a real machine rather than
// localhost — never point this at the production endpoint.
export async function main(options: Options) {
  const httpOrigin = options.endpoint.replace(/^ws/, 'http');

  const { playerId, playerToken } = await fetch(`${httpOrigin}/playerid`).then((res) => res.json());

  const client = new Client(options.endpoint);
  const room: Room = await client.joinOrCreate(options.roomName, {
    name: `loadtest_${playerId}`,
    playerId,
    playerToken,
    avatarUrl: 'assets/warrior_01.png',
  });

  console.log(`[client ${options.clientId}] joined draft_room as playerId=${playerId}`);

  room.onMessage('error', (message) => {
    console.warn(`[client ${options.clientId}] error:`, message);
  });

  room.onStateChange.once((state: any) => {
    const firstAvailable = state.shop?.find((item: any) => !item.sold && item.price <= state.player?.gold);
    if (firstAvailable) {
      // A little jitter before the first action, like a human reading the shop first.
      setTimeout(() => room.send('buy', { itemId: firstAvailable.itemId }), 500 + Math.random() * 1500);
    }
  });

  room.onLeave((code) => {
    console.log(`[client ${options.clientId}] left, code=${code}`);
  });

  // Roughly one shop phase's worth of dwell time, then leave — mirrors a real player moving on
  // to the fight room rather than idling in draft_room forever.
  setTimeout(() => room.leave(), 15_000 + Math.random() * 15_000);
}

cli(main);
