import { startKeepAwake } from '../src/common/keepAwake';

describe('startKeepAwake', () => {
    const originalFetch = global.fetch;
    afterEach(() => {
        delete process.env.FLY_APP_NAME;
        delete process.env.ADMIN_SECRET;
        global.fetch = originalFetch;
    });

    it('is a no-op off fly.io', async () => {
        const fetchMock = jest.fn();
        global.fetch = fetchMock as any;
        process.env.ADMIN_SECRET = 's';
        const release = startKeepAwake('test');
        await new Promise((r) => setTimeout(r, 20));
        release();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('keeps one held request open back to back until released', async () => {
        process.env.FLY_APP_NAME = 'chungus-test';
        process.env.ADMIN_SECRET = 'secret';
        let inFlight = 0;
        let maxInFlight = 0;
        const fetchMock = jest.fn(() => {
            inFlight++;
            maxInFlight = Math.max(maxInFlight, inFlight);
            // Stand-in for the server holding the request: answer after 5ms.
            return new Promise((resolve) => setTimeout(() => { inFlight--; resolve({ ok: true }); }, 5));
        });
        global.fetch = fetchMock as any;

        const release = startKeepAwake('test');
        await new Promise((r) => setTimeout(r, 60));
        release();
        const callsAtRelease = fetchMock.mock.calls.length;
        await new Promise((r) => setTimeout(r, 40));

        expect(callsAtRelease).toBeGreaterThanOrEqual(5);           // re-opened immediately, repeatedly
        expect(maxInFlight).toBe(1);                                 // never more than one at a time
        expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(callsAtRelease + 1); // stops after release
        const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe('https://chungus-test.fly.dev/admin/keepalive');
        expect((init.headers as Record<string, string>)['x-admin-secret']).toBe('secret');
    });
});
