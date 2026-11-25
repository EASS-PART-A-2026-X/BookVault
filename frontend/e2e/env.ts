/** Ports and URLs for the end-to-end run, shared by playwright.config.ts and the specs. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const FRONTEND_DIR = path.resolve(here, '..');
export const BACKEND_DIR = path.resolve(FRONTEND_DIR, '../book-vault');
export const AI_DIR = path.resolve(FRONTEND_DIR, '../ai-service');

// Dedicated ports, so the e2e run never touches dev servers on 8000 / 8100 / 5173.
export const API_PORT = Number(process.env.E2E_API_PORT ?? 8001);
export const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5174);
export const AI_PORT = Number(process.env.E2E_AI_PORT ?? 8101);
export const API_URL = `http://localhost:${API_PORT}`;
export const AI_URL = `http://localhost:${AI_PORT}`;
export const WEB_URL = `http://localhost:${WEB_PORT}`;

/** Throwaway SQLite file, deleted every time the backend starts (gitignored). */
export const DB_FILE = path.join(here, '.tmp', 'e2e.db');
