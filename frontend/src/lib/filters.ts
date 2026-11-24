/** Book list filters <-> URL query string <-> API query. Kept pure so it's easy to test. */
import {
  MAX_RATING,
  MIN_RATING,
  TROPE_MAX_LENGTH,
  isGenre,
  normalizeTrope,
  type BookFilters,
  type Genre,
} from '../types';

export type ReadFilter = 'all' | 'read' | 'unread';

export interface FilterState {
  genre: Genre | '';
  read: ReadFilter;
  minRating: number | null;
  /** Normalised trope name, or '' for any. */
  trope: string;
}

export const EMPTY_FILTERS: FilterState = { genre: '', read: 'all', minRating: null, trope: '' };

/** URL parameter names. */
export const PARAM = {
  genre: 'genre',
  read: 'status',
  minRating: 'min_rating',
  trope: 'trope',
} as const;

/** Read filters from the URL. Unknown or out-of-range values are ignored, not sent. */
export function parseFilters(params: URLSearchParams): FilterState {
  const genre = params.get(PARAM.genre);
  const read = params.get(PARAM.read);
  const rawRating = params.get(PARAM.minRating);
  const rating = rawRating !== null && /^\d+$/.test(rawRating) ? Number(rawRating) : NaN;
  const trope = normalizeTrope(params.get(PARAM.trope) ?? '');
  return {
    genre: isGenre(genre) ? genre : '',
    read: read === 'read' || read === 'unread' ? read : 'all',
    minRating: rating >= MIN_RATING && rating <= MAX_RATING ? rating : null,
    trope: trope.length <= TROPE_MAX_LENGTH ? trope : '',
  };
}

/** Write filters to the URL, leaving out defaults so a clean list has a clean URL. */
export function filtersToParams(filters: FilterState): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.genre) params.set(PARAM.genre, filters.genre);
  if (filters.read !== 'all') params.set(PARAM.read, filters.read);
  if (filters.minRating !== null) params.set(PARAM.minRating, String(filters.minRating));
  if (filters.trope) params.set(PARAM.trope, filters.trope);
  return params;
}

export function toApiFilters(filters: FilterState): BookFilters {
  const api: BookFilters = {};
  if (filters.genre) api.genre = filters.genre;
  if (filters.read !== 'all') api.is_read = filters.read === 'read';
  if (filters.minRating !== null) api.min_rating = filters.minRating;
  if (filters.trope) api.trope = filters.trope;
  return api;
}

export function hasActiveFilters(filters: FilterState): boolean {
  return (
    filters.genre !== '' ||
    filters.read !== 'all' ||
    filters.minRating !== null ||
    filters.trope !== ''
  );
}
