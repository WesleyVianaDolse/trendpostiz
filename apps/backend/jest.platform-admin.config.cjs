const base = require('./jest.instagram-webhook.config.js');
module.exports = {
  ...base,
  testMatch: [
    '<rootDir>/libraries/nestjs-libraries/src/database/prisma/platform/*.spec.ts',
    '<rootDir>/apps/backend/src/services/auth/*platform*.spec.ts',
    '<rootDir>/apps/orchestrator/src/activities/post-access.spec.ts',
  ],
};
