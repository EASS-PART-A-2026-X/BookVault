import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, NetworkError, ValidationError } from '../api/books';
import { makeBook } from '../test/fixtures';
import { mocked, resetApiMocks } from '../test/mockApi';
import { renderApp } from '../test/render';
import type { AiSearchResult, SearchPlan } from '../types';

vi.mock('../api/books', async () => (await import('../test/mockApiFactory')).default());

const { askVault, listBooks } = mocked;

function plan(overrides: Partial<SearchPlan> = {}): SearchPlan {
  return {
    genre: null,
    read_status: null,
    min_rating: null,
    trope: null,
    text: null,
    explanation: 'Test plan.',
    ...overrides,
  };
}

function answer(overrides: Partial<SearchPlan> = {}, books = [makeBook()]): AiSearchResult {
  return { plan: plan(overrides), books };
}

beforeEach(() => {
  resetApiMocks();
  listBooks.mockResolvedValue([]);
});

describe('ask your vault', () => {
  it('is linked from the header', async () => {
    const { user } = await renderApp('/');
    await user.click(screen.getByRole('link', { name: 'Ask' }));
    expect(await screen.findByRole('heading', { name: 'Ask your vault' })).toBeInTheDocument();
  });

  it('shows what the AI understood and the matching books', async () => {
    askVault.mockResolvedValue(
      answer(
        {
          genre: 'Fantasy',
          read_status: 'unread',
          min_rating: 4,
          trope: 'found family',
          explanation: 'Unread fantasy tagged found family.',
        },
        [makeBook({ title: 'Legends & Lattes' }), makeBook({ title: 'The Hobbit' })],
      ),
    );
    const { user } = await renderApp('/ask');

    await user.type(screen.getByLabelText('Your question'), '  unread cozy fantasy  ');
    await user.click(screen.getByRole('button', { name: 'Ask' }));

    expect(await screen.findByText('Unread fantasy tagged found family.')).toBeInTheDocument();
    expect(askVault).toHaveBeenCalledWith('unread cozy fantasy', expect.any(AbortSignal));
    const understood = screen.getByRole('list', { name: 'Understood as' });
    expect(
      within(understood)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Fantasy', 'Unread', '4★ and up', 'Trope: found family']);
    const books = screen.getByRole('list', { name: 'Matching books' });
    expect(within(books).getByRole('link', { name: 'Legends & Lattes' })).toBeInTheDocument();
    expect(screen.getByText('2 books')).toBeInTheDocument();
  });

  it('opens the same search as list filters', async () => {
    askVault.mockResolvedValue(answer({ genre: 'Sci-Fi', read_status: 'read', min_rating: 5 }));
    const { user } = await renderApp('/ask');
    await user.type(screen.getByLabelText('Your question'), 'sci-fi I loved');
    await user.click(screen.getByRole('button', { name: 'Ask' }));

    await user.click(await screen.findByRole('link', { name: 'Open these filters in your list' }));
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/?genre=Sci-Fi&status=read&min_rating=5',
    );
  });

  it('offers no list link for an author search (not a list filter)', async () => {
    askVault.mockResolvedValue(answer({ text: 'tolkien' }));
    const { user } = await renderApp('/ask');
    await user.type(screen.getByLabelText('Your question'), 'my Tolkien books');
    await user.click(screen.getByRole('button', { name: 'Ask' }));

    expect(await screen.findByText('“tolkien”')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Open these filters/ })).not.toBeInTheDocument();
  });

  it('asks an example question with one click', async () => {
    askVault.mockResolvedValue(answer());
    const { user } = await renderApp('/ask');
    await user.click(screen.getByRole('button', { name: 'My favourite mysteries' }));
    expect(askVault).toHaveBeenCalledWith('My favourite mysteries', expect.any(AbortSignal));
    expect(screen.getByLabelText('Your question')).toHaveValue('My favourite mysteries');
  });

  it('says so when nothing matches', async () => {
    askVault.mockResolvedValue(answer({ genre: 'Historical' }, []));
    const { user } = await renderApp('/ask');
    await user.type(screen.getByLabelText('Your question'), 'historical novels');
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    expect(await screen.findByText('No books match')).toBeInTheDocument();
  });

  it('disables the form while asking', async () => {
    let finish: (value: AiSearchResult) => void = () => {};
    askVault.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const { user } = await renderApp('/ask');
    await user.type(screen.getByLabelText('Your question'), 'anything');
    await user.click(screen.getByRole('button', { name: 'Ask' }));

    expect(screen.getByRole('button', { name: 'Asking…' })).toBeDisabled();
    expect(screen.getByLabelText('Your question')).toBeDisabled();
    expect(screen.getByText('Asking the AI…')).toBeInTheDocument();
    finish(answer());
    expect(await screen.findByRole('button', { name: 'Ask' })).toBeEnabled();
  });
});

describe('ask your vault: errors', () => {
  it('rejects an empty question without calling the AI', async () => {
    const { user } = await renderApp('/ask');
    await user.type(screen.getByLabelText('Your question'), '   ');
    await user.click(screen.getByRole('button', { name: 'Ask' }));

    const input = screen.getByLabelText('Your question');
    expect(screen.getByText('Type a question first.')).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveFocus();
    expect(askVault).not.toHaveBeenCalled();
  });

  it.each([
    [504, 'The AI took too long to answer. Try again, or use the filters.'],
    [502, 'The AI provider failed to answer. Try again, or use the filters.'],
    [503, 'AI is not configured: set AI_MODEL (see .env.example)'],
  ])(
    "shows the AI service's own %i message, not 'can't reach the server'",
    async (status, detail) => {
      askVault.mockRejectedValue(new ApiError(status, detail, detail));
      const { user } = await renderApp('/ask');
      await user.type(screen.getByLabelText('Your question'), 'anything');
      await user.click(screen.getByRole('button', { name: 'Ask' }));

      const alert = await screen.findByRole('alert');
      expect(within(alert).getByText('AI search is unavailable')).toBeInTheDocument();
      expect(within(alert).getByText(detail)).toBeInTheDocument();
    },
  );

  it('retries the same question', async () => {
    askVault
      .mockRejectedValueOnce(new ApiError(504, 'Too slow', 'Too slow'))
      .mockResolvedValueOnce(answer({ explanation: 'Second time lucky.' }));
    const { user } = await renderApp('/ask');
    await user.type(screen.getByLabelText('Your question'), 'cozy books');
    await user.click(screen.getByRole('button', { name: 'Ask' }));

    await user.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Second time lucky.')).toBeInTheDocument();
    expect(askVault).toHaveBeenLastCalledWith('cozy books', expect.any(AbortSignal));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('treats no response at all as the server being unreachable', async () => {
    askVault.mockRejectedValue(new NetworkError());
    const { user } = await renderApp('/ask');
    await user.type(screen.getByLabelText('Your question'), 'anything');
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    expect(await screen.findByText("Can't reach the server")).toBeInTheDocument();
  });

  it('explains a server-side 422', async () => {
    askVault.mockRejectedValue(
      new ValidationError([
        { type: 'string_too_long', loc: ['body', 'question'], msg: 'too long' },
      ]),
    );
    const { user } = await renderApp('/ask');
    await user.type(screen.getByLabelText('Your question'), 'x');
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    expect(await screen.findByText('Ask a question of up to 300 characters.')).toBeInTheDocument();
  });

  it('caps the question at the service limit', async () => {
    await renderApp('/ask');
    expect(screen.getByLabelText('Your question')).toHaveAttribute('maxLength', '300');
  });
});
