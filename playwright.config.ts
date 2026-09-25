import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'apps/web/e2e/**/*.spec.ts',
  fullyParallel: false,
  webServer: {
    command:
      'export PATH="$HOME/.local/share/pnpm:$PATH" && VITE_E2E=true pnpm --filter @schwammspiel/web build && VITE_E2E=true pnpm --filter @schwammspiel/web preview --host 127.0.0.1 --port 4173',
    port: 4173,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  use: {
    baseURL: 'http://127.0.0.1:4173',
    headless: true,
  },
});
