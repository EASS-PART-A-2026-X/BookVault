/** Book list filters <-> URL query string <-> API query. Kept pure so it's easy to test. */
import { MAX_RATING, MIN_RATING, isGenre, type BookFilters, type Genre } from '../types';

export type ReadFilter = 'all' | 'read' | 'unread';

export interface FilterState {
  genre: Genre | '';
  read: ReadFilter;
  minRating: number | null;
}

export const EMPTY_FILTERS: FilterState = { genre: '', read: 'all', minRating: null };

/** URL parameter names. */
export const PARAM = { genre: 'genre', read: 'status', minRating: 'min_rating' } as const;

/** Read filters from the URL. Unknown or out-of-range values are ignored, not sent. */
export function parseFilters(params: URLSearchParams): FilterState {
  const genre = params.get(PARAM.genre);
  const read = params.get(PARAM.read);
  const rawRating = params.get(PARAM.minRating);
  const rating = rawRating !== null && /^\d+$/.test(rawRating) ? Number(rawRating) : NaN;
  return {
    genre: isGenre(genre) ? genre : '',
    read: read === 'read' || read === 'unread' ? read : 'all',
    minRating: rating >= MIN_RATING && rating <= MAX_RATING ? rating : null,
  };
}

/** Write filters to the URL, leaving out defaults so a clean list has a clean URL. */
export function filtersToParams(filters: FilterState): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.genre) params.set(PARAM.genre, filters.genre);
  if (filters.read !== 'all') params.set(PARAM.read, filters.read);
  if (filters.minRating !== null) params.set(PARAM.minRating, String(filters.minRating));
  return params;
}

export function toApiFilters(filters: FilterState): BookFilters {
  const api: BookFilters = {};
  if (filters.genre) api.genre = filters.genre;
  if (filters.read !== 'all') api.is_read = filters.read === 'read';
  if (filters.minRating !== null) api.min_rating = filters.minRating;
  return api;
}

export function hasActiveFilters(filters: FilterState): boolean {
  return filters.genre !== '' || filters.read !== 'all' || filters.minRating !== null;
}
