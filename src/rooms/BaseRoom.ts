import { Room, type RoomException, type RoomMethodName } from '@colyseus/core';

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
 */
export abstract class BaseRoom extends Room {
    onUncaughtException(err: RoomException, methodName: RoomMethodName): void {
        console.error(`[${this.constructor.name}] Uncaught exception in ${methodName} (roomId=${this.roomId}):`, err);
    }
}
