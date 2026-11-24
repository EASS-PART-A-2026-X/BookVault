/**
 * EX2 automated integration flow, against the REAL FastAPI backend on a fresh
 * SQLite database (see playwright.config.ts):
 *   1. open the app            5. open it, mark as read, give it 5 stars
 *   2. add a book              6. try an invalid action -> error message shown
 *   3. see it in the list      7. delete it -> confirm it's gone
 *   4. filter by its genre
 * Every step attaches a screenshot to the HTML report.
 */
import { expect, test, type Page } from '@playwright/test';
import { API_URL } from './env';

const BOOK = {
  title: 'The Left Hand of Darkness',
  author: 'Ursula K. Le Guin',
  genre: 'Fantasy',
  review: 'Winter, loyalty, and a planet without fixed gender.',
};

/** A book in a different genre, so the genre filter has something to hide. */
const OTHER = { title: 'Dune', author: 'Frank Herbert', genre: 'Sci-Fi', rating: 4, is_read: true };

async function snap(page: Page, name: string) {
  await test
    .info()
    .attach(name, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
}

function toast(page: Page, text: string | RegExp) {
  return page.getByRole('region', { name: 'Notifications' }).getByText(text);
}

function card(page: Page, title: string) {
  return page
    .getByRole('article')
    .filter({ has: page.getByRole('link', { name: title, exact: true }) });
}

test('add, find, filter, update, reject invalid input and delete a book', async ({
  page,
  request,
}) => {
  // The backend starts on an empty database; add one unrelated book through the API.
  const seeded = await request.post(`${API_URL}/books`, { data: OTHER });
  expect(seeded.status()).toBe(201);

  let bookId = 0;

  await test.step('1. open the app', async () => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Your books', level: 1 })).toBeVisible();
    // Data really comes from the backend.
    await expect(page.getByRole('link', { name: OTHER.title, exact: true })).toBeVisible();
    await snap(page, '1-open-app');
  });

  await test.step('2. add a book', async () => {
    await page.getByRole('main').getByRole('link', { name: 'Add book' }).click();
    await expect(page).toHaveURL(/\/books\/new$/);

    await page.getByLabel('Title').fill(BOOK.title);
    await page.getByLabel('Author').fill(BOOK.author);
    await page.getByLabel('Genre').selectOption(BOOK.genre);
    await page.getByLabel(/^Review/).fill(BOOK.review);
    await snap(page, '2a-add-form-filled');

    const created = page.waitForResponse(
      (r) => r.url() === `${API_URL}/books` && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Add book' }).click();
    const response = await created;
    expect(response.status()).toBe(201);
    bookId = (await response.json()).id;

    await expect(toast(page, `Added “${BOOK.title}” to your vault.`)).toBeVisible();
    await snap(page, '2b-added-toast');
  });

  await test.step('3. see it in the list', async () => {
    await expect(page).toHaveURL(/\/$/);
    const ours = card(page, BOOK.title);
    await expect(ours).toBeVisible();
    await expect(ours).toContainText(BOOK.author);
    await expect(ours).toContainText(BOOK.genre);
    await expect(ours).toContainText('Unread');
    await expect(ours.getByRole('img', { name: 'Not rated' })).toBeVisible();
    await expect(page.getByText('2 books')).toBeVisible();
    await snap(page, '3-in-list');
  });

  await test.step('4. filter by its genre', async () => {
    await page.getByRole('search').getByLabel('Genre').selectOption(BOOK.genre);
    await expect(page).toHaveURL(/[?&]genre=Fantasy\b/);
    await expect(card(page, BOOK.title)).toBeVisible();
    await expect(page.getByRole('link', { name: OTHER.title, exact: true })).toHaveCount(0);
    await expect(page.getByText('1 book', { exact: true })).toBeVisible();

    // The filter lives in the URL, so it survives a full reload.
    await page.reload();
    await expect(page.getByRole('search').getByLabel('Genre')).toHaveValue(BOOK.genre);
    await expect(card(page, BOOK.title)).toBeVisible();
    await expect(page.getByRole('link', { name: OTHER.title, exact: true })).toHaveCount(0);
    await snap(page, '4-filtered-by-genre');
  });

  await test.step('5. open it, mark it as read and give it 5 stars', async () => {
    await page.getByRole('link', { name: BOOK.title, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/books/${bookId}$`));
    await expect(page.getByRole('heading', { name: BOOK.title, level: 1 })).toBeVisible();

    await page.getByRole('button', { name: 'Mark as read' }).click();
    await expect(toast(page, 'Marked as read.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mark as unread' })).toBeVisible();

    await page.getByRole('button', { name: 'Rate 5 out of 5' }).click();
    await expect(toast(page, 'Rated 5 stars.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Rate 5 out of 5' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // Saved on the server, not just in the UI.
    const saved = await (await request.get(`${API_URL}/books/${bookId}`)).json();
    expect(saved).toMatchObject({ is_read: true, rating: 5 });
    await snap(page, '5-read-and-rated');
  });

  await test.step('6. try an invalid action and see the error message', async () => {
    await page.getByRole('button', { name: 'Edit' }).click();
    const title = page.getByLabel('Title');
    await title.fill('   ');
    await page.getByRole('button', { name: 'Save changes' }).click();

    await expect(page.getByText('Title is required.')).toBeVisible();
    await expect(title).toHaveAttribute('aria-invalid', 'true');
    await expect(title).toBeFocused();
    await snap(page, '6-validation-error');

    // Nothing invalid reached the server.
    const unchanged = await (await request.get(`${API_URL}/books/${bookId}`)).json();
    expect(unchanged.title).toBe(BOOK.title);

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('heading', { name: BOOK.title, level: 1 })).toBeVisible();
  });

  await test.step('7. delete the book and confirm it is gone', async () => {
    await page.getByRole('button', { name: 'Delete' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Delete this book?' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(BOOK.title);
    await snap(page, '7a-confirm-dialog');

    await dialog.getByRole('button', { name: 'Delete' }).click();
    await expect(toast(page, `Deleted “${BOOK.title}”.`)).toBeVisible();

    // Back on the filtered list, where it was the only Fantasy book.
    await expect(page).toHaveURL(/[?&]genre=Fantasy\b/);
    await expect(page.getByRole('region', { name: 'No books match these filters' })).toBeVisible();
    await page.getByRole('main').getByRole('button', { name: 'Clear filters' }).last().click();
    await expect(page.getByRole('link', { name: OTHER.title, exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: BOOK.title, exact: true })).toHaveCount(0);
    await snap(page, '7b-deleted');

    // Gone on the server, and its page now says so.
    expect((await request.get(`${API_URL}/books/${bookId}`)).status()).toBe(404);
    await page.goto(`/books/${bookId}`);
    await expect(page.getByRole('heading', { name: 'Book not found' })).toBeVisible();
    await snap(page, '7c-not-found');
  });
});
