/** Tropes: tag input on the form, chips on cards/detail, and the trope filter. */
import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeBook } from '../test/fixtures';
import { mocked, resetApiMocks, serverValidationError } from '../test/mockApi';
import { renderApp } from '../test/render';

vi.mock('../api/books', async () => (await import('../test/mockApiFactory')).default());

beforeEach(() => {
  resetApiMocks();
  mocked.listBooks.mockResolvedValue([]);
  mocked.listTropes.mockResolvedValue([
    { name: 'enemies to lovers', book_count: 2 },
    { name: 'found family', book_count: 1 },
  ]);
});

function chosen() {
  const list = screen.queryByRole('list', { name: 'Chosen tropes' });
  return list
    ? within(list)
        .getAllByRole('listitem')
        .map((li) => li.firstChild?.textContent)
    : [];
}

async function fillRequired(user: Awaited<ReturnType<typeof renderApp>>['user']) {
  await user.type(screen.getByLabelText('Title'), 'Pride and Prejudice');
  await user.type(screen.getByLabelText('Author'), 'Jane Austen');
  await user.selectOptions(screen.getByLabelText('Genre'), 'Romance');
}

describe('trope input', () => {
  it('adds with Enter or comma, normalises, ignores duplicates and blanks', async () => {
    const { user } = await renderApp('/books/new');
    const input = screen.getByLabelText(/^Tropes/);

    await user.type(input, '  Enemies   To Lovers {Enter}');
    await user.type(input, 'slow burn,');
    await user.type(input, 'ENEMIES TO LOVERS{Enter}');
    await user.type(input, '   {Enter}');

    expect(chosen()).toEqual(['enemies to lovers', 'slow burn']);
    expect(input).toHaveValue('');
    // Enter added a trope instead of submitting the form.
    expect(mocked.createBook).not.toHaveBeenCalled();
  });

  it('removes with × or Backspace on an empty input', async () => {
    const { user } = await renderApp('/books/new');
    const input = screen.getByLabelText(/^Tropes/);
    await user.type(input, 'a{Enter}b{Enter}c{Enter}');

    await user.click(screen.getByRole('button', { name: 'Remove trope b' }));
    expect(chosen()).toEqual(['a', 'c']);
    await user.type(input, '{Backspace}');
    expect(chosen()).toEqual(['a']);
  });

  it('suggests tropes already in the vault, minus the chosen ones', async () => {
    const { user, container } = await renderApp('/books/new');
    await waitFor(() => expect(container.querySelectorAll('datalist option')).toHaveLength(2));

    await user.type(screen.getByLabelText(/^Tropes/), 'found family{Enter}');
    const options = [...container.querySelectorAll('datalist option')].map((o) =>
      o.getAttribute('value'),
    );
    expect(options).toEqual(['enemies to lovers']);
  });

  it('sends the tropes, including one typed but not yet added', async () => {
    mocked.createBook.mockResolvedValue(makeBook());
    const { user } = await renderApp('/books/new');
    await fillRequired(user);
    await user.type(screen.getByLabelText(/^Tropes/), 'enemies to lovers{Enter}Slow Burn');
    await user.click(screen.getByRole('button', { name: 'Add book' }));

    expect(mocked.createBook).toHaveBeenCalledWith(
      expect.objectContaining({ tropes: ['enemies to lovers', 'slow burn'] }),
    );
  });

  it('shows a server 422 on tropes next to the trope field', async () => {
    mocked.createBook.mockRejectedValue(
      serverValidationError([
        {
          type: 'string_too_long',
          loc: ['body', 'tropes', 0],
          msg: 'String should have at most 50 characters',
        },
      ]),
    );
    const { user } = await renderApp('/books/new');
    await fillRequired(user);
    await user.type(screen.getByLabelText(/^Tropes/), 'heist{Enter}');
    await user.click(screen.getByRole('button', { name: 'Add book' }));

    const input = screen.getByLabelText(/^Tropes/);
    await waitFor(() => expect(input).toHaveAttribute('aria-invalid', 'true'));
    expect(screen.getByText('String should have at most 50 characters')).toBeInTheDocument();
  });

  it('edits the tropes of an existing book', async () => {
    const book = makeBook({ id: 2, title: 'Emma', tropes: ['matchmaking', 'slow burn'] });
    mocked.getBook.mockResolvedValue(book);
    mocked.updateBook.mockImplementation(
      async (_id, patch) => ({ ...book, ...patch }) as typeof book,
    );
    const { user } = await renderApp('/books/2');

    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(chosen()).toEqual(['matchmaking', 'slow burn']);
    await user.click(screen.getByRole('button', { name: 'Remove trope matchmaking' }));
    await user.type(screen.getByLabelText(/^Tropes/), 'friends to lovers{Enter}');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(mocked.updateBook).toHaveBeenCalledWith(
      2,
      expect.objectContaining({ tropes: ['slow burn', 'friends to lovers'] }),
    );
  });
});

describe('trope display', () => {
  it('shows up to three tropes on a card, then "+N more"', async () => {
    mocked.listBooks.mockResolvedValue([
      makeBook({ title: 'Busy', tropes: ['a', 'b', 'c', 'd', 'e'] }),
    ]);
    await renderApp('/');
    const card = (await screen.findByRole('link', { name: 'Busy' })).closest('article')!;
    const chips = within(within(card).getByRole('list', { name: 'Tropes' })).getAllByRole(
      'listitem',
    );
    expect(chips.map((c) => c.textContent)).toEqual(['a', 'b', 'c', '+2 more']);
  });

  it('links each trope on the detail page to the filtered list', async () => {
    mocked.getBook.mockResolvedValue(makeBook({ id: 3, tropes: ['found family'] }));
    await renderApp('/books/3');
    expect(await screen.findByRole('link', { name: 'found family' })).toHaveAttribute(
      'href',
      '/?trope=found%20family',
    );
  });
});

describe('trope filter', () => {
  it('lists tropes with counts and filters the books by the chosen one', async () => {
    const { user } = await renderApp('/');
    const select = screen.getByLabelText('Trope');
    await waitFor(() =>
      expect(
        within(select)
          .getAllByRole('option')
          .map((o) => o.textContent),
      ).toEqual(['All tropes', 'enemies to lovers (2)', 'found family (1)']),
    );

    await user.selectOptions(select, 'enemies to lovers');
    await waitFor(() =>
      expect(mocked.listBooks.mock.calls.at(-1)?.[0]).toEqual({ trope: 'enemies to lovers' }),
    );
    expect(screen.getByTestId('location')).toHaveTextContent('/?trope=enemies+to+lovers');
  });

  it('applies a trope from the URL (e.g. a link from a book page)', async () => {
    await renderApp('/?trope=found%20family&genre=Romance');
    await waitFor(() =>
      expect(mocked.listBooks.mock.calls.at(-1)?.[0]).toEqual({
        genre: 'Romance',
        trope: 'found family',
      }),
    );
    expect(screen.getByLabelText('Trope')).toHaveValue('found family');
  });

  it('keeps an unknown trope from the URL selectable and shows the no-match state', async () => {
    await renderApp('/?trope=time%20loop');
    expect(
      await screen.findByRole('region', { name: 'No books match these filters' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Trope')).toHaveValue('time loop');
  });
});
