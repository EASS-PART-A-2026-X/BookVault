/** Accounts in the UI: guards, login, sign-up, logout, and losing the session. */
import { act, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, NetworkError, ValidationError } from '../api/books';
import { mocked, resetApiMocks } from '../test/mockApi';
import { renderApp } from '../test/render';
import type { User } from '../types';
import { safeNext } from './next';

vi.mock('../api/books', async () => (await import('../test/mockApiFactory')).default());

const GAL: User = {
  id: 7,
  username: 'gal',
  display_name: 'Gal',
  bio: '',
  is_public: false,
  email: 'gal@example.com',
  created_at: '2026-11-24T10:00:00',
};

const signedOut = () => new ApiError(401, 'Not authenticated', 'Not authenticated');

beforeEach(() => {
  resetApiMocks();
  mocked.listBooks.mockResolvedValue([]);
  mocked.getBook.mockRejectedValue(new ApiError(404, 'Book not found', 'Book not found'));
});

describe('route guards', () => {
  it('sends a logged-out visitor to the login page', async () => {
    mocked.getMe.mockRejectedValue(signedOut());
    await renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/login$/);
    expect(mocked.listBooks).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Sign up' })).toBeInTheDocument();
  });

  it('remembers a deep link and returns there after logging in', async () => {
    mocked.getMe.mockRejectedValue(signedOut());
    mocked.login.mockResolvedValue(GAL);
    const { user } = await renderApp('/books/new');
    await screen.findByRole('heading', { name: 'Log in' });
    expect(screen.getByTestId('location')).toHaveTextContent('/login?next=%2Fbooks%2Fnew');

    await user.type(screen.getByLabelText('Username'), 'Gal');
    await user.type(screen.getByLabelText('Password'), 'correct horse battery');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(mocked.login).toHaveBeenCalledWith({
      username: 'Gal',
      password: 'correct horse battery',
    });
    expect(await screen.findByRole('heading', { name: 'Add a book' })).toBeInTheDocument();
    expect(screen.getByText('Welcome back, Gal.')).toBeInTheDocument();
    expect(screen.getByText('Gal')).toBeInTheDocument(); // header
  });

  it('keeps logged-in users away from the login page', async () => {
    await renderApp('/login');
    expect(await screen.findByRole('heading', { name: 'Your books' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/);
  });

  it('shows a retryable banner if the session check cannot reach the server', async () => {
    mocked.getMe.mockRejectedValueOnce(new NetworkError()).mockResolvedValueOnce(GAL);
    const { user } = await renderApp('/');
    const banner = screen.getByRole('alert');
    expect(banner).toHaveTextContent("Can't reach the server");
    // We don't know if you're logged in, so the header offers neither state.
    expect(screen.queryByRole('link', { name: 'Log in' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Log out' })).not.toBeInTheDocument();
    await user.click(within(banner).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'Your books' })).toBeInTheDocument();
  });

  it.each(['//evil.example', 'https://evil.example', 'books', null])(
    'ignores unsafe ?next=%s',
    (next) => {
      expect(safeNext(next)).toBe('/');
    },
  );
});

describe('login', () => {
  beforeEach(() => {
    mocked.getMe.mockRejectedValue(signedOut());
  });

  it('checks for empty fields before calling the server', async () => {
    const { user } = await renderApp('/login');
    await screen.findByRole('heading', { name: 'Log in' });
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    expect(screen.getByText('Enter your username.')).toBeInTheDocument();
    expect(screen.getByText('Enter your password.')).toBeInTheDocument();
    expect(screen.getByLabelText('Username')).toHaveFocus();
    expect(mocked.login).not.toHaveBeenCalled();
  });

  it('shows a clear message for wrong credentials and clears the password', async () => {
    mocked.login.mockRejectedValue(new ApiError(401, 'Invalid username or password', null));
    const { user } = await renderApp('/login');
    await screen.findByRole('heading', { name: 'Log in' });
    await user.type(screen.getByLabelText('Username'), 'gal');
    await user.type(screen.getByLabelText('Password'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That username and password don’t match an account.',
    );
    expect(screen.getByLabelText('Password')).toHaveValue('');
    expect(screen.getByLabelText('Username')).toHaveValue('gal');
  });
});

const COMPLETE = {
  username: 'gal',
  email: 'gal@example.com',
  password: 'correct horse',
  confirm: 'correct horse',
};

describe('sign up', () => {
  beforeEach(() => {
    mocked.getMe.mockRejectedValue(signedOut());
  });

  async function fill(
    user: Awaited<ReturnType<typeof renderApp>>['user'],
    values: { username?: string; email?: string; password?: string; confirm?: string },
  ) {
    if (values.username) await user.type(screen.getByLabelText('Username'), values.username);
    if (values.email) await user.type(screen.getByLabelText('Email'), values.email);
    if (values.password) await user.type(screen.getByLabelText('Password'), values.password);
    if (values.confirm) await user.type(screen.getByLabelText('Confirm password'), values.confirm);
  }

  it('validates like the backend before submitting', async () => {
    const { user } = await renderApp('/register');
    await screen.findByRole('heading', { name: 'Create your account' });
    await fill(user, {
      username: 'no spaces',
      email: 'not-an-email',
      password: 'short',
      confirm: 'other',
    });
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(
      screen.getByText('Use only letters, numbers, “_” and “.” (no spaces).'),
    ).toBeInTheDocument();
    expect(screen.getByText('Enter an email address like name@example.com.')).toBeInTheDocument();
    expect(screen.getByText('Use at least 8 characters.')).toBeInTheDocument();
    expect(screen.getByText('Passwords don’t match.')).toBeInTheDocument();
    expect(screen.getByLabelText('Username')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(mocked.register).not.toHaveBeenCalled();
  });

  it('creates the account, logs in and lands on the empty vault', async () => {
    mocked.register.mockResolvedValue(GAL);
    const { user } = await renderApp('/register');
    await screen.findByRole('heading', { name: 'Create your account' });
    await fill(user, {
      username: 'gal',
      email: ' Gal@Example.com ',
      password: 'correct horse',
      confirm: 'correct horse',
    });
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(mocked.register).toHaveBeenCalledWith({
      username: 'gal',
      email: 'gal@example.com',
      password: 'correct horse',
      display_name: undefined,
    });
    expect(await screen.findByRole('region', { name: 'Your vault is empty' })).toBeInTheDocument();
    expect(screen.getByText('Welcome to Book Vault, Gal!')).toBeInTheDocument();
  });

  it('puts "username taken" (409) on the username field', async () => {
    mocked.register.mockRejectedValue(new ApiError(409, 'Username already taken', null));
    const { user } = await renderApp('/register');
    await screen.findByRole('heading', { name: 'Create your account' });
    await fill(user, COMPLETE);
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('That username is taken. Try another one.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Username')).toHaveFocus());
  });

  it('puts "email in use" (409) on the email field', async () => {
    mocked.register.mockRejectedValue(
      new ApiError(409, 'Email already in use by another account', null),
    );
    const { user } = await renderApp('/register');
    await screen.findByRole('heading', { name: 'Create your account' });
    await fill(user, COMPLETE);
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(
      await screen.findByText('That email is already used by another account.'),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Email')).toHaveFocus());
    expect(screen.getByLabelText('Username')).not.toHaveAttribute('aria-invalid');
  });

  it('maps a server 422 onto the matching field', async () => {
    mocked.register.mockRejectedValue(
      new ValidationError([
        {
          type: 'string_too_short',
          loc: ['body', 'password'],
          msg: 'String should have at least 8 characters',
        },
      ]),
    );
    const { user } = await renderApp('/register');
    await screen.findByRole('heading', { name: 'Create your account' });
    await fill(user, COMPLETE);
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('String should have at least 8 characters')).toBeInTheDocument();
  });
});

describe('logging out and losing the session', () => {
  it('logs out from the header', async () => {
    const { user } = await renderApp('/');
    await user.click(await screen.findByRole('button', { name: 'Log out' }));
    expect(mocked.logout).toHaveBeenCalled();
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(screen.getByText('You’ve been logged out.')).toBeInTheDocument();
  });

  it('goes to the login page with a notice when a request comes back 401', async () => {
    await renderApp('/books/new');
    await screen.findByRole('heading', { name: 'Add a book' });
    const handler = mocked.setUnauthorizedHandler.mock.calls.at(-1)?.[0];
    expect(handler).toBeTypeOf('function');

    act(() => handler?.());

    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(screen.getByText('Your session has ended. Please log in again.')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/login?next=%2Fbooks%2Fnew');
  });
});
