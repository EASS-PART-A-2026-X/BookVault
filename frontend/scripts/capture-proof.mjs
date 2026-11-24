#!/usr/bin/env node
/**
 * Capture the EX2 proof screenshots from the running Docker stack.
 *
 *   docker compose up --build -d --wait        # from the repo root
 *   cd frontend && node scripts/capture-proof.mjs
 *
 * WARNING: deletes every book in the target stack, then seeds demo books.
 * It also stops and restarts the backend container for the "backend down" shot.
 * Output: ../docs/proof/ex2/*.png
 */
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../..');
const OUT = path.join(ROOT, 'docs/proof/ex2');
const BASE = process.env.PROOF_BASE_URL ?? 'http://localhost:8080';
const API = `${BASE}/api`;
const DESKTOP = { width: 1280, height: 860 };
const PHONE = { width: 390, height: 844 };

const DEMO_BOOKS = [
  {
    title: 'Dune',
    author: 'Frank Herbert',
    genre: 'Sci-Fi',
    rating: 5,
    is_read: true,
    review: 'Politics, ecology and prophecy on a desert planet. A classic for a reason.',
    tropes: ['chosen one', 'political intrigue', 'desert planet'],
  },
  {
    title: 'Pride and Prejudice',
    author: 'Jane Austen',
    genre: 'Romance',
    rating: 5,
    is_read: true,
    review: 'Sharp, funny and still the template for the genre.',
    tropes: ['enemies to lovers', 'slow burn', 'marriage plot'],
  },
  {
    title: 'The Name of the Wind',
    author: 'Patrick Rothfuss',
    genre: 'Fantasy',
    rating: 4,
    is_read: true,
    tropes: ['chosen one', 'magic school', 'found family'],
  },
  {
    title: 'Gone Girl',
    author: 'Gillian Flynn',
    genre: 'Thriller',
    rating: 4,
    is_read: true,
    tropes: ['unreliable narrator', 'twist ending'],
  },
  {
    title: 'The Murder of Roger Ackroyd',
    author: 'Agatha Christie',
    genre: 'Mystery',
    is_read: false,
    tropes: ['unreliable narrator', 'village mystery'],
  },
  { title: 'Sapiens', author: 'Yuval Noah Harari', genre: 'Non-Fiction', rating: 3, is_read: true },
  {
    title: 'Wolf Hall',
    author: 'Hilary Mantel',
    genre: 'Historical',
    is_read: false,
    tropes: ['political intrigue', 'court drama'],
  },
  {
    title: 'The Hobbit',
    author: 'J.R.R. Tolkien',
    genre: 'Fantasy',
    rating: 5,
    is_read: true,
    review: 'There and back again.',
    tropes: ['quest', 'found family'],
  },
];

async function api(method, url, body) {
  const res = await fetch(`${API}${url}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok && res.status !== 404) throw new Error(`${method} ${url} -> ${res.status}`);
  return res.status === 204 ? null : res.json();
}

function compose(args) {
  execSync(`docker compose ${args}`, { cwd: ROOT, stdio: 'inherit' });
}

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: DESKTOP,
  deviceScaleFactor: 2,
  colorScheme: 'dark',
});
const page = await context.newPage();
mkdirSync(OUT, { recursive: true });

async function shot(name, { fullPage = false } = {}) {
  // Park the pointer so nothing shows a hover state, and let fades settle.
  await page.mouse.move(1, 1);
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage, animations: 'disabled' });
  console.log(`  saved ${name}.png`);
}

const toast = (text) => page.getByRole('region', { name: 'Notifications' }).getByText(text);

async function dismissToasts() {
  const close = page.getByRole('button', { name: 'Dismiss notification' });
  while ((await close.count()) > 0) await close.first().click();
}

try {
  // ---- Empty state: remove every book first.
  for (const book of await api('GET', '/books')) await api('DELETE', `/books/${book.id}`);
  await page.goto(BASE);
  await page.getByRole('region', { name: 'Your vault is empty' }).waitFor();
  await shot('01-empty-state');

  // ---- Seed and show the main list.
  const created = [];
  for (const book of DEMO_BOOKS) created.push(await api('POST', '/books', book));
  await page.reload();
  await page.getByText(`${DEMO_BOOKS.length} books`).waitFor();
  await shot('02-book-list', { fullPage: true });

  // ---- Same list at phone width.
  await page.setViewportSize(PHONE);
  await page.reload();
  await page.getByText(`${DEMO_BOOKS.length} books`).waitFor();
  await shot('03-book-list-phone');
  await page.setViewportSize(DESKTOP);

  // ---- Filters (genre + trope) kept in the URL, then a filter with no matches.
  await page.goto(`${BASE}/?trope=found%20family&status=read`);
  await page.getByText('2 books').waitFor();
  await shot('04-filters-trope');
  await page.goto(`${BASE}/?genre=Romance&trope=chosen%20one`);
  await page.getByRole('region', { name: 'No books match these filters' }).waitFor();
  await shot('05-no-filter-matches');

  // ---- Add form, filled in.
  await page.goto(`${BASE}/books/new`);
  await page.getByLabel('Title').fill('The Left Hand of Darkness');
  await page.getByLabel('Author').fill('Ursula K. Le Guin');
  await page.getByLabel('Genre').selectOption('Sci-Fi');
  for (const trope of ['first contact', 'political intrigue']) {
    await page.getByLabel(/^Tropes/).fill(trope);
    await page.getByLabel(/^Tropes/).press('Enter');
  }
  await page.getByRole('button', { name: 'Rate 4 out of 5' }).click();
  await page.getByLabel(/^Review/).fill('Winter, loyalty, and a planet without fixed gender.');
  await shot('06-add-form', { fullPage: true });

  // ---- Client-side validation errors (empty form submitted).
  await page.goto(`${BASE}/books/new`);
  await page.getByLabel('Title').fill('   ');
  await page.getByRole('button', { name: 'Add book' }).click();
  await page.getByText('Title is required.').waitFor();
  await shot('07-validation-error', { fullPage: true });

  // ---- Server 422: the request body is corrupted in flight so the REAL backend rejects it.
  await page.goto(`${BASE}/books/new`);
  await page.route('**/api/books', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const body = JSON.parse(route.request().postData() ?? '{}');
    await route.continue({
      postData: JSON.stringify({ ...body, author: '', genre: 'Horror', rating: 9 }),
    });
  });
  await page.getByLabel('Title').fill('Rejected by the server');
  await page.getByLabel('Author').fill('Valid On The Client');
  await page.getByLabel('Genre').selectOption('Thriller');
  await page.getByRole('button', { name: 'Add book' }).click();
  await page.getByText('Input should be less than or equal to 5').waitFor();
  await page.unroute('**/api/books');
  await shot('08-server-422', { fullPage: true });

  // ---- Detail view, with a success toast from a quick action.
  const hobbit = created.find((b) => b.title === 'The Hobbit');
  await api('PUT', `/books/${hobbit.id}`, { is_read: false });
  await page.goto(`${BASE}/books/${hobbit.id}`);
  await page.getByRole('button', { name: 'Mark as read' }).click();
  await toast('Marked as read.').waitFor();
  await shot('09-detail-and-toast');

  // ---- Edit view.
  await dismissToasts();
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('heading', { name: 'Edit book' }).waitFor();
  await shot('10-edit-view', { fullPage: true });
  await page.getByRole('button', { name: 'Cancel' }).click();

  // ---- Delete confirmation dialog (cancelled).
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('alertdialog').waitFor();
  await shot('11-delete-dialog');
  await page.getByRole('button', { name: 'Cancel' }).click();

  // ---- Not found.
  await page.goto(`${BASE}/books/9999`);
  await page.getByRole('heading', { name: 'Book not found' }).waitFor();
  await shot('12-not-found');

  // ---- Backend down: stop the real backend container.
  console.log('  stopping backend container…');
  compose('stop backend');
  try {
    await page.goto(BASE);
    await page.getByText("Can't reach the server").waitFor();
    await shot('13-backend-down-banner');
  } finally {
    console.log('  starting backend container…');
    compose('start backend');
    execSync(
      'for i in $(seq 1 30); do [ "$(docker inspect -f {{.State.Health.Status}} book-vault-backend-1)" = healthy ] && exit 0; sleep 1; done; exit 1',
      { cwd: ROOT, shell: '/bin/sh' },
    );
  }
  await page.getByRole('button', { name: 'Retry' }).click();
  await page.getByText(`${DEMO_BOOKS.length} books`).waitFor();
  await shot('14-after-retry');

  // ---- Swagger UI through the nginx proxy.
  await page.goto(`${API}/docs`);
  await page.getByText('Personal Book Vault & Reading Tracker').first().waitFor();
  await shot('15-swagger-via-proxy');
} finally {
  await browser.close();
}
