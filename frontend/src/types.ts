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

/** Backend limits for tropes (TROPE_MAX_LENGTH, MAX_TROPES_PER_BOOK). */
export const TROPE_MAX_LENGTH = 50;
export const MAX_TROPES_PER_BOOK = 20;

/** A stored book (BookRead). Timestamps are UTC but sent without a timezone suffix. */
export interface Book {
  id: number;
  title: string;
  author: string;
  genre: Genre;
  rating: number | null;
  is_read: boolean;
  review: string | null;
  /** Normalised by the server: trimmed, single spaces, lower case, sorted. */
  tropes: string[];
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
  tropes?: string[];
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
  /** Replaces the whole list; [] removes all tropes. Never null. */
  tropes?: string[];
}

/** Query filters for GET /books. */
export interface BookFilters {
  genre?: Genre;
  is_read?: boolean;
  min_rating?: number;
  trope?: string;
}

/** GET /tropes entry. */
export interface TropeCount {
  name: string;
  book_count: number;
}

/** Same normalisation as the backend: trim, collapse spaces, lower case. */
export function normalizeTrope(name: string): string {
  return name.trim().split(/\s+/).join(' ').toLowerCase();
}

export function isGenre(value: unknown): value is Genre {
  return typeof value === 'string' && (GENRES as readonly string[]).includes(value);
}

// ------------------------------------------------------------------ Accounts

/** Backend rules (book-vault/app/schemas.py). */
export const USERNAME_PATTERN = /^[a-z0-9_.]{3,30}$/;
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
export const DISPLAY_NAME_MAX_LENGTH = 50;
export const BIO_MAX_LENGTH = 280;

/** The logged-in account (GET /auth/me). */
export interface User {
  id: number;
  username: string;
  display_name: string;
  bio: string;
  is_public: boolean;
  created_at: string;
}

export interface RegisterRequest {
  username: string;
  password: string;
  display_name?: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface ProfileUpdate {
  display_name?: string;
  bio?: string;
  is_public?: boolean;
}

/** Same normalisation as the backend: trimmed, lower case. */
export function normalizeUsername(name: string): string {
  return name.trim().toLowerCase();
}
