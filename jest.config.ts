export default {
    preset: 'ts-jest',
    testEnvironment: 'node',
    testTimeout: 120000,
    transform: {
      '^.+\\.ts$': 'ts-jest',
      '^.+\\.mjs$': 'babel-jest',
    },
    moduleFileExtensions: ['ts', 'js', 'mjs', 'json'],
    transformIgnorePatterns: [
      '/node_modules/(?!(rou3)/)',
    ],
  };