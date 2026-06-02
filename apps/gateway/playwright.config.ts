import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      // Stub envs so server can boot in CI without real DB/secret.
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://test:test@127.0.0.1:5432/test',
      SESSION_SECRET: process.env.SESSION_SECRET ?? 'e2e-test-session-secret-32-bytes-min',
      NEXT_PUBLIC_APP_DOMAIN: 'localhost:3000',
    },
  },
});
