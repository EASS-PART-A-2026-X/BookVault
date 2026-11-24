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
  };
}
