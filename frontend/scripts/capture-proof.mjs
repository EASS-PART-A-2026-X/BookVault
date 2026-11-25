#!/usr/bin/env node
/**
 * Capture the proof screenshots from a running Docker stack.
 *
 * Use a throwaway Compose project so real data is never touched:
 *   SEED_DEMO_DATA=false FRONTEND_PORT=8090 docker compose -p bvproof up --build -d --wait   # repo root (empty vault)
 *   cd frontend && PROOF_BASE_URL=http://localhost:8090 PROOF_COMPOSE_PROJECT=bvproof \
 *     node scripts/capture-proof.mjs
 *   docker compose -p bvproof down -v                                   # clean up
 *
 * Signs up (or logs in) three demo readers, resets THEIR books and follows, then
 * walks through every screen. It stops and restarts that project's backend container
 * for the "backend down" shot. Output: ../docs/proof/social/*.png (PROOF_OUT to change).
 */
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../..');
const OUT = path.join(ROOT, process.env.PROOF_OUT ?? 'docs/proof/social');
const BASE = process.env.PROOF_BASE_URL ?? 'http://localhost:8080';
const PROJECT = process.env.PROOF_COMPOSE_PROJECT ?? 'book-vault';
const DESKTOP = { width: 1280, height: 860 };
const PHONE = { width: 390, height: 844 };
const PASSWORD = 'demo-reader-password';

const ELEANOR_BOOKS = [
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
const MIRA_BOOKS = [
  {
    title: 'The Goblin Emperor',
    author: 'Katherine Addison',
    genre: 'Fantasy',
    rating: 5,
    is_read: true,
    review: 'Kindness as a superpower. I reread it every winter.',
    tropes: ['court intrigue', 'found family'],
  },
  {
    title: 'Piranesi',
    author: 'Susanna Clarke',
    genre: 'Fantasy',
    rating: 5,
    is_read: true,
    review: 'A house of endless halls and tides. Strange, gentle and unforgettable.',
    tropes: ['unreliable narrator'],
  },
];
const THEO_BOOKS = [
  {
    title: 'The Snowman',
    author: 'Jo Nesbø',
    genre: 'Thriller',
    rating: 4,
    is_read: true,
    review: 'Bleak, twisty, impossible to put down.',
    tropes: ['serial killer', 'twist ending'],
  },
  {
    title: 'Smilla’s Sense of Snow',
    author: 'Peter Høeg',
    genre: 'Mystery',
    rating: 5,
    is_read: true,
    review: 'Ice, grief and a heroine who notices everything.',
  },
];

const browser = await chromium.launch();
mkdirSync(OUT, { recursive: true });

/** A logged-in reader with their own browser (cookies) and API helper. */
async function reader(username, displayName, profile) {
  const context = await browser.newContext({
    viewport: DESKTOP,
    deviceScaleFactor: 2,
    colorScheme: 'dark',
  });
  const page = await context.newPage();
  const api = async (method, url, body) => {
    const res = await context.request.fetch(`${BASE}/api${url}`, { method, data: body });
    if (!res.ok() && res.status() !== 404)
      throw new Error(`${username}: ${method} ${url} -> ${res.status()}`);
    return res.status() === 204 ? null : res.json();
  };
  const reg = await context.request.post(`${BASE}/api/auth/register`, {
    data: { username, password: PASSWORD, display_name: displayName },
  });
  if (reg.status() === 409) await api('POST', '/auth/login', { username, password: PASSWORD });
  else if (!reg.ok()) throw new Error(`register ${username} -> ${reg.status()}`);
  await api('PATCH', '/users/me', { display_name: displayName, ...profile });
  for (const book of await api('GET', '/books')) await api('DELETE', `/books/${book.id}`);
  return { username, context, page, api };
}

function shotOf(page) {
  return async (name, { fullPage = false } = {}) => {
    // Park the pointer so nothing shows a hover state, and let fades settle.
    await page.mouse.move(1, 1);
    await page.waitForTimeout(300);
    await page.screenshot({
      path: path.join(OUT, `${name}.png`),
      fullPage,
      animations: 'disabled',
    });
    console.log(`  saved ${name}.png`);
  };
}

async function dismissToasts(page) {
  const close = page.getByRole('button', { name: 'Dismiss notification' });
  while ((await close.count()) > 0) await close.first().click();
}

function compose(args) {
  execSync(`docker compose -p ${PROJECT} ${args}`, { cwd: ROOT, stdio: 'inherit' });
}

try {
  // ------------------------------------------------------------------ Accounts
  const guest = await browser.newContext({
    viewport: DESKTOP,
    deviceScaleFactor: 2,
    colorScheme: 'dark',
  });
  const guestPage = await guest.newPage();
  const guestShot = shotOf(guestPage);
  await guestPage.goto(`${BASE}/books/new`);
  await guestPage.getByRole('heading', { name: 'Log in' }).waitFor();
  await guestShot('01-login');
  await guestPage.goto(`${BASE}/register`);
  await guestPage.getByLabel('Username').fill('Not Valid');
  await guestPage.getByLabel('Password', { exact: true }).fill('short');
  await guestPage.getByLabel('Confirm password').fill('different');
  await guestPage.getByRole('button', { name: 'Create account' }).click();
  await guestPage.getByText('Passwords don’t match.').waitFor();
  await guestShot('02-register-validation');
  await guest.close();

  const eleanor = await reader('eleanor', 'Eleanor Vance', {
    is_public: false,
    bio: 'Reading my way through the classics, one rainy evening at a time.',
  });
  const mira = await reader('mira', 'Mira Okafor', {
    is_public: false,
    bio: 'Slow-burn fantasy and anything with a map in the front.',
  });
  const theo = await reader('theo', 'Theo Laurent', {
    is_public: true,
    bio: 'Crime fiction, mostly Scandinavian.',
  });
  // Reset follows between runs.
  await eleanor.api('DELETE', '/users/mira/follow');
  await eleanor.api('DELETE', '/users/theo/follow');
  await mira.api('DELETE', '/users/me/followers/eleanor');
  for (const book of MIRA_BOOKS) await mira.api('POST', '/books', book);
  for (const book of THEO_BOOKS) await theo.api('POST', '/books', book);

  const page = eleanor.page;
  const shot = shotOf(page);
  const toast = (text) => page.getByRole('region', { name: 'Notifications' }).getByText(text);

  // --------------------------------------------------------------- Core flows
  await page.goto(BASE);
  await page.getByRole('region', { name: 'Your vault is empty' }).waitFor();
  await shot('03-empty-state');

  const created = [];
  for (const book of ELEANOR_BOOKS) created.push(await eleanor.api('POST', '/books', book));
  await page.reload();
  await page.getByText(`${ELEANOR_BOOKS.length} books`).waitFor();
  await shot('04-book-list', { fullPage: true });

  await page.setViewportSize(PHONE);
  await page.reload();
  await page.getByText(`${ELEANOR_BOOKS.length} books`).waitFor();
  await shot('05-book-list-phone');
  await page.setViewportSize(DESKTOP);

  await page.goto(`${BASE}/?trope=found%20family&status=read`);
  await page.getByText('2 books').waitFor();
  await shot('06-filters-trope');
  await page.goto(`${BASE}/?genre=Romance&trope=chosen%20one`);
  await page.getByRole('region', { name: 'No books match these filters' }).waitFor();
  await shot('07-no-filter-matches');

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
  await shot('08-add-form', { fullPage: true });

  await page.goto(`${BASE}/books/new`);
  await page.getByLabel('Title').fill('   ');
  await page.getByRole('button', { name: 'Add book' }).click();
  await page.getByText('Title is required.').waitFor();
  await shot('09-validation-error', { fullPage: true });

  // Server 422: the body is corrupted in flight so the REAL backend rejects it.
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
  await shot('10-server-422', { fullPage: true });

  const hobbit = created.find((b) => b.title === 'The Hobbit');
  await eleanor.api('PUT', `/books/${hobbit.id}`, { is_read: false });
  await page.goto(`${BASE}/books/${hobbit.id}`);
  await page.getByRole('button', { name: 'Mark as read' }).click();
  await toast('Marked as read.').waitFor();
  await shot('11-detail-and-toast');

  await dismissToasts(page);
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('heading', { name: 'Edit book' }).waitFor();
  await shot('12-edit-view', { fullPage: true });
  await page.getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('alertdialog').waitFor();
  await shot('13-delete-dialog');
  await page.getByRole('button', { name: 'Cancel' }).click();

  await page.goto(`${BASE}/books/9999`);
  await page.getByRole('heading', { name: 'Book not found' }).waitFor();
  await shot('14-not-found');

  console.log('  stopping backend container…');
  compose('stop backend');
  try {
    await page.goto(BASE);
    await page.getByText("Can't reach the server").waitFor();
    await shot('15-backend-down-banner');
  } finally {
    console.log('  starting backend container…');
    compose('start backend');
    execSync(
      `for i in $(seq 1 30); do [ "$(docker inspect -f {{.State.Health.Status}} ${PROJECT}-backend-1)" = healthy ] && exit 0; sleep 1; done; exit 1`,
      { cwd: ROOT, shell: '/bin/sh' },
    );
  }
  await page.getByRole('button', { name: 'Retry' }).click();
  await page.getByText(`${ELEANOR_BOOKS.length} books`).waitFor();
  await shot('16-after-retry');

  // ------------------------------------------------------------------- Social
  await page.goto(`${BASE}/people`);
  await page.getByLabel('Search people').fill('o');
  await page.getByRole('list', { name: 'People' }).getByText('@mira').waitFor();
  await shot('17-people-search');

  await page.goto(`${BASE}/u/mira`);
  await page.getByRole('region', { name: 'This profile is private' }).waitFor();
  await shot('18-private-profile-locked');

  await page.getByRole('button', { name: 'Request to follow' }).click();
  await page.getByText(/Your request is waiting for Mira Okafor/).waitFor();
  await shot('19-request-sent');

  const miraShot = shotOf(mira.page);
  await mira.page.goto(`${BASE}/requests`);
  await mira.page.getByRole('link', { name: 'Requests (1 waiting)' }).waitFor();
  await mira.page.getByRole('list', { name: 'Follow requests' }).waitFor();
  await miraShot('20-requests-inbox');
  await mira.page.getByRole('button', { name: 'Accept Eleanor Vance' }).click();
  await mira.page.getByText('Eleanor Vance can now see your books.').waitFor();
  await miraShot('21-request-accepted');

  await dismissToasts(page);
  await page.reload();
  await page.getByRole('region', { name: 'Mira Okafor’s books' }).waitFor();
  await shot('22-profile-reviews', { fullPage: true });

  await page.goto(`${BASE}/u/theo`);
  await page.getByRole('button', { name: 'Follow', exact: true }).click();
  await toast('You’re following Theo Laurent.').waitFor();
  await shot('23-public-profile-followed');

  await page.goto(`${BASE}/settings`);
  await page.getByRole('heading', { name: 'Your profile' }).waitFor();
  await shot('24-settings');

  await page.setViewportSize(PHONE);
  await page.goto(`${BASE}/u/theo`);
  await page.getByRole('region', { name: 'Theo Laurent’s books' }).waitFor();
  await shot('25-profile-phone');
  await page.setViewportSize(DESKTOP);

  await page.goto(`${BASE}/api/docs`);
  await page.getByText('Personal Book Vault & Reading Tracker').first().waitFor();
  await shot('26-swagger-via-proxy');
} finally {
  await browser.close();
}
