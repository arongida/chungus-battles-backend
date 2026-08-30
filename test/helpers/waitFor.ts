/** Polls `predicate` until it returns (or resolves to) true, instead of a fixed `setTimeout`
 *  sleep. Returns as soon as the condition is met (usually a handful of milliseconds after a
 *  `client.send`, not a flat 100-250ms guess), and — unlike a fixed sleep — fails loudly with a
 *  clear message if the condition never becomes true, instead of silently asserting against
 *  stale state. `predicate` may be async (e.g. a DB read); each iteration awaits it. */
export async function waitFor(
    predicate: () => boolean | Promise<boolean>,
    opts: { timeout?: number; interval?: number; message?: string } = {}
): Promise<void> {
    const { timeout = 5000, interval = 20, message = 'condition to become true' } = opts;
    const start = Date.now();
    while (!(await predicate())) {
        if (Date.now() - start > timeout) {
            throw new Error(`waitFor: timed out after ${timeout}ms waiting for ${message}`);
        }
        await new Promise<void>(r => setTimeout(r, interval));
    }
}
