import type { Book } from '../types';

let nextId = 1;

export function makeBook(overrides: Partial<Book> = {}): Book {
  const id = overrides.id ?? nextId++;
  return {
    id,
    title: `Book ${id}`,
    author: 'Some Author',
    genre: 'Fantasy',
    rating: null,
    is_read: false,
    review: null,
    created_at: '2026-11-24T10:00:00.000000',
    updated_at: '2026-11-24T10:00:00.000000',
    ...overrides,
  };
}
