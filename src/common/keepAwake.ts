/**
 * Keeps a fly.io machine from being autostopped while in-process work runs.
 *
 * fly's proxy periodically stops (or suspends) a machine whose CURRENT load is zero — open
 * connections at the moment it checks (`auto_stop_machines` in fly.toml / fly.dev.toml). A bot
 * batch or tournament runs entirely inside the process, so the proxy sees an idle machine and
 * stops it mid-batch, losing the in-memory batch. A periodic short ping isn't enough: it is almost
 * never in flight at the moment the proxy checks. Instead, while the work runs, this keeps one
 * request to the app's own public /admin/keepalive continuously open: that route holds each request
 * for ~50s (under fly's 60s idle timeout) and this loop re-opens it immediately. Once the work
 * ends, the loop stops and the machine autostops normally, so there's no standing cost.
 *
 * No-op off fly.io (FLY_APP_NAME is set only on fly machines) or without ADMIN_SECRET.
 */
export const KEEPALIVE_HOLD_MS = 50_000;

export function startKeepAwake(label: string): () => void {
    const app = process.env.FLY_APP_NAME;
    const secret = process.env.ADMIN_SECRET;
    if (!app || !secret) return () => {};
    const url = `https://${app}.fly.dev/admin/keepalive`;
    let stopped = false;
    const controller = new AbortController();

    (async () => {
        console.log(`[keepAwake] ${label}: keeping ${app} awake`);
        while (!stopped) {
            try {
                await fetch(url, {
                    headers: { 'x-admin-secret': secret },
                    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(KEEPALIVE_HOLD_MS + 15_000)]),
                });
            } catch (err: any) {
                if (stopped) break;
                console.warn(`[keepAwake] ${label}: hold failed (${err?.message ?? err}), retrying`);
                await new Promise((r) => setTimeout(r, 2_000));
            }
        }
    })();

    return () => {
        stopped = true;
        controller.abort();
        console.log(`[keepAwake] ${label}: released`);
    };
}
