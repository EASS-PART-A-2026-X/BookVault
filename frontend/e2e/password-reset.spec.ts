import { expect, test, type Page } from '@playwright/test';
import { PASSWORD, emailFor, latestEmailTo, logOut, signUp } from './helpers';

const NEW_PASSWORD = 'a brand new passphrase';
const NEWEST_PASSWORD = 'and another passphrase';

async function logIn(page: Page, username: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
}

test('forgot password: email link, new password, old one stops working', async ({ page }) => {
  const username = 'forgetful';

  await test.step('1. sign up with an email, then log out', async () => {
    await signUp(page, username);
    await logOut(page);
  });

  await test.step('2. ask for a reset link from the login page', async () => {
    await page.getByRole('link', { name: 'Forgot your password?' }).click();
    await page.getByLabel('Email').fill(emailFor(username).toUpperCase());
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  });

  let link = '';
  await test.step('3. the email arrives with a link to this app', async () => {
    const email = await latestEmailTo(emailFor(username));
    expect(email.subject).toBe('Reset your Book Vault password');
    expect(email.body).not.toContain(PASSWORD);
    link = email.body.match(/http\S+\/reset-password\?token=[\w-]+/)?.[0] ?? '';
    expect(link).not.toBe('');
  });

  await test.step('4. open it and choose a new password', async () => {
    await page.goto(link);
    await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
    await expect(page).toHaveURL(/\/reset-password$/); // token dropped from the address bar
    await page.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD);
    await page.getByLabel('Confirm new password').fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Set new password' }).click();
    await expect(page.getByText('Password changed. Log in with your new password.')).toBeVisible();
  });

  await test.step('5. the old password fails, the new one works', async () => {
    await logIn(page, username, PASSWORD);
    await expect(page.getByRole('alert')).toContainText('don’t match an account');
    await logIn(page, username, NEW_PASSWORD);
    await expect(page.getByRole('heading', { name: 'Your books', level: 1 })).toBeVisible();
  });

  await test.step('6. the link works only once', async () => {
    await page.goto(link);
    await page.getByLabel('New password', { exact: true }).fill(NEWEST_PASSWORD);
    await page.getByLabel('Confirm new password').fill(NEWEST_PASSWORD);
    await page.getByRole('button', { name: 'Set new password' }).click();
    await expect(page.getByRole('alert')).toContainText('invalid or has expired');
  });

  await test.step('7. an unknown email gets the same answer', async () => {
    await page.goto('/login');
    if (await page.getByRole('button', { name: 'Log out' }).isVisible()) await logOut(page);
    await page.goto('/forgot-password');
    await page.getByLabel('Email').fill('nobody@example.com');
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByRole('status')).toContainText('If an account uses that email');
  });
});

test('settings: change password and email', async ({ page }) => {
  const username = 'tidyreader';
  await signUp(page, username);
  await page.goto('/settings');

  await test.step('1. change the password', async () => {
    const section = page.getByRole('region', { name: 'Password' });
    await section.getByLabel('Current password').fill(PASSWORD);
    await section.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD);
    await section.getByLabel('Confirm new password').fill(NEW_PASSWORD);
    await section.getByRole('button', { name: 'Change password' }).click();
    await expect(
      page.getByText('Password changed. Your other devices were logged out.'),
    ).toBeVisible();
    // This browser stays logged in.
    await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
  });

  await test.step('2. change the email; reset links now go there', async () => {
    const section = page.getByRole('region', { name: 'Email' });
    await section.getByLabel('Email').fill('tidy.new@example.com');
    await section.getByLabel('Current password').fill(NEW_PASSWORD);
    await section.getByRole('button', { name: 'Save email' }).click();
    await expect(page.getByText('Email saved. Reset links will go there.')).toBeVisible();

    const response = await page.request.post('/api/auth/password-reset', {
      data: { email: 'tidy.new@example.com' },
    });
    expect(response.status()).toBe(202);
    const email = await latestEmailTo('tidy.new@example.com');
    expect(email.body).toContain(`"${username}"`);
  });
});
