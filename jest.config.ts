export default {
    testEnvironment: 'node',
    testTimeout: 120000,
    // room.test.ts and tournament.test.ts each call @colyseus/testing's boot(server), which
    // defaults to the same hardcoded port (2568) when no explicit port is passed. Jest's default
    // parallel workers run separate test FILES in separate processes, so both suites can try to
    // bind :2568 at once — a real, non-flaky EADDRINUSE race (not a resource-contention timeout)
    // that only shows up when they land in different workers, which local `--runInBand` runs
    // never exercise. Forcing a single worker here makes `npm test` safe under its default
    // invocation (plain `jest`, as CI runs it) without every test file having to coordinate
    // unique ports by hand.
    maxWorkers: 1,
    transform: {
      '^.+\\.ts$': 'ts-jest',
      '^.+\\.mjs$': 'babel-jest',
    },
    moduleFileExtensions: ['ts', 'js', 'mjs', 'json'],
    transformIgnorePatterns: [
      '/node_modules/(?!(rou3)/)',
    ],
  };