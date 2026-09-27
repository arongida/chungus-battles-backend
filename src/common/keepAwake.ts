/**
 * Keeps a fly.io machine from being autostopped while in-process work runs.
 *
 * fly's proxy stops (or suspends) a machine when no HTTP traffic reaches it (`auto_stop_machines`
 * in fly.toml / fly.dev.toml). A bot batch or tournament runs entirely inside the process, so to
 * the proxy the machine looks idle and gets stopped mid-batch, losing the in-memory batch. While
 * the work runs, this requests the app's own public /health through the proxy every 30s, which
 * counts as traffic. Once the work ends, the machine autostops normally, so there's no standing cost.
 *
 * No-op off fly.io (FLY_APP_NAME is set only on fly machines).
 */
const KEEP_AWAKE_INTERVAL_MS = 30_000;

export function startKeepAwake(label: string): () => void {
    const app = process.env.FLY_APP_NAME;
    if (!app) return () => {};
    const url = `https://${app}.fly.dev/health`;
    const ping = () => fetch(url, { signal: AbortSignal.timeout(10_000) })
        .catch((err) => console.warn(`[keepAwake] ${label}: ping failed:`, err?.message ?? err));
    const timer = setInterval(ping, KEEP_AWAKE_INTERVAL_MS);
    console.log(`[keepAwake] ${label}: keeping ${app} awake`);
    return () => {
        clearInterval(timer);
        console.log(`[keepAwake] ${label}: released`);
    };
}
