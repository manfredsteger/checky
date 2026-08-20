import { defineConfig } from '@playwright/test';

// E2E gegen den laufenden Docker-Stack (aus dem worker-Container heraus).
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.e2e.ts',
  timeout: 120_000,
  reporter: 'line',
  use: { headless: true },
});
