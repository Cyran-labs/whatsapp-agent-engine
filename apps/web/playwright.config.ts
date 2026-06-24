import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  use: { baseURL: 'http://localhost:3002' },
  webServer: [
    {
      command: 'npx tsx e2e/mock-engine.ts',
      port: 4999,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'npm run build && npx next start -p 3002',
      port: 3002,
      reuseExistingServer: !process.env.CI,
      env: { ENGINE_API_URL: 'http://localhost:4999/api/admin/v1' },
      timeout: 120_000,
    },
  ],
});
