import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeBook } from '../test/fixtures';
import { mocked, resetApiMocks } from '../test/mockApi';
import { renderApp } from '../test/render';

vi.mock('../api/books', async () => (await import('../test/mockApiFactory')).default());

const { listBooks, getBook, createBook, updateBook, deleteBook } = mocked;

beforeEach(() => {
  resetApiMocks();
});

describe('book list', () => {
  it('shows each book with genre, status and rating', async () => {
    listBooks.mockResolvedValue([
      makeBook({
        title: 'Dune',
        author: 'Frank Herbert',
        genre: 'Sci-Fi',
        rating: 5,
        is_read: true,
      }),
      makeBook({ title: 'Emma', author: 'Jane Austen', genre: 'Romance' }),
    ]);
    await renderApp('/');

    const dune = (await screen.findByRole('link', { name: 'Dune' })).closest('article')!;
    expect(within(dune).getByText('Frank Herbert')).toBeInTheDocument();
    expect(within(dune).getByText('Sci-Fi')).toBeInTheDocument();
    expect(within(dune).getByText('Read')).toBeInTheDocument();
    expect(within(dune).getByRole('img', { name: 'Rated 5 out of 5' })).toBeInTheDocument();

    const emma = screen.getByRole('link', { name: 'Emma' }).closest('article')!;
    expect(within(emma).getByText('Unread')).toBeInTheDocument();
    expect(within(emma).getByRole('img', { name: 'Not rated' })).toBeInTheDocument();
  });

  it('reads filters from the URL and writes changes back to it', async () => {
    listBooks.mockResolvedValue([]);
    const { user } = await renderApp('/?genre=Mystery&status=read');

    await waitFor(() => expect(listBooks).toHaveBeenCalled());
    expect(listBooks.mock.calls.at(-1)?.[0]).toEqual({ genre: 'Mystery', is_read: true });
    expect(screen.getByLabelText('Genre')).toHaveValue('Mystery');
    expect(screen.getByLabelText('Status')).toHaveValue('read');

    await user.selectOptions(screen.getByLabelText('Minimum rating'), '4');
    await waitFor(() =>
      expect(listBooks.mock.calls.at(-1)?.[0]).toEqual({
        genre: 'Mystery',
        is_read: true,
        min_rating: 4,
      }),
    );
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/?genre=Mystery&status=read&min_rating=4',
    );

    await user.click(
      within(screen.getByRole('search')).getByRole('button', { name: 'Clear filters' }),
    );
    await waitFor(() => expect(listBooks.mock.calls.at(-1)?.[0]).toEqual({}));
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/);
  });
});

describe('add book', () => {
  it('creates the book and returns to the refreshed list', async () => {
    const created = makeBook({
      title: 'Dune',
      author: 'Frank Herbert',
      genre: 'Sci-Fi',
      rating: 4,
    });
    createBook.mockResolvedValue(created);
    listBooks.mockResolvedValue([created]);
    const { user } = await renderApp('/books/new');

    await user.type(screen.getByLabelText('Title'), '  Dune ');
    await user.type(screen.getByLabelText('Author'), 'Frank Herbert');
    await user.selectOptions(screen.getByLabelText('Genre'), 'Sci-Fi');
    await user.click(screen.getByRole('button', { name: 'Rate 4 out of 5' }));
    await user.click(screen.getByRole('button', { name: 'Add book' }));

    expect(createBook).toHaveBeenCalledWith({
      title: 'Dune',
      author: 'Frank Herbert',
      genre: 'Sci-Fi',
      rating: 4,
      is_read: false,
      review: null,
      tropes: [],
    });
    expect(await screen.findByRole('link', { name: 'Dune' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/);
  });
});

describe('book detail', () => {
  it('marks as read and rates with quick actions', async () => {
    const book = makeBook({ id: 7, title: 'Dune' });
    getBook.mockResolvedValue(book);
    updateBook
      .mockResolvedValueOnce({ ...book, is_read: true })
      .mockResolvedValueOnce({ ...book, is_read: true, rating: 5 });
    const { user } = await renderApp('/books/7');

    await user.click(await screen.findByRole('button', { name: 'Mark as read' }));
    expect(updateBook).toHaveBeenLastCalledWith(7, { is_read: true });
    expect(await screen.findByRole('button', { name: 'Mark as unread' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Rate 5 out of 5' }));
    expect(updateBook).toHaveBeenLastCalledWith(7, { rating: 5 });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Rate 5 out of 5' })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    );
  });

  it('edits any field', async () => {
    const book = makeBook({ id: 3, title: 'Dnue', author: 'F. Herbert', genre: 'Sci-Fi' });
    getBook.mockResolvedValue(book);
    updateBook.mockImplementation(async (_id, patch) => ({ ...book, ...patch }) as typeof book);
    const { user } = await renderApp('/books/3');

    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    const title = screen.getByLabelText('Title');
    await user.clear(title);
    await user.type(title, 'Dune');
    await user.type(screen.getByLabelText(/^Review/), 'Spice!');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(updateBook).toHaveBeenCalledWith(
      3,
      expect.objectContaining({ title: 'Dune', review: 'Spice!' }),
    );
    expect(await screen.findByRole('heading', { level: 1, name: 'Dune' })).toBeInTheDocument();
    expect(screen.getByText('Spice!')).toBeInTheDocument();
  });

  it('asks in an in-app dialog before deleting', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    getBook.mockResolvedValue(makeBook({ id: 5, title: 'Emma' }));
    deleteBook.mockResolvedValue();
    listBooks.mockResolvedValue([]);
    const { user } = await renderApp('/books/5');

    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Delete this book?' });
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();

    // Escape cancels without deleting.
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(deleteBook).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
    );
    expect(deleteBook).toHaveBeenCalledWith(5);
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/));
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('shows the not-found page for an id that cannot exist, without calling the API', async () => {
    await renderApp('/books/abc');
    expect(screen.getByRole('heading', { name: 'Book not found' })).toBeInTheDocument();
    expect(getBook).not.toHaveBeenCalled();
  });
});
