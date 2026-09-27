import { startKeepAwake } from '../src/common/keepAwake';

describe('startKeepAwake', () => {
    const originalFetch = global.fetch;
    afterEach(() => {
        delete process.env.FLY_APP_NAME;
        global.fetch = originalFetch;
        jest.useRealTimers();
    });

    it('is a no-op off fly.io', () => {
        const fetchMock = jest.fn();
        global.fetch = fetchMock as any;
        jest.useFakeTimers();
        const release = startKeepAwake('test');
        jest.advanceTimersByTime(120_000);
        release();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('pings the app\'s own public /health every 30s until released', () => {
        process.env.FLY_APP_NAME = 'chungus-test';
        const fetchMock = jest.fn().mockResolvedValue({ ok: true });
        global.fetch = fetchMock as any;
        jest.useFakeTimers();
        const release = startKeepAwake('test');
        jest.advanceTimersByTime(90_000);
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(fetchMock.mock.calls[0][0]).toBe('https://chungus-test.fly.dev/health');
        release();
        jest.advanceTimersByTime(120_000);
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });
});
