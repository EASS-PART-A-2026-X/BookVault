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
      trope: '',
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

describe('trope filter', () => {
  it('normalises the trope from the URL like the backend does', () => {
    expect(parseFilters(new URLSearchParams('trope=%20Enemies%20%20To%20Lovers%20')).trope).toBe(
      'enemies to lovers',
    );
  });

  it('ignores a trope longer than the backend allows', () => {
    expect(parseFilters(new URLSearchParams(`trope=${'x'.repeat(51)}`)).trope).toBe('');
  });

  it('is sent to the API and counts as an active filter', () => {
    const state = { ...EMPTY_FILTERS, trope: 'found family' };
    expect(toApiFilters(state)).toEqual({ trope: 'found family' });
    expect(hasActiveFilters(state)).toBe(true);
  });
});

describe('filtersToParams / toApiFilters', () => {
  it('round-trips through the URL and leaves out defaults', () => {
    const state = { genre: 'Mystery', read: 'read', minRating: 5, trope: 'locked room' } as const;
    expect(filtersToParams(state).toString()).toBe(
      'genre=Mystery&status=read&min_rating=5&trope=locked+room',
    );
    expect(parseFilters(filtersToParams(state))).toEqual(state);
    expect(filtersToParams(EMPTY_FILTERS).toString()).toBe('');
  });

  it('maps to API query params', () => {
    expect(toApiFilters({ genre: '', read: 'unread', minRating: null, trope: '' })).toEqual({
      is_read: false,
    });
    expect(toApiFilters(EMPTY_FILTERS)).toEqual({});
  });

  it('knows when filters are active', () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, minRating: 2 })).toBe(true);
  });
});
