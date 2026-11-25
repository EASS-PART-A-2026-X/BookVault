import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, type Page } from '@playwright/test';
import { OUTBOX_DIR } from './env';

export const PASSWORD = 'correct horse battery';

export const emailFor = (username: string) => `${username}@example.com`;

/** Create an account through the real sign-up page; ends logged in on the book list. */
export async function signUp(page: Page, username: string) {
  await page.goto('/register');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Email').fill(emailFor(username));
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Confirm password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your books', level: 1 })).toBeVisible();
}

export async function logOut(page: Page) {
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
}

interface SentEmail {
  to: string;
  subject: string;
  body: string;
}

/** The newest email the backend "sent" to this address (EMAIL_BACKEND=file). Waits for it. */
export async function latestEmailTo(address: string): Promise<SentEmail> {
  let found: SentEmail | undefined;
  await expect
    .poll(
      async () => {
        const names = (await readdir(OUTBOX_DIR).catch(() => [])).sort().reverse();
        for (const name of names) {
          const email = JSON.parse(
            await readFile(path.join(OUTBOX_DIR, name), 'utf8'),
          ) as SentEmail;
          if (email.to === address) {
            found = email;
            return true;
          }
        }
        return false;
      },
      { message: `an email to ${address}` },
    )
    .toBe(true);
  return found!;
}
