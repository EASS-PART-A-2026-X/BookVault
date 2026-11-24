import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_FORM } from '../lib/bookForm';
import { BookForm } from './BookForm';
import { ErrorBoundary } from './ErrorBoundary';

function Boom(): never {
  throw new Error('kaboom');
}

describe('ErrorBoundary', () => {
  // React re-reports caught render errors to window in dev; keep the test output clean.
  const swallow = (event: ErrorEvent) => event.preventDefault();
  beforeEach(() => window.addEventListener('error', swallow));
  afterEach(() => window.removeEventListener('error', swallow));

  it('shows a fallback instead of a blank page when a child crashes', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <MemoryRouter>
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument();
    expect(screen.getByText('kaboom')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to your books' })).toHaveAttribute('href', '/');
  });

  it('resets when the resetKey changes (e.g. navigating away)', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { rerender } = render(
      <ErrorBoundary resetKey="/a">
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    rerender(
      <ErrorBoundary resetKey="/b">
        <p>Fine now</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('Fine now')).toBeInTheDocument();
  });
});

describe('BookForm while saving', () => {
  it('disables every control and ignores a second submit', async () => {
    const user = userEvent.setup();
    let finish!: () => void;
    const onSubmit = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    render(
      <BookForm
        initialValues={{ ...EMPTY_FORM, title: 'Dune', author: 'Frank Herbert', genre: 'Sci-Fi' }}
        submitLabel="Add book"
        submittingLabel="Adding…"
        onSubmit={onSubmit}
      />,
    );

    const submit = screen.getByRole('button', { name: 'Add book' });
    await user.click(submit);
    expect(screen.getByRole('button', { name: 'Adding…' })).toBeDisabled();
    expect(screen.getByLabelText('Title')).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Adding…');

    await user.click(screen.getByRole('button', { name: 'Adding…' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);

    finish();
    expect(await screen.findByRole('button', { name: 'Add book' })).toBeEnabled();
  });
});
