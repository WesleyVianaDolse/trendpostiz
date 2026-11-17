const base=require('./jest.instagram-automations.config.cjs');
module.exports={...base,testEnvironment:'<rootDir>/diagnostics/recovery/jest-dom-environment.cjs',testMatch:['<rootDir>/apps/frontend/src/components/new-launch/publication-recovery-history.spec.tsx']};
