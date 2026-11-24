/**
 * Add-book form: client-side validation and rendering of server 422 errors.
 * The API client is mocked; the page, form and error mapping are real.
 */
import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NetworkError } from '../api/books';
import { mocked, resetApiMocks, serverValidationError } from '../test/mockApi';
import { makeBook } from '../test/fixtures';
import { renderApp } from '../test/render';

vi.mock('../api/books', async () => (await import('../test/mockApiFactory')).default());

beforeEach(() => {
  resetApiMocks();
  mocked.listBooks.mockResolvedValue([]);
});

async function fillValidBook(user: Awaited<ReturnType<typeof renderApp>>['user']) {
  await user.type(screen.getByLabelText('Title'), 'Dune');
  await user.type(screen.getByLabelText('Author'), 'Frank Herbert');
  await user.selectOptions(screen.getByLabelText('Genre'), 'Sci-Fi');
}

function errorFor(label: string | RegExp) {
  const control = screen.getByLabelText(label);
  const id = control.getAttribute('aria-describedby');
  return id ? document.getElementById(id)?.textContent : null;
}

describe('client-side validation', () => {
  it('shows every problem inline, focuses the first, and does not call the API', async () => {
    const { user } = await renderApp('/books/new');

    await user.click(screen.getByRole('button', { name: 'Add book' }));

    expect(errorFor('Title')).toBe('Title is required.');
    expect(errorFor('Author')).toBe('Author is required.');
    expect(errorFor('Genre')).toBe('Choose a genre.');
    expect(screen.getByLabelText('Title')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Title')).toHaveFocus();
    expect(mocked.createBook).not.toHaveBeenCalled();
  });

  it('rejects whitespace-only title and author, like the backend', async () => {
    const { user } = await renderApp('/books/new');
    await user.type(screen.getByLabelText('Title'), '   ');
    await user.type(screen.getByLabelText('Author'), '\t ');
    await user.selectOptions(screen.getByLabelText('Genre'), 'Fantasy');
    await user.click(screen.getByRole('button', { name: 'Add book' }));

    expect(errorFor('Title')).toBe('Title is required.');
    expect(errorFor('Author')).toBe('Author is required.');
    expect(mocked.createBook).not.toHaveBeenCalled();
  });

  it('validates a field when it loses focus and clears the error once fixed', async () => {
    const { user } = await renderApp('/books/new');
    const title = screen.getByLabelText('Title');

    await user.click(title);
    await user.tab();
    expect(errorFor('Title')).toBe('Title is required.');
    // Untouched fields stay quiet.
    expect(errorFor('Genre')).toBeNull();

    await user.type(title, 'D');
    expect(errorFor('Title')).toBeNull();
    expect(title).not.toHaveAttribute('aria-invalid');
  });

  it('submits once everything is valid', async () => {
    mocked.createBook.mockResolvedValue(makeBook({ title: 'Dune' }));
    const { user } = await renderApp('/books/new');
    await fillValidBook(user);
    await user.click(screen.getByRole('button', { name: 'Add book' }));

    expect(mocked.createBook).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Added “Dune” to your vault.')).toBeInTheDocument();
  });
});

describe('server 422 errors', () => {
  it('shows each FastAPI detail message next to the matching field', async () => {
    mocked.createBook.mockRejectedValue(
      serverValidationError([
        {
          type: 'string_too_short',
          loc: ['body', 'author'],
          msg: 'String should have at least 1 character',
        },
        {
          type: 'enum',
          loc: ['body', 'genre'],
          msg: "Input should be 'Fantasy', 'Romance', 'Sci-Fi', 'Thriller', 'Non-Fiction', 'Mystery' or 'Historical'",
        },
        {
          type: 'less_than_equal',
          loc: ['body', 'rating'],
          msg: 'Input should be less than or equal to 5',
        },
      ]),
    );
    const { user } = await renderApp('/books/new');
    await fillValidBook(user);
    await user.click(screen.getByRole('button', { name: 'Add book' }));

    expect(await screen.findByText('Input should be less than or equal to 5')).toBeInTheDocument();
    expect(errorFor('Author')).toBe('String should have at least 1 character');
    expect(errorFor('Genre')).toMatch(/^Input should be 'Fantasy'/);
    expect(screen.getByRole('group', { name: 'Rating' })).toHaveAttribute('aria-invalid', 'true');
    expect(errorFor('Title')).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The server rejected some fields. Check the messages below.',
    );
    // Focus goes to the first field the server rejected.
    await waitFor(() => expect(screen.getByLabelText('Author')).toHaveFocus());
    // The user stays on the form with their input intact.
    expect(screen.getByLabelText('Title')).toHaveValue('Dune');
  });

  it('maps the model-level "cannot be null" error and lists unplaceable ones', async () => {
    mocked.createBook.mockRejectedValue(
      serverValidationError([
        { type: 'value_error', loc: ['body'], msg: 'Value error, title cannot be null' },
        { type: 'extra_forbidden', loc: ['body', 'isbn'], msg: 'Extra inputs are not permitted' },
      ]),
    );
    const { user } = await renderApp('/books/new');
    await fillValidBook(user);
    await user.click(screen.getByRole('button', { name: 'Add book' }));

    expect(await screen.findByText('Title cannot be null')).toBeInTheDocument();
    expect(errorFor('Title')).toBe('Title cannot be null');
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('The server rejected this book:');
    expect(alert).toHaveTextContent('Extra inputs are not permitted');
  });

  it('shows a clear message when the server cannot be reached while saving', async () => {
    mocked.createBook.mockRejectedValue(new NetworkError(new TypeError('Failed to fetch')));
    const { user } = await renderApp('/books/new');
    await fillValidBook(user);
    await user.click(screen.getByRole('button', { name: 'Add book' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Can't reach the server.");
    expect(alert).toHaveTextContent('Your changes have not been saved.');
    expect(screen.getByLabelText('Title')).toHaveValue('Dune');
    expect(screen.getByRole('button', { name: 'Add book' })).toBeEnabled();
  });
});

describe('regression: blur error must not swallow the Save click', () => {
  it('pressing Save keeps focus in the field, so no blur error shifts the button', async () => {
    const { user } = await renderApp('/books/new');
    const title = screen.getByLabelText('Title');
    await user.type(title, 'x');
    await user.clear(title);
    // Press (not click) the button: before the fix this blurred Title and inserted
    // "Title is required." above the button before mouseup.
    await user.pointer({
      keys: '[MouseLeft>]',
      target: screen.getByRole('button', { name: 'Add book' }),
    });
    expect(title).toHaveFocus();
    expect(errorFor('Title')).toBeNull();
    await user.pointer({ keys: '[/MouseLeft]' });
    // The click went through: submit validated and focused the first problem.
    expect(errorFor('Title')).toBe('Title is required.');
    expect(errorFor('Genre')).toBe('Choose a genre.');
    expect(title).toHaveFocus();
  });
});

describe('regression: server errors survive focus moving between fields', () => {
  it('leaving a field the server rejected does not erase its message; editing it does', async () => {
    mocked.createBook.mockRejectedValue(
      serverValidationError([
        { type: 'enum', loc: ['body', 'genre'], msg: 'Input should be a valid genre' },
      ]),
    );
    const { user } = await renderApp('/books/new');
    await fillValidBook(user);
    await user.click(screen.getByRole('button', { name: 'Add book' }));
    await waitFor(() => expect(screen.getByLabelText('Genre')).toHaveFocus());
    expect(errorFor('Genre')).toBe('Input should be a valid genre');

    await user.tab(); // blur Genre
    expect(errorFor('Genre')).toBe('Input should be a valid genre');

    await user.selectOptions(screen.getByLabelText('Genre'), 'Mystery');
    expect(errorFor('Genre')).toBeNull();
  });
});
