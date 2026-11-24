/**
 * Client-side validation that mirrors the backend's Pydantic rules
 * (book-vault/app/schemas.py), so problems show inline before submitting:
 *   title, author  required, non-empty after trimming whitespace
 *   genre          required, one of GENRES
 *   rating         optional; if set, an integer from 1 to 5
 *   is_read        boolean (always valid from a checkbox)
 *   review         optional free text
 *   tropes         optional; at most 20, each 1-50 characters
 */
import { MAX_RATING, MAX_TROPES_PER_BOOK, MIN_RATING, TROPE_MAX_LENGTH, isGenre } from '../types';
import type { BookFormValues } from './bookForm';

export type FieldName = keyof BookFormValues;
export type FieldErrors = Partial<Record<FieldName, string>>;

/** Field order on the form, used to focus the first invalid field. */
export const FIELD_ORDER: FieldName[] = [
  'title',
  'author',
  'genre',
  'tropes',
  'rating',
  'is_read',
  'review',
];

export function validateField(field: FieldName, values: BookFormValues): string | undefined {
  switch (field) {
    case 'title':
      return values.title.trim() ? undefined : 'Title is required.';
    case 'author':
      return values.author.trim() ? undefined : 'Author is required.';
    case 'genre':
      return isGenre(values.genre) ? undefined : 'Choose a genre.';
    case 'rating': {
      const { rating } = values;
      if (rating === null) return undefined;
      return Number.isInteger(rating) && rating >= MIN_RATING && rating <= MAX_RATING
        ? undefined
        : `Rating must be a whole number from ${MIN_RATING} to ${MAX_RATING}.`;
    }
    case 'tropes': {
      if (values.tropes.length > MAX_TROPES_PER_BOOK) {
        return `A book can have at most ${MAX_TROPES_PER_BOOK} tropes.`;
      }
      const tooLong = values.tropes.find((t) => t.trim().length > TROPE_MAX_LENGTH);
      return tooLong
        ? `Each trope must be at most ${TROPE_MAX_LENGTH} characters ("${tooLong.slice(0, 20)}…").`
        : undefined;
    }
    case 'is_read':
    case 'review':
      return undefined;
  }
}

export function validateBook(values: BookFormValues): FieldErrors {
  const errors: FieldErrors = {};
  for (const field of FIELD_ORDER) {
    const message = validateField(field, values);
    if (message) errors[field] = message;
  }
  return errors;
}

export function firstInvalidField(errors: FieldErrors): FieldName | undefined {
  return FIELD_ORDER.find((field) => errors[field]);
}
