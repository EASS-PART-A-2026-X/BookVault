/** People search, profiles (public / private / requested / following), requests, settings. */
import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, NetworkError } from '../api/books';
import { makeBook } from '../test/fixtures';
import { READER, mocked, resetApiMocks } from '../test/mockApi';
import { renderApp } from '../test/render';
import type { Profile, UserSummary } from '../types';

vi.mock('../api/books', async () => (await import('../test/mockApiFactory')).default());

const ALICE: UserSummary = {
  username: 'alice',
  display_name: 'Alice Austen',
  is_public: false,
  follow_status: 'none',
};
const BOB: UserSummary = {
  username: 'bob',
  display_name: 'Bob',
  is_public: true,
  follow_status: 'none',
};

function profile(overrides: Partial<Profile> = {}): Profile {
  return {
    ...ALICE,
    bio: 'Regency romance and village mysteries.',
    created_at: '2026-11-01T10:00:00',
    book_count: 3,
    follower_count: 2,
    following_count: 1,
    can_view_books: false,
    follows_you: false,
    ...overrides,
  };
}

beforeEach(() => {
  resetApiMocks();
  mocked.listBooks.mockResolvedValue([]);
});

describe('people search', () => {
  it('searches as you type (debounced), keeps the query in the URL, and lists people', async () => {
    mocked.searchUsers.mockResolvedValue([ALICE, BOB]);
    const { user } = await renderApp('/people');
    expect(screen.getByRole('region', { name: 'Discover other readers' })).toBeInTheDocument();

    await user.type(screen.getByLabelText('Search people'), 'Al');
    await waitFor(() => expect(mocked.searchUsers).toHaveBeenCalledWith('Al', expect.anything()));
    expect(mocked.searchUsers).toHaveBeenCalledTimes(1); // one request for both keystrokes
    expect(screen.getByTestId('location')).toHaveTextContent('/people?q=Al');

    const list = await screen.findByRole('list', { name: 'People' });
    const alice = within(list)
      .getByRole('link', { name: /Alice Austen/ })
      .closest('li')!;
    expect(alice).toHaveTextContent('@alice · Private');
    expect(within(alice).getByRole('button', { name: 'Request to follow' })).toBeInTheDocument();
    const bob = within(list).getByRole('link', { name: /Bob/ }).closest('li')!;
    expect(within(bob).getByRole('button', { name: 'Follow' })).toBeInTheDocument();
  });

  it('shows a no-results state and a retry banner on network errors', async () => {
    mocked.searchUsers.mockRejectedValueOnce(new NetworkError()).mockResolvedValueOnce([]);
    const { user } = await renderApp('/people?q=zed');
    const banner = await screen.findByRole('alert');
    await user.click(within(banner).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('region', { name: 'No one matches “zed”' })).toBeInTheDocument();
  });

  it('follows a public profile straight from the results', async () => {
    mocked.searchUsers.mockResolvedValue([BOB]);
    mocked.followUser.mockResolvedValue('following');
    const { user } = await renderApp('/people?q=bob');
    await user.click(await screen.findByRole('button', { name: 'Follow' }));
    expect(mocked.followUser).toHaveBeenCalledWith('bob');
    expect(
      await screen.findByRole('button', { name: 'Following. Unfollow Bob' }),
    ).toBeInTheDocument();
    expect(screen.getByText('You’re following Bob.')).toBeInTheDocument();
  });

  it('marks yourself instead of offering a follow button', async () => {
    mocked.searchUsers.mockResolvedValue([
      { username: 'reader', display_name: 'Reader', is_public: false, follow_status: 'self' },
    ]);
    await renderApp('/people?q=reader');
    const list = await screen.findByRole('list', { name: 'People' });
    const row = within(list)
      .getByRole('link', { name: /Reader/ })
      .closest('li')!;
    expect(within(row).getByText('You')).toBeInTheDocument();
    expect(within(row).queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('profile page', () => {
  it('locks a private profile: name, bio and counts but no books', async () => {
    mocked.getProfile.mockResolvedValue(profile());
    await renderApp('/u/alice');

    expect(
      await screen.findByRole('heading', { name: 'Alice Austen', level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByText('Regency romance and village mysteries.')).toBeInTheDocument();
    expect(screen.getByText('Private')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'This profile is private' })).toBeInTheDocument();
    expect(mocked.getUserBooks).not.toHaveBeenCalled();
    // Counts are shown but not clickable.
    expect(screen.queryByRole('button', { name: '3 Books' })).not.toBeInTheDocument();
  });

  it('sends a request, then shows it as pending', async () => {
    mocked.getProfile
      .mockResolvedValueOnce(profile())
      .mockResolvedValueOnce(profile({ follow_status: 'requested' }));
    mocked.followUser.mockResolvedValue('requested');
    const { user } = await renderApp('/u/alice');

    await user.click(await screen.findByRole('button', { name: 'Request to follow' }));
    expect(mocked.followUser).toHaveBeenCalledWith('alice');
    expect(await screen.findByText(/Your request is waiting for Alice Austen/)).toBeInTheDocument();
    expect(screen.getByText('Request sent to Alice Austen.')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Requested. Cancel your request to follow Alice Austen' }),
    ).toBeInTheDocument();
  });

  it('shows books and reviews once you can see them, and lists followers', async () => {
    mocked.getProfile.mockResolvedValue(
      profile({ follow_status: 'following', can_view_books: true, follows_you: true }),
    );
    mocked.getUserBooks.mockResolvedValue([
      makeBook({
        title: 'Emma',
        review: 'Meddling, but charming.',
        rating: 4,
        tropes: ['matchmaking'],
      }),
    ]);
    mocked.getFollowers.mockResolvedValue([{ ...BOB, follow_status: 'none' }]);
    const { user } = await renderApp('/u/alice');

    const books = await screen.findByRole('region', { name: 'Alice Austen’s books' });
    expect(within(books).getByRole('heading', { name: 'Emma' })).toBeInTheDocument();
    expect(within(books).getByText('Meddling, but charming.')).toBeInTheDocument();
    expect(within(books).getByRole('img', { name: 'Rated 4 out of 5' })).toBeInTheDocument();
    expect(screen.getByText('Follows you')).toBeInTheDocument();
    // Read-only: no edit links into someone else's books.
    expect(within(books).queryByRole('link')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '2 Followers' }));
    const followers = await screen.findByRole('list', { name: 'Followers' });
    expect(within(followers).getByText('@bob')).toBeInTheDocument();
  });

  it('asks before unfollowing a private profile', async () => {
    mocked.getProfile.mockResolvedValue(
      profile({ follow_status: 'following', can_view_books: true }),
    );
    mocked.getUserBooks.mockResolvedValue([]);
    mocked.unfollowUser.mockResolvedValue();
    const { user } = await renderApp('/u/alice');

    await user.click(
      await screen.findByRole('button', { name: 'Following. Unfollow Alice Austen' }),
    );
    const dialog = screen.getByRole('alertdialog', { name: 'Unfollow Alice Austen?' });
    expect(mocked.unfollowUser).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Unfollow' }));
    expect(mocked.unfollowUser).toHaveBeenCalledWith('alice');
  });

  it('offers "Edit profile" on your own profile and lets you remove followers', async () => {
    mocked.getProfile.mockResolvedValue(
      profile({ ...READER, follow_status: 'self', can_view_books: true, follower_count: 1 }),
    );
    mocked.getUserBooks.mockResolvedValue([]);
    mocked.getFollowers.mockResolvedValue([BOB]);
    mocked.removeFollower.mockResolvedValue();
    const { user } = await renderApp('/u/reader');

    expect(await screen.findByRole('link', { name: 'Edit profile' })).toHaveAttribute(
      'href',
      '/settings',
    );
    expect(screen.getByRole('region', { name: 'No books yet' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '1 Followers' }));
    await user.click(await screen.findByRole('button', { name: 'Remove' }));
    expect(mocked.removeFollower).toHaveBeenCalledWith('bob');
    expect(await screen.findByText('Removed Bob from your followers.')).toBeInTheDocument();
  });

  it('shows "Reader not found" for unknown usernames', async () => {
    mocked.getProfile.mockRejectedValue(new ApiError(404, 'User not found', 'User not found'));
    await renderApp('/u/ghost');
    expect(await screen.findByRole('heading', { name: 'Reader not found' })).toBeInTheDocument();
  });
});

describe('follow requests', () => {
  it('shows a badge in the header and lets you accept or decline', async () => {
    const requests = [
      { username: 'bob', display_name: 'Bob', requested_at: '2026-11-24T09:00:00' },
      { username: 'carol', display_name: 'Carol', requested_at: '2026-11-24T10:00:00' },
    ];
    mocked.listFollowRequests.mockResolvedValue(requests);
    mocked.answerFollowRequest.mockResolvedValue();
    const { user } = await renderApp('/requests');

    expect(await screen.findByRole('link', { name: 'Requests (2 waiting)' })).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Accept Bob' }));
    expect(mocked.answerFollowRequest).toHaveBeenCalledWith('bob', 'accept');
    expect(await screen.findByText('Bob can now see your books.')).toBeInTheDocument();

    mocked.listFollowRequests.mockResolvedValue([]);
    await user.click(screen.getByRole('button', { name: 'Decline Carol' }));
    expect(mocked.answerFollowRequest).toHaveBeenCalledWith('carol', 'decline');
    expect(
      await screen.findByRole('region', { name: 'No requests right now' }),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('link', { name: 'Requests' })).toBeInTheDocument());
  });
});

describe('settings', () => {
  it('saves display name, bio and going public', async () => {
    mocked.updateProfile.mockResolvedValue({
      ...READER,
      display_name: 'Reader R.',
      bio: 'Hi',
      is_public: true,
    });
    const { user } = await renderApp('/settings');
    const save = screen.getByRole('button', { name: 'Save profile' });
    expect(save).toBeDisabled(); // nothing changed yet

    await user.clear(screen.getByLabelText('Display name'));
    await user.type(screen.getByLabelText('Display name'), 'Reader R.');
    await user.type(screen.getByLabelText(/^Bio/), 'Hi');
    await user.click(screen.getByRole('radio', { name: /Public/ }));
    await user.click(save);

    expect(mocked.updateProfile).toHaveBeenCalledWith({
      display_name: 'Reader R.',
      bio: 'Hi',
      is_public: true,
    });
    expect(
      await screen.findByText('Profile saved. It’s public now: pending requests were accepted.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Reader R.' })).toBeInTheDocument(); // header updated
  });

  it('requires a display name', async () => {
    const { user } = await renderApp('/settings');
    await user.clear(screen.getByLabelText('Display name'));
    await user.click(screen.getByRole('button', { name: 'Save profile' }));
    expect(screen.getByText('Display name can’t be empty.')).toBeInTheDocument();
    expect(mocked.updateProfile).not.toHaveBeenCalled();
  });
});
