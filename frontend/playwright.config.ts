import { defineConfig, devices } from '@playwright/test';
import {
  AI_DIR,
  AI_PORT,
  AI_URL,
  API_PORT,
  API_URL,
  BACKEND_DIR,
  DB_FILE,
  WEB_PORT,
  WEB_URL,
} from './e2e/env';

const isCI = Boolean(process.env.CI);

/**
 * `npm run test:e2e` starts the REAL backend on a fresh SQLite file, the REAL AI service
 * (with the offline keyword model, AI_MODEL=fake: no key, same answer every run) and the
 * Vite dev server pointed at both, runs the flows in Chromium, then shuts them down.
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
  // printSteps: show each numbered test.step in the terminal, not just the test name.
  reporter: [
    ['list', { printSteps: true }],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],
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
      name: 'ai-service',
      command: `exec uv run uvicorn app.main:app --port ${AI_PORT}`,
      cwd: AI_DIR,
      url: `${AI_URL}/health`,
      env: { BACKEND_URL: API_URL, AI_MODEL: 'fake', PYDANTIC_AI_NO_BANNER: '1' },
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      name: 'frontend',
      command: `npm run dev -- --port ${WEB_PORT} --strictPort`,
      url: WEB_URL,
      // Same-origin like Docker: the browser calls /api and Vite forwards it to :8001.
      env: { VITE_API_URL: '/api', API_PROXY_TARGET: API_URL, AI_PROXY_TARGET: AI_URL },
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
});
