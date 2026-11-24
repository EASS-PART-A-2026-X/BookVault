import { defineConfig, devices } from '@playwright/test';
import { API_PORT, API_URL, BACKEND_DIR, DB_FILE, WEB_PORT, WEB_URL } from './e2e/env';

const isCI = Boolean(process.env.CI);

/**
 * `npm run test:e2e` starts the REAL backend on a fresh SQLite file and the Vite dev
 * server pointed at it, runs the flow in Chromium, then shuts both down.
 */
export default defineConfig({
  testDir: './e2e',
  // One end-to-end flow sharing one database: run it serially.
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: 'test-results',
  use: {
    baseURL: WEB_URL,
    // Evidence when something breaks: full trace, screenshot and video of the failure.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      name: 'backend',
      // Delete the old database first so every run starts empty.
      command: `rm -f "${DB_FILE}" && exec uv run uvicorn app.main:app --port ${API_PORT}`,
      cwd: BACKEND_DIR,
      url: `${API_URL}/health`,
      env: {
        DATABASE_URL: `sqlite:///${DB_FILE}`,
        CORS_ORIGINS: WEB_URL,
      },
      // Never reuse: a running server could hold stale data or the wrong database.
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      name: 'frontend',
      command: `npm run dev -- --port ${WEB_PORT} --strictPort`,
      url: WEB_URL,
      env: { VITE_API_URL: API_URL },
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
});
