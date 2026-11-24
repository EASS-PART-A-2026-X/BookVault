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

export const mocked = {
  listBooks: vi.mocked(api.listBooks),
  getBook: vi.mocked(api.getBook),
  createBook: vi.mocked(api.createBook),
  updateBook: vi.mocked(api.updateBook),
  deleteBook: vi.mocked(api.deleteBook),
  listTropes: vi.mocked(api.listTropes),
};

/** A FastAPI-shaped 422, exactly as the real backend returns it. */
export function serverValidationError(issues: api.ValidationIssue[]) {
  return new api.ValidationError(issues);
}
