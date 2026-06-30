/**
 * Jest config for the pure, platform-agnostic core (text pipeline, voice commands,
 * math, routing). These modules have no React Native imports, so they run in plain
 * Node with ts-jest — fast, and runnable on any machine (incl. CI / Windows).
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src/core', '<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
};
