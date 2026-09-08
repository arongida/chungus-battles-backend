import { Client, Delayed, Room, type RoomException, type RoomMethodName } from '@colyseus/core';
import { SESSION_HEARTBEAT_INTERVAL_MS, releasePlayerSession, touchPlayerSession } from '../players/db/Player';

/**
 * Shared base for every game room. Colyseus only wraps room lifecycle/message/timer
 * callbacks (onJoin, onLeave, onMessage handlers, setSimulationInterval, clock.setTimeout,
 * clock.setInterval, ...) in a try/catch IF `onUncaughtException` is defined
 * (see @colyseus/core Room#registerUncaughtExceptionHandlers, guarded on
 * `this.onUncaughtException !== undefined`). Without it, any exception thrown inside those
 * callbacks becomes a process-level uncaughtException, which Colyseus's own process handler
 * (registerGracefulShutdown) responds to by shutting down every room on the machine — not
 * just the one that errored.
 *
 * Defining it here turns "one bad fight/join kills every concurrent game" into "one bad
 * fight/join logs an error and dies alone." Every room should extend this instead of `Room`
 * directly.
 *
 * Also owns the live-session claim lifecycle shared by DraftRoom/FightRoom — see
 * players/db/Player.ts's claimPlayerSession/releasePlayerSession/touchPlayerSession for why a
 * claim exists at all (it's what makes "Player already playing!" actually true) and
 * SESSION_CLAIM_TTL_MS for the staleness window that keeps a crashed room from permanently
 * locking a character out.
 */
export abstract class BaseRoom extends Room {
    /** The Colyseus sessionId that currently owns this room's character's DB session claim, or
     *  null. This — NOT `state.player.playerId` — is the authoritative "did this client actually
     *  finish joining" signal: setUpState populates playerId before a join's mutex/lives checks
     *  run, so a REJECTED join still has a populated playerId; ownsSession() correctly stays
     *  false for it since beginSession() is only ever called after a successful claim. */
    protected claimedSessionId: string | null = null;
    protected claimedPlayerId: number | null = null;
    private sessionHeartbeat?: Delayed;

    onUncaughtException(err: RoomException, methodName: RoomMethodName): void {
        console.error(`[${this.constructor.name}] Uncaught exception in ${methodName} (roomId=${this.roomId}):`, err);
    }

    /** Call immediately after claimPlayerSession(...) returns 'claimed', before any further
     *  state mutation. Starts refreshing the claim's heartbeat so a still-live room is never
     *  mistaken for an abandoned one. */
    protected beginSession(playerId: number, sessionId: string): void {
        this.claimedPlayerId = playerId;
        this.claimedSessionId = sessionId;
        // this.clock.setInterval (not global setInterval) so Colyseus clears it automatically on
        // dispose. FightRoom scales clock deltaTime by state.timeScale, so at the minimum allowed
        // 0.5x fight speed this fires every ~40s of wall time — still well inside
        // SESSION_CLAIM_TTL_MS (120s). See that constant's justification in Player.ts.
        this.sessionHeartbeat = this.clock.setInterval(() => {
            touchPlayerSession(playerId, sessionId)
                .then((stillOurs) => {
                    if (!stillOurs) {
                        console.error(`[${this.constructor.name}] LOST session claim playerId=${playerId} roomId=${this.roomId} — another connection took over; disconnecting this room`);
                        this.endSessionTracking();
                        // Actively close the connection rather than just forgetting the claim
                        // server-side and leaving the room running. Without this, the client
                        // whose claim was stolen keeps a fully-open (but doomed) connection: its
                        // messages still get processed here but can never be saved again (see
                        // updatePlayer's session guard), and — worse — its UI never learns
                        // anything is wrong, since nothing tells it the room died. Disconnecting
                        // fires this room's normal onLeave/onDispose cleanup (a no-op save, since
                        // ownsSession() is already false) AND the client's own room.onLeave
                        // handler, which is what sends that tab back to the home screen instead
                        // of leaving every button silently doing nothing.
                        this.disconnect().catch((err) => console.error(`[${this.constructor.name}] disconnect after lost claim failed`, err));
                    }
                })
                .catch((err) => console.error(`[${this.constructor.name}] session heartbeat failed`, err));
        }, SESSION_HEARTBEAT_INTERVAL_MS);
    }

    /** Stops heartbeating and forgets the claim WITHOUT releasing it in Mongo — used when the
     *  claim was taken from us (releasing here would clear the new owner's claim instead). */
    protected endSessionTracking(): void {
        this.sessionHeartbeat?.clear();
        this.sessionHeartbeat = undefined;
        this.claimedSessionId = null;
        this.claimedPlayerId = null;
    }

    /** True only for the client that actually holds this room's claim. */
    protected ownsSession(client: Client): boolean {
        return this.claimedSessionId !== null && this.claimedSessionId === client.sessionId;
    }

    /** Guarded release — safe to call unconditionally in onLeave. */
    protected async releaseSession(): Promise<void> {
        const playerId = this.claimedPlayerId;
        const sessionId = this.claimedSessionId;
        this.endSessionTracking();
        if (playerId === null || sessionId === null) return;
        await releasePlayerSession(playerId, sessionId)
            .catch((err) => console.error(`[${this.constructor.name}] releasePlayerSession failed`, err));
    }

    /** Last-ditch release on room disposal. A no-op in the normal path (onLeave already
     *  released), but matters for graceful shutdown (e.g. a fly.io deploy's SIGTERM disposes
     *  every room) — it shrinks the crash-lockout window from SESSION_CLAIM_TTL_MS to zero for
     *  anything short of a hard SIGKILL. Subclasses overriding onDispose must call
     *  `await super.onDispose()`. */
    async onDispose(): Promise<void> {
        await this.releaseSession();
    }
}
