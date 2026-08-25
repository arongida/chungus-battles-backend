import { Client } from '@colyseus/core';

/**
 * A no-op stand-in for a Colyseus `Client`, used by TournamentFightRoom so the inherited
 * FightRoom combat code — which treats `state.playerClient` as a bare, non-optional `.send()`
 * target in ~116 call sites across FightRoom.ts, PlayerSchema.ts and TalentBehaviors.ts — can run
 * with no connected player.
 *
 * Deliberately NOT a full Client implementation: only `sessionId` (read for logging) and `send`
 * (called everywhere) are exercised by a fight. FightRoom.wrapPlayerClient() wraps `send` exactly
 * as it would a real client's, so the recorded replay event stream is byte-identical in shape to
 * a live fight — the existing /replay/:id viewer needs no changes to play a tournament fight.
 */
export function createHeadlessClient(sessionId = 'headless'): Client {
    const client = {
        sessionId,
        id: sessionId,
        send: (_type: string, _message?: any) => {},
        sendBytes: (_type: string, _bytes?: any) => {},
        raw: (_data: any) => {},
        error: (_code: number, _message?: string) => {},
        leave: (_code?: number, _data?: string) => {},
    };
    return client as unknown as Client;
}
