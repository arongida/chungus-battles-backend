/**
 * IMPORTANT:
 * ---------
 * Do not manually edit this file if you'd like to host your server on Colyseus Cloud
 *
 * If you're self-hosting (without Colyseus Cloud), you can manually
 * instantiate a Colyseus Server as documented here:
 *
 * See: https://docs.colyseus.io/server/api/#constructor-options
 */
import { listen } from '@colyseus/tools';
import { server } from './app.config';
import mongoose from 'mongoose';

// Last-resort safety nets. Colyseus's own process.on('uncaughtException') handler
// (registerGracefulShutdown, @colyseus/core) already triggers a graceful shutdown of every
// room on an uncaught exception — that's the correct behavior for a genuinely unknown state,
// so this handler only adds visibility (there is currently no logging/monitoring at all, and
// with devMode off in production — see app.config.ts — process.exit(1) now correctly signals
// failure to fly instead of being masked as exit code 0).
//
// unhandledRejection is different: Node has no built-in room-scoped handling for it, and the
// codebase has many fire-and-forget promises outside of what Colyseus's own onUncaughtException
// wrapping can observe (dispatcher.dispatch() calls not awaited from synchronous callbacks,
// notably the trigger commands fired from clock.setInterval callbacks). Registering a handler
// here is what stops Node's default "no listener -> crash" behavior for all of them at once,
// rather than requiring every call site to be found and wrapped individually.
process.on('unhandledRejection', (reason) => {
  console.error('[UnhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[UncaughtException]', err);
});

/**
 * Connect to MongoDB
 */

mongoose.connect(process.env.DB_CONNECTION_STRING, {
  autoIndex: true,
  // No pool/timeout options were set before — the driver's defaults (maxPoolSize: 100,
  // serverSelectionTimeoutMS: 30000) are sized for a driver that might be sharing a large Atlas
  // tier's connection budget across many app instances. This is a single Node process (see
  // fly.toml — single machine, in-memory Colyseus presence, deliberately not horizontally
  // scaled) with a light per-request DB access pattern, so a smaller pool is both sufficient and
  // safer margin against a shared/free-tier Atlas cluster's own connection cap. A shorter
  // serverSelectionTimeoutMS means a DB outage surfaces as fast request failures (caught by
  // asyncHandler/onUncaughtException — see app.config.ts/BaseRoom.ts) rather than requests
  // hanging for 30s each.
  maxPoolSize: 20,
  serverSelectionTimeoutMS: 10_000,
  socketTimeoutMS: 45_000,
}).catch((err) => {
  console.error('[MongoDB] initial connection failed:', err);
  process.exit(1);
});

// Create and listen on 2567 (or PORT environment variable.)
listen(server);
