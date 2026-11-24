/**
 * Page-level states: empty vault, no filter matches, backend unreachable,
 * server errors, and book-not-found. The API client is mocked.
 */
import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, NetworkError } from '../api/books';
import { makeBook } from '../test/fixtures';
import { mocked, resetApiMocks } from '../test/mockApi';
import { renderApp } from '../test/render';

vi.mock('../api/books', async () => (await import('../test/mockApiFactory')).default());

beforeEach(() => resetApiMocks());

const networkDown = () => new NetworkError(new TypeError('Failed to fetch'));

describe('empty states', () => {
  it('shows the empty-vault state with a call to action when there are no books', async () => {
    mocked.listBooks.mockResolvedValue([]);
    await renderApp('/');

    const empty = await screen.findByRole('region', { name: 'Your vault is empty' });
    expect(within(empty).getByRole('link', { name: 'Add your first book' })).toHaveAttribute(
      'href',
      '/books/new',
    );
    expect(screen.queryByText('No books match these filters')).not.toBeInTheDocument();
  });

  it('shows a separate "no matches" state with a working clear-filters button', async () => {
    mocked.listBooks.mockImplementation(async (filters = {}) =>
      Object.keys(filters).length > 0 ? [] : [makeBook({ title: 'Dune' })],
    );
    const { user } = await renderApp('/?genre=Mystery');

    const empty = await screen.findByRole('region', { name: 'No books match these filters' });
    expect(screen.queryByText('Your vault is empty')).not.toBeInTheDocument();

    await user.click(within(empty).getByRole('button', { name: 'Clear filters' }));
    expect(await screen.findByRole('link', { name: 'Dune' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/);
  });
});

describe('loading state', () => {
  it('shows a loading indicator until the list arrives', async () => {
    let resolve!: (books: never[]) => void;
    mocked.listBooks.mockReturnValue(new Promise((r) => (resolve = r)));
    await renderApp('/');

    expect(screen.getByRole('status')).toHaveTextContent('Loading books…');
    resolve([]);
    await waitFor(() => expect(screen.queryByText('Loading books…')).not.toBeInTheDocument());
  });
});

describe('network-error banner', () => {
  it('shows a banner with Retry when the backend is unreachable, and recovers', async () => {
    mocked.listBooks
      .mockRejectedValueOnce(networkDown())
      .mockResolvedValueOnce([makeBook({ title: 'Dune' })]);
    const { user } = await renderApp('/');

    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent("Can't reach the server");
    expect(banner).toHaveTextContent('Check that the backend is running');
    // The page still works around the banner: no blank screen.
    expect(screen.getByRole('heading', { name: 'Your books' })).toBeInTheDocument();
    expect(screen.getByRole('search', { name: 'Filter books' })).toBeInTheDocument();

    await user.click(within(banner).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('link', { name: 'Dune' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(mocked.listBooks).toHaveBeenCalledTimes(2);
  });

  it('keeps the banner (as "Retrying…") while a retry is in flight', async () => {
    mocked.listBooks
      .mockRejectedValueOnce(networkDown())
      .mockReturnValueOnce(new Promise(() => {}));
    const { user } = await renderApp('/');

    await user.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(screen.getByRole('button', { name: 'Retrying…' })).toBeDisabled();
  });

  it('explains a server error (5xx) the same way', async () => {
    mocked.listBooks.mockRejectedValue(new ApiError(503, 'Database unavailable', null));
    await renderApp('/');
    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent('The server ran into a problem');
    expect(within(banner).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('shows the banner on the detail page too', async () => {
    mocked.getBook.mockRejectedValue(networkDown());
    await renderApp('/books/1');
    expect(await screen.findByRole('alert')).toHaveTextContent("Can't reach the server");
    expect(screen.getByRole('link', { name: '← Back to books' })).toBeInTheDocument();
  });
});

describe('not found', () => {
  it('shows "Book not found" when the API returns 404', async () => {
    mocked.getBook.mockRejectedValue(new ApiError(404, 'Book not found', 'Book not found'));
    await renderApp('/books/9999');

    expect(await screen.findByRole('heading', { name: 'Book not found' })).toBeInTheDocument();
    expect(screen.getByText(/no book with id 9999/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to your books' })).toHaveAttribute('href', '/');
  });

  it('shows the not-found page when the book was deleted elsewhere', async () => {
    mocked.getBook.mockResolvedValue(makeBook({ id: 4, title: 'Gone' }));
    mocked.updateBook.mockRejectedValue(new ApiError(404, 'Book not found', 'Book not found'));
    const { user } = await renderApp('/books/4');

    await user.click(await screen.findByRole('button', { name: 'Mark as read' }));
    expect(await screen.findByRole('heading', { name: 'Book not found' })).toBeInTheDocument();
  });

  it('shows "Page not found" for unknown routes', async () => {
    await renderApp('/nope/nothing-here');
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });
});
