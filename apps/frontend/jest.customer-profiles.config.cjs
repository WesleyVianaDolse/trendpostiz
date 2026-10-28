const base = require('./jest.instagram-automations.config.cjs');

module.exports = {
  ...base,
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/apps/frontend/src/components'],
  testMatch: [
    '**/launches/helpers/integration-groups.spec.ts',
    '**/launches/customer-account-picker.spec.tsx',
    '**/launches/customer.modal.spec.tsx',
    '**/launches/select.customer.spec.tsx',
  ],
};
