import { describe, expect, it } from 'vitest';
import {
  EMPTY_FILTERS,
  filtersToParams,
  hasActiveFilters,
  parseFilters,
  toApiFilters,
} from './filters';

describe('parseFilters', () => {
  it('reads valid values', () => {
    expect(parseFilters(new URLSearchParams('genre=Sci-Fi&status=unread&min_rating=3'))).toEqual({
      genre: 'Sci-Fi',
      read: 'unread',
      minRating: 3,
    });
  });

  it.each([
    'genre=Horror',
    'status=maybe',
    'min_rating=0',
    'min_rating=6',
    'min_rating=4.5',
    'min_rating=abc',
  ])('ignores invalid %s', (query) => {
    expect(parseFilters(new URLSearchParams(query))).toEqual(EMPTY_FILTERS);
  });
});

describe('filtersToParams / toApiFilters', () => {
  it('round-trips through the URL and leaves out defaults', () => {
    const state = { genre: 'Mystery', read: 'read', minRating: 5 } as const;
    expect(filtersToParams(state).toString()).toBe('genre=Mystery&status=read&min_rating=5');
    expect(parseFilters(filtersToParams(state))).toEqual(state);
    expect(filtersToParams(EMPTY_FILTERS).toString()).toBe('');
  });

  it('maps to API query params', () => {
    expect(toApiFilters({ genre: '', read: 'unread', minRating: null })).toEqual({
      is_read: false,
    });
    expect(toApiFilters(EMPTY_FILTERS)).toEqual({});
  });

  it('knows when filters are active', () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, minRating: 2 })).toBe(true);
  });
});
