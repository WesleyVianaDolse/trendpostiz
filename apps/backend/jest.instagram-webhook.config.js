module.exports = {
  rootDir: '../..',
  testEnvironment: 'node',
  testMatch: [
    '<rootDir>/apps/backend/src/**/*.spec.ts',
    '<rootDir>/apps/orchestrator/src/**/*.spec.ts',
    '<rootDir>/libraries/nestjs-libraries/src/**/*.spec.ts',
  ],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/apps/backend/tsconfig.spec.json',
      },
    ],
  },
  moduleNameMapper: {
    '^@gitroom/backend/(.*)$': '<rootDir>/apps/backend/src/$1',
    '^@gitroom/helpers/(.*)$': '<rootDir>/libraries/helpers/src/$1',
    '^@gitroom/nestjs-libraries/(.*)$':
      '<rootDir>/libraries/nestjs-libraries/src/$1',
    '^@gitroom/orchestrator/(.*)$': '<rootDir>/apps/orchestrator/src/$1',
  },
};
