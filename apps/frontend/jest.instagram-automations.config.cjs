module.exports = {
  rootDir: '../..',
  testEnvironment: 'node',
  testMatch: [
    '<rootDir>/apps/frontend/src/components/instagram-automations/**/*.spec.ts',
    '<rootDir>/apps/frontend/src/components/instagram-automations/**/*.spec.tsx',
  ],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig:
          '<rootDir>/apps/frontend/tsconfig.instagram-automations.spec.json',
        diagnostics: false,
      },
    ],
  },
  moduleNameMapper: {
    '^@gitroom/frontend/(.*)$': '<rootDir>/apps/frontend/src/$1',
    '^@gitroom/helpers/(.*)$': '<rootDir>/libraries/helpers/src/$1',
    '^@gitroom/react/(.*)$':
      '<rootDir>/libraries/react-shared-libraries/src/$1',
  },
};
