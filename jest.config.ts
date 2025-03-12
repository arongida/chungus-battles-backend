export default {
    preset: 'ts-jest', // Use ts-jest for TypeScript support
    testEnvironment: 'node', // Needed for Colyseus server tests
    testTimeout: 10000,
    transform: {
      '^.+\\.ts$': 'ts-jest', // Transform TypeScript files
    },
    moduleFileExtensions: ['ts', 'js', 'json'],
  };