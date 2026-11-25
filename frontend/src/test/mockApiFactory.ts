import { vi } from 'vitest';

/** vi.mock factory for src/api/books.ts: real module, request functions replaced. */
export default async function mockApiModule() {
  const actual = await vi.importActual<typeof import('../api/books')>('../api/books');
  return {
    ...actual,
    listBooks: vi.fn(),
    getBook: vi.fn(),
    createBook: vi.fn(),
    updateBook: vi.fn(),
    deleteBook: vi.fn(),
    // Pages load trope suggestions; default to none so tests needn't care.
    listTropes: vi.fn(async () => []),
    // Logged in as "reader" unless a test says otherwise.
    getMe: vi.fn(async () => ({
      id: 1,
      username: 'reader',
      display_name: 'Reader',
      bio: '',
      is_public: false,
      created_at: '2026-11-24T10:00:00',
    })),
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(async () => undefined),
    updateProfile: vi.fn(),
    searchUsers: vi.fn(),
    getProfile: vi.fn(),
    getUserBooks: vi.fn(),
    getFollowers: vi.fn(),
    getFollowing: vi.fn(),
    followUser: vi.fn(),
    unfollowUser: vi.fn(),
    removeFollower: vi.fn(),
    listFollowRequests: vi.fn(),
    answerFollowRequest: vi.fn(),
    askVault: vi.fn(),
    // Real behaviour, but spied, so tests can grab and fire the 401 handler.
    setUnauthorizedHandler: vi.fn(actual.setUnauthorizedHandler),
  };
}
