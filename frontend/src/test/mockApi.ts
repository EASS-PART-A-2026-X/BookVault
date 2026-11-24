/**
 * Shared helpers for tests that mock the API client. Real error classes are kept
 * (ApiError, ValidationError, NetworkError) so components see exactly what the real
 * client would throw; only the request functions are replaced.
 *
 * vi.mock is hoisted above imports, so load the factory lazily:
 *   vi.mock('../api/books', async () => (await import('../test/mockApiFactory')).default());
 */
import { vi } from 'vitest';
import * as api from '../api/books';

const { setUnauthorizedHandler: actualSetUnauthorizedHandler } =
  await vi.importActual<typeof import('../api/books')>('../api/books');

export const mocked = {
  listBooks: vi.mocked(api.listBooks),
  getBook: vi.mocked(api.getBook),
  createBook: vi.mocked(api.createBook),
  updateBook: vi.mocked(api.updateBook),
  deleteBook: vi.mocked(api.deleteBook),
  listTropes: vi.mocked(api.listTropes),
  getMe: vi.mocked(api.getMe),
  login: vi.mocked(api.login),
  register: vi.mocked(api.register),
  logout: vi.mocked(api.logout),
  updateProfile: vi.mocked(api.updateProfile),
  searchUsers: vi.mocked(api.searchUsers),
  getProfile: vi.mocked(api.getProfile),
  getUserBooks: vi.mocked(api.getUserBooks),
  getFollowers: vi.mocked(api.getFollowers),
  getFollowing: vi.mocked(api.getFollowing),
  followUser: vi.mocked(api.followUser),
  unfollowUser: vi.mocked(api.unfollowUser),
  removeFollower: vi.mocked(api.removeFollower),
  listFollowRequests: vi.mocked(api.listFollowRequests),
  answerFollowRequest: vi.mocked(api.answerFollowRequest),
  setUnauthorizedHandler: vi.mocked(api.setUnauthorizedHandler),
};

/** A FastAPI-shaped 422, exactly as the real backend returns it. */
export function serverValidationError(issues: api.ValidationIssue[]) {
  return new api.ValidationError(issues);
}

export const READER = {
  id: 1,
  username: 'reader',
  display_name: 'Reader',
  bio: '',
  is_public: false,
  created_at: '2026-11-24T10:00:00',
};

/**
 * Reset every API mock and restore the defaults: logged in as "reader", no tropes,
 * logout succeeds. (vi.resetAllMocks wipes implementations, including these.)
 */
export function resetApiMocks() {
  vi.resetAllMocks();
  mocked.getMe.mockResolvedValue(READER);
  mocked.listTropes.mockResolvedValue([]);
  mocked.logout.mockResolvedValue(undefined);
  mocked.listFollowRequests.mockResolvedValue([]);
  mocked.setUnauthorizedHandler.mockImplementation(actualSetUnauthorizedHandler);
}
