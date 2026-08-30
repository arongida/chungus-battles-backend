import mongoose, { Schema } from 'mongoose';

// Generic atomic counter (the classic Mongo "auto-increment via findOneAndUpdate $inc" pattern),
// used wherever a sequential id needs to be handed out without a race between concurrent callers.
// One document per counter name.
const CounterSchema = new Schema({
    _id: String,
    seq: { type: Number, default: 0 },
});

const counterModel = mongoose.model('Counter', CounterSchema);

// Caches the "has this counter been seeded from its legacy source" check per counter name, so it
// only runs once per process lifetime rather than on every call. Concurrent first-callers within
// the same process share the same in-flight promise, since the Map write happens synchronously
// before any await.
const seededPromises = new Map<string, Promise<void>>();

/** Ensures `name`'s counter document exists, seeding it from `seedFn()` (the historical/legacy
 *  "current max" value) if this is the first time this counter has ever been used. Safe under
 *  concurrent first-callers, including across process restarts — `$setOnInsert` only takes effect
 *  on the winning insert, so a losing racer's upsert is a no-op against the document the winner
 *  created. */
async function ensureSeeded(name: string, seedFn: () => Promise<number>): Promise<void> {
    let promise = seededPromises.get(name);
    if (!promise) {
        promise = (async () => {
            const existing = await counterModel.findOne({ _id: name }).lean();
            if (existing) return;
            const seed = await seedFn();
            // A concurrent seed race (another process, or the deploy's first two requests
            // landing together) can hit a duplicate-key error here — that's fine, it just means
            // someone else's insert already won; the getNextSequence() call right after this
            // reads/increments whatever value actually exists.
            await counterModel.updateOne({ _id: name }, { $setOnInsert: { seq: seed } }, { upsert: true }).catch(() => {});
        })();
        seededPromises.set(name, promise);
    }
    return promise;
}

/** Atomically returns the next value for counter `name`, seeding it via `seedFn()` on first use.
 *  `seedFn` should return the last value already handed out by whatever pre-existing scheme this
 *  counter is replacing (0 if none), since the first returned value is `seed + 1`. */
export async function getNextSequence(name: string, seedFn: () => Promise<number>): Promise<number> {
    await ensureSeeded(name, seedFn);
    const counter = await counterModel.findOneAndUpdate(
        { _id: name },
        { $inc: { seq: 1 } },
        { returnDocument: 'after', upsert: true },
    );
    return counter.seq;
}
