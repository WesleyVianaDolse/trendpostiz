const base = require('./jest.instagram-automations.config.cjs');
module.exports = {
  ...base,
  testEnvironment: '<rootDir>/apps/frontend/test/jsdom-without-canvas.cjs',
  testMatch: [
    '<rootDir>/apps/frontend/src/components/new-launch/providers/youtube/*.spec.tsx',
    '<rootDir>/apps/frontend/src/components/publisher/youtube-settings.spec.tsx',
  ],
  moduleNameMapper: {
    ...base.moduleNameMapper,
    '^@gitroom/nestjs-libraries/(.*)$':
      '<rootDir>/libraries/nestjs-libraries/src/$1',
  },
};
