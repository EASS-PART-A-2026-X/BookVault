/**
 * AI search end to end: the browser -> Vite proxy -> the REAL AI service (Pydantic AI
 * agent with the offline keyword model, AI_MODEL=fake) -> the REAL backend with the
 * reader's own cookie. Checks the answer, the link back to list filters, invalid input,
 * and that another reader's books never show up.
 */
import { expect, test, type Page } from '@playwright/test';
import { signUp } from './helpers';

async function addBook(page: Page, data: Record<string, unknown>) {
  const response = await page.request.post('/api/books', { data });
  expect(response.status()).toBe(201);
}

async function ask(page: Page, question: string) {
  await page.getByLabel('Your question').fill(question);
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
}

test('ask your vault in plain English', async ({ page, browser }) => {
  await test.step('1. a reader with three books', async () => {
    await signUp(page, 'tolkienfan');
    await addBook(page, {
      title: 'Legends & Lattes',
      author: 'Travis Baldree',
      genre: 'Fantasy',
      tropes: ['found family', 'cozy'],
    });
    await addBook(page, {
      title: 'The Hobbit',
      author: 'J.R.R. Tolkien',
      genre: 'Fantasy',
      rating: 5,
      is_read: true,
      tropes: ['found family', 'quest'],
    });
    await addBook(page, { title: 'Dune', author: 'Frank Herbert', genre: 'Sci-Fi', rating: 4 });
  });

  await test.step('2. ask: the AI service answers with a plan and only matching books', async () => {
    await page.getByRole('link', { name: 'Ask' }).click();
    await expect(page.getByRole('heading', { name: 'Ask your vault' })).toBeVisible();
    const reply = page.waitForResponse('**/api/ai/search');
    await ask(page, 'unread fantasy with found family');
    expect((await reply).status()).toBe(200);

    const understood = page.getByRole('list', { name: 'Understood as' });
    await expect(understood.getByText('Fantasy')).toBeVisible();
    await expect(understood.getByText('Unread')).toBeVisible();
    await expect(understood.getByText('Trope: found family')).toBeVisible();
    const books = page.getByRole('list', { name: 'Matching books' });
    await expect(books.getByRole('link')).toHaveText(['Legends & Lattes']);
  });

  await test.step('3. the same search opens as list filters', async () => {
    await page.getByRole('link', { name: 'Open these filters in your list' }).click();
    await expect(page).toHaveURL(/genre=Fantasy/);
    await expect(page).toHaveURL(/status=unread/);
    await expect(page.getByRole('list', { name: 'Books' }).getByRole('link')).toHaveText([
      'Legends & Lattes',
    ]);
  });

  await test.step('4. search by author', async () => {
    await page.goto('/ask');
    await ask(page, 'books by Tolkien');
    await expect(page.getByRole('list', { name: 'Matching books' }).getByRole('link')).toHaveText([
      'The Hobbit',
    ]);
  });

  await test.step('5. invalid input: an empty question is caught before any request', async () => {
    let called = false;
    page.on('request', (r) => {
      if (r.url().includes('/api/ai/')) called = true;
    });
    await ask(page, '   ');
    await expect(page.getByText('Type a question first.')).toBeVisible();
    expect(called).toBe(false);
    // And the service itself rejects it too.
    const direct = await page.request.post('/api/ai/search', { data: { question: '' } });
    expect(direct.status()).toBe(422);
  });

  await test.step("6. another reader's AI search never sees these books", async () => {
    const context = await browser.newContext();
    const other = await context.newPage();
    await signUp(other, 'otherreader');
    await other.goto('/ask');
    await ask(other, 'fantasy');
    await expect(other.getByText('No books match')).toBeVisible();
    await context.close();
  });

  await test.step('7. logged out: the AI service refuses (401)', async () => {
    const anonymous = await browser.newContext();
    const response = await anonymous.request.post(
      `${test.info().project.use.baseURL}/api/ai/search`,
      {
        data: { question: 'fantasy' },
      },
    );
    expect(response.status()).toBe(401);
    expect(await response.json()).toEqual({ detail: 'Not logged in' });
    await anonymous.close();
  });
});
