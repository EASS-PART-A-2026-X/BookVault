import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, NetworkError, ValidationError } from '../api/books';
import { READER, mocked, resetApiMocks } from '../test/mockApi';
import { renderApp } from '../test/render';

vi.mock('../api/books', async () => (await import('../test/mockApiFactory')).default());

const signedOut = () => new ApiError(401, 'Not authenticated', 'Not authenticated');
const SENT =
  'If an account uses that email, we’ve sent it a link to reset the password. ' +
  'The link works for 30 minutes.';
const RESET_INVALID = 'This reset link is invalid or has expired. Ask for a new one.';

beforeEach(() => {
  resetApiMocks();
  mocked.listBooks.mockResolvedValue([]);
});

describe('forgot password', () => {
  beforeEach(() => {
    mocked.getMe.mockRejectedValue(signedOut());
  });

  it('is linked from the login page', async () => {
    const { user } = await renderApp('/login');
    await user.click(await screen.findByRole('link', { name: 'Forgot your password?' }));
    expect(
      await screen.findByRole('heading', { name: 'Forgot your password?' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/forgot-password');
  });

  it('checks the email before sending', async () => {
    const { user } = await renderApp('/forgot-password');
    await user.click(await screen.findByRole('button', { name: 'Send reset link' }));
    expect(screen.getByText('Enter your email address.')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveFocus();

    await user.type(screen.getByLabelText('Email'), 'nope');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(screen.getByText('Enter an email address like name@example.com.')).toBeInTheDocument();
    expect(mocked.requestPasswordReset).not.toHaveBeenCalled();
  });

  it('sends the normalised email and shows the server’s neutral answer', async () => {
    mocked.requestPasswordReset.mockResolvedValue(SENT);
    const { user } = await renderApp('/forgot-password');
    await user.type(await screen.findByLabelText('Email'), '  Gal@Example.com ');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));

    expect(mocked.requestPasswordReset).toHaveBeenCalledWith('gal@example.com');
    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(SENT);
    expect(screen.getByRole('link', { name: 'Back to log in' })).toHaveAttribute('href', '/login');
  });

  it('says when the server can’t be reached', async () => {
    mocked.requestPasswordReset.mockRejectedValue(new NetworkError(new TypeError('offline')));
    const { user } = await renderApp('/forgot-password');
    await user.type(await screen.findByLabelText('Email'), 'gal@example.com');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/can.t reach the server/i);
  });

  it('is only for logged-out readers', async () => {
    mocked.getMe.mockResolvedValue(READER);
    await renderApp('/forgot-password');
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/));
  });
});

describe('reset password (from the emailed link)', () => {
  beforeEach(() => {
    mocked.getMe.mockRejectedValue(signedOut());
  });

  async function fillAndSubmit(
    user: Awaited<ReturnType<typeof renderApp>>['user'],
    password: string,
    confirm = password,
  ) {
    await user.type(await screen.findByLabelText('New password'), password);
    await user.type(screen.getByLabelText('Confirm new password'), confirm);
    await user.click(screen.getByRole('button', { name: 'Set new password' }));
  }

  it('sets the new password, removes the token from the address and goes to login', async () => {
    mocked.confirmPasswordReset.mockResolvedValue(undefined);
    const { user } = await renderApp('/reset-password?token=abc123');
    await screen.findByRole('heading', { name: 'Choose a new password' });
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(/^\/reset-password$/),
    );

    await fillAndSubmit(user, 'a new passphrase');

    expect(mocked.confirmPasswordReset).toHaveBeenCalledWith('abc123', 'a new passphrase');
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(
      screen.getByText('Password changed. Log in with your new password.'),
    ).toBeInTheDocument();
  });

  it('checks length and match before sending', async () => {
    const { user } = await renderApp('/reset-password?token=abc123');
    await fillAndSubmit(user, 'short', 'other');
    expect(screen.getByText('Use at least 8 characters.')).toBeInTheDocument();
    expect(screen.getByText('Passwords don’t match.')).toBeInTheDocument();
    expect(screen.getByLabelText('New password')).toHaveFocus();
    expect(mocked.confirmPasswordReset).not.toHaveBeenCalled();
  });

  it('explains an expired or used link and offers a new one', async () => {
    mocked.confirmPasswordReset.mockRejectedValue(new ApiError(400, RESET_INVALID, RESET_INVALID));
    const { user } = await renderApp('/reset-password?token=old');
    await fillAndSubmit(user, 'a new passphrase');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(RESET_INVALID);
    expect(within(alert).getByRole('link', { name: 'Send me a new link' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
  });

  it('maps a server 422 onto the password field', async () => {
    mocked.confirmPasswordReset.mockRejectedValue(
      new ValidationError([
        {
          type: 'string_too_long',
          loc: ['body', 'new_password'],
          msg: 'Too long, says the server',
        },
      ]),
    );
    const { user } = await renderApp('/reset-password?token=abc');
    await fillAndSubmit(user, 'a new passphrase');
    expect(await screen.findByText('Too long, says the server')).toBeInTheDocument();
    expect(screen.getByLabelText('New password')).toHaveAttribute('aria-invalid', 'true');
  });

  it('without a token, points to a new link', async () => {
    await renderApp('/reset-password');
    expect(await screen.findByRole('alert')).toHaveTextContent('This reset link is incomplete.');
    expect(screen.getByRole('link', { name: 'Send me a new link' })).toBeInTheDocument();
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
  });

  it('works in a logged-in browser too, and logs it out afterwards', async () => {
    mocked.getMe.mockResolvedValue(READER);
    mocked.confirmPasswordReset.mockResolvedValue(undefined);
    const { user } = await renderApp('/reset-password?token=abc123');
    await fillAndSubmit(user, 'a new passphrase');

    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(mocked.logout).toHaveBeenCalled();
  });
});

describe('settings: email', () => {
  it('warns when the account has no email', async () => {
    mocked.getMe.mockResolvedValue({ ...READER, email: null });
    await renderApp('/settings');
    const section = await screen.findByRole('region', { name: 'Email' });
    expect(within(section).getByRole('status')).toHaveTextContent(
      'can’t reset a forgotten password',
    );
  });

  it('saves a new email with the current password', async () => {
    mocked.changeEmail.mockResolvedValue({ ...READER, email: 'new@example.com' });
    const { user } = await renderApp('/settings');
    const section = await screen.findByRole('region', { name: 'Email' });
    const save = within(section).getByRole('button', { name: 'Save email' });
    expect(save).toBeDisabled(); // nothing changed yet

    const email = within(section).getByLabelText('Email');
    await user.clear(email);
    await user.type(email, ' New@Example.com ');
    await user.type(within(section).getByLabelText('Current password'), 'my password');
    await user.click(save);

    expect(mocked.changeEmail).toHaveBeenCalledWith('new@example.com', 'my password');
    expect(await screen.findByText('Email saved. Reset links will go there.')).toBeInTheDocument();
    expect(within(section).getByLabelText('Current password')).toHaveValue('');
  });

  it('shows a wrong password and an email in use on their fields', async () => {
    mocked.changeEmail
      .mockRejectedValueOnce(new ApiError(400, 'Current password is incorrect', null))
      .mockRejectedValueOnce(new ApiError(409, 'Email already in use by another account', null));
    const { user } = await renderApp('/settings');
    const section = await screen.findByRole('region', { name: 'Email' });
    const email = within(section).getByLabelText('Email');
    await user.clear(email);
    await user.type(email, 'taken@example.com');
    await user.type(within(section).getByLabelText('Current password'), 'nope');
    await user.click(within(section).getByRole('button', { name: 'Save email' }));
    expect(
      await within(section).findByText('That’s not your current password.'),
    ).toBeInTheDocument();

    await user.click(within(section).getByRole('button', { name: 'Save email' }));
    expect(
      await within(section).findByText('That email is already used by another account.'),
    ).toBeInTheDocument();
  });

  it('checks the email and password before sending', async () => {
    const { user } = await renderApp('/settings');
    const section = await screen.findByRole('region', { name: 'Email' });
    const email = within(section).getByLabelText('Email');
    await user.clear(email);
    await user.type(email, 'bad');
    await user.click(within(section).getByRole('button', { name: 'Save email' }));
    expect(
      within(section).getByText('Enter an email address like name@example.com.'),
    ).toBeInTheDocument();
    expect(within(section).getByText('Enter your current password.')).toBeInTheDocument();
    expect(mocked.changeEmail).not.toHaveBeenCalled();
  });
});

describe('settings: password', () => {
  async function fillPassword(
    user: Awaited<ReturnType<typeof renderApp>>['user'],
    values: { current?: string; next?: string; confirm?: string },
  ) {
    const section = await screen.findByRole('region', { name: 'Password' });
    if (values.current)
      await user.type(within(section).getByLabelText('Current password'), values.current);
    if (values.next) await user.type(within(section).getByLabelText('New password'), values.next);
    if (values.confirm)
      await user.type(within(section).getByLabelText('Confirm new password'), values.confirm);
    await user.click(within(section).getByRole('button', { name: 'Change password' }));
    return section;
  }

  it('changes the password and clears the form', async () => {
    mocked.changePassword.mockResolvedValue(undefined);
    const { user } = await renderApp('/settings');
    const section = await fillPassword(user, {
      current: 'old password',
      next: 'new passphrase',
      confirm: 'new passphrase',
    });
    expect(mocked.changePassword).toHaveBeenCalledWith('old password', 'new passphrase');
    expect(
      await screen.findByText('Password changed. Your other devices were logged out.'),
    ).toBeInTheDocument();
    expect(within(section).getByLabelText('New password')).toHaveValue('');
  });

  it('keeps the session on a wrong current password (400, not 401)', async () => {
    mocked.changePassword.mockRejectedValue(
      new ApiError(400, 'Current password is incorrect', null),
    );
    const { user } = await renderApp('/settings');
    const section = await fillPassword(user, {
      current: 'wrong',
      next: 'new passphrase',
      confirm: 'new passphrase',
    });
    expect(
      await within(section).findByText('That’s not your current password.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log out' })).toBeInTheDocument();
  });

  it('checks the fields before sending', async () => {
    const { user } = await renderApp('/settings');
    const section = await fillPassword(user, { next: 'short', confirm: 'other' });
    expect(within(section).getByText('Enter your current password.')).toBeInTheDocument();
    expect(within(section).getByText('Use at least 8 characters.')).toBeInTheDocument();
    expect(within(section).getByText('Passwords don’t match.')).toBeInTheDocument();
    expect(mocked.changePassword).not.toHaveBeenCalled();
  });

  it('maps a server 422 and shows other errors in the form', async () => {
    mocked.changePassword
      .mockRejectedValueOnce(
        new ValidationError([
          { type: 'string_too_long', loc: ['body', 'new_password'], msg: 'Server says too long' },
        ]),
      )
      .mockRejectedValueOnce(new NetworkError(new TypeError('offline')));
    const { user } = await renderApp('/settings');
    const section = await fillPassword(user, {
      current: 'old password',
      next: 'new passphrase',
      confirm: 'new passphrase',
    });
    expect(await within(section).findByText('Server says too long')).toBeInTheDocument();

    await user.click(within(section).getByRole('button', { name: 'Change password' }));
    expect(await within(section).findByRole('alert')).toHaveTextContent(/can.t reach the server/i);
  });
});
