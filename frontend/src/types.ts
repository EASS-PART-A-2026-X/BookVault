/** API contract types, mirroring book-vault/app/schemas.py. */

export const GENRES = [
  'Fantasy',
  'Romance',
  'Sci-Fi',
  'Thriller',
  'Non-Fiction',
  'Mystery',
  'Historical',
] as const;

export type Genre = (typeof GENRES)[number];

export const MIN_RATING = 1;
export const MAX_RATING = 5;

/** A stored book (BookRead). Timestamps are UTC but sent without a timezone suffix. */
export interface Book {
  id: number;
  title: string;
  author: string;
  genre: Genre;
  rating: number | null;
  is_read: boolean;
  review: string | null;
  created_at: string;
  updated_at: string;
}

/** POST /books body (BookCreate). */
export interface BookCreate {
  title: string;
  author: string;
  genre: Genre;
  rating?: number | null;
  is_read?: boolean;
  review?: string | null;
}

/**
 * PUT /books/{id} body (BookUpdate): partial. rating/review may be null to clear
 * them; title, author, genre and is_read may be omitted but never null.
 */
export interface BookUpdate {
  title?: string;
  author?: string;
  genre?: Genre;
  rating?: number | null;
  is_read?: boolean;
  review?: string | null;
}

/** Query filters for GET /books. */
export interface BookFilters {
  genre?: Genre;
  is_read?: boolean;
  min_rating?: number;
}

export function isGenre(value: unknown): value is Genre {
  return typeof value === 'string' && (GENRES as readonly string[]).includes(value);
}
