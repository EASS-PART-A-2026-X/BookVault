/**
 * Social flow with three people in separate browsers (contexts), against the real
 * backend: search, private profile + follow request + accept, public profile + follow.
 */
import { expect, test, type Browser, type Page } from '@playwright/test';
import { signUp } from './helpers';

async function newUser(browser: Browser, username: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signUp(page, username);
  return page;
}

async function snap(page: Page, name: string) {
  await test
    .info()
    .attach(name, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
}

test('find a reader, request to follow, get accepted, read their reviews', async ({ browser }) => {
  const austen = await newUser(browser, 'austen');
  const bronte = await newUser(browser, 'bronte');

  await test.step('austen (private by default) adds a reviewed book', async () => {
    await austen.goto('/settings');
    await austen.getByLabel(/^Bio/).fill('Regency romance, mostly.');
    await austen.getByRole('button', { name: 'Save profile' }).click();
    await expect(austen.getByText('Profile saved.')).toBeVisible();
    const created = await austen.request.post('/api/books', {
      data: {
        title: 'Emma',
        author: 'Jane Austen',
        genre: 'Romance',
        rating: 4,
        is_read: true,
        review: 'Meddling, but charming.',
        tropes: ['matchmaking'],
      },
    });
    expect(created.status()).toBe(201);
  });

  await test.step('bronte finds austen, sees a locked profile, and asks to follow', async () => {
    await bronte.getByRole('link', { name: 'People' }).click();
    await bronte.getByLabel('Search people').fill('aust');
    const result = bronte.getByRole('list', { name: 'People' }).getByRole('listitem');
    await expect(result).toHaveCount(1);
    await expect(result).toContainText('@austen · Private');
    await result.getByRole('link').click();

    await expect(bronte.getByRole('heading', { name: 'austen', level: 1 })).toBeVisible();
    await expect(bronte.getByText('Regency romance, mostly.')).toBeVisible();
    await expect(bronte.getByRole('region', { name: 'This profile is private' })).toBeVisible();
    await expect(bronte.getByText('Emma')).toHaveCount(0);
    // The API refuses too, not just the UI.
    expect((await bronte.request.get('/api/users/austen/books')).status()).toBe(403);

    await bronte.getByRole('button', { name: 'Request to follow' }).click();
    await expect(bronte.getByText(/Your request is waiting for austen/)).toBeVisible();
    await snap(bronte, 'bronte-request-sent');
  });

  await test.step('austen sees the request and accepts it', async () => {
    await austen.goto('/');
    const requests = austen.getByRole('link', { name: 'Requests (1 waiting)' });
    await expect(requests).toBeVisible();
    await requests.click();
    await expect(austen.getByRole('list', { name: 'Follow requests' })).toContainText('@bronte');
    await snap(austen, 'austen-requests');
    await austen.getByRole('button', { name: 'Accept bronte' }).click();
    await expect(austen.getByText('bronte can now see your books.')).toBeVisible();
    await expect(austen.getByRole('region', { name: 'No requests right now' })).toBeVisible();
    await expect(austen.getByRole('link', { name: 'Requests', exact: true })).toBeVisible();
  });

  await test.step('bronte can now read austen’s books and reviews', async () => {
    await bronte.reload();
    const books = bronte.getByRole('region', { name: 'austen’s books' });
    await expect(books.getByRole('heading', { name: 'Emma' })).toBeVisible();
    await expect(books.getByText('Meddling, but charming.')).toBeVisible();
    await expect(bronte.getByRole('button', { name: 'Following. Unfollow austen' })).toBeVisible();
    await snap(bronte, 'bronte-reads-reviews');
  });

  await test.step('a public profile is followed instantly, no request', async () => {
    const christie = await newUser(browser, 'christie');
    await christie.goto('/settings');
    await christie.getByRole('radio', { name: /Public/ }).check();
    await christie.getByRole('button', { name: 'Save profile' }).click();
    await expect(christie.getByText(/Profile saved/)).toBeVisible();

    await bronte.goto('/people?q=christie');
    await bronte.getByRole('button', { name: 'Follow', exact: true }).click();
    await expect(
      bronte.getByRole('button', { name: 'Following. Unfollow christie' }),
    ).toBeVisible();
    // Christie has nothing to approve.
    expect(await (await christie.request.get('/api/follow-requests')).json()).toEqual([]);
  });
});
