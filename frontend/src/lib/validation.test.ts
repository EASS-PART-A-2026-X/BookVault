import { describe, expect, it } from 'vitest';
import { EMPTY_FORM, type BookFormValues } from './bookForm';
import { firstInvalidField, validateBook, validateField } from './validation';

const VALID: BookFormValues = {
  title: 'Dune',
  author: 'Frank Herbert',
  genre: 'Sci-Fi',
  rating: 5,
  is_read: true,
  review: '',
};

describe('validateBook (mirrors the backend schema)', () => {
  it('accepts a valid book, with or without a rating', () => {
    expect(validateBook(VALID)).toEqual({});
    expect(validateBook({ ...VALID, rating: null })).toEqual({});
  });

  it('requires title, author and genre', () => {
    expect(validateBook(EMPTY_FORM)).toEqual({
      title: 'Title is required.',
      author: 'Author is required.',
      genre: 'Choose a genre.',
    });
  });

  it.each(['', '   ', '\t\n'])(
    'rejects a blank title/author %j (trimmed like the API)',
    (blank) => {
      expect(validateField('title', { ...VALID, title: blank })).toBe('Title is required.');
      expect(validateField('author', { ...VALID, author: blank })).toBe('Author is required.');
    },
  );

  it('rejects a genre outside the enum', () => {
    expect(validateField('genre', { ...VALID, genre: 'Horror' as never })).toBe('Choose a genre.');
  });

  it.each([0, 6, 2.5, -1])('rejects rating %s', (rating) => {
    expect(validateField('rating', { ...VALID, rating })).toMatch(/whole number from 1 to 5/);
  });

  it.each([1, 3, 5])('accepts rating %s', (rating) => {
    expect(validateField('rating', { ...VALID, rating })).toBeUndefined();
  });

  it('finds the first invalid field in form order', () => {
    expect(firstInvalidField({ genre: 'x', author: 'y' })).toBe('author');
    expect(firstInvalidField({})).toBeUndefined();
  });
});
