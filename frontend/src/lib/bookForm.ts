/** Form state for the add/edit book form, and conversion to API payloads. */
import type { Book, BookCreate, BookUpdate, Genre } from '../types';

export interface BookFormValues {
  title: string;
  author: string;
  genre: Genre | '';
  rating: number | null;
  is_read: boolean;
  review: string;
}

export const EMPTY_FORM: BookFormValues = {
  title: '',
  author: '',
  genre: '',
  rating: null,
  is_read: false,
  review: '',
};

export function valuesFromBook(book: Book): BookFormValues {
  return {
    title: book.title,
    author: book.author,
    genre: book.genre,
    rating: book.rating,
    is_read: book.is_read,
    review: book.review ?? '',
  };
}

/**
 * Trim like the backend does; an empty review becomes null. Genre is passed through
 * as-is: if it's still empty the server's 422 says so.
 */
export function toCreatePayload(values: BookFormValues): BookCreate {
  const review = values.review.trim();
  return {
    title: values.title.trim(),
    author: values.author.trim(),
    genre: values.genre as Genre,
    rating: values.rating,
    is_read: values.is_read,
    review: review === '' ? null : review,
  };
}

export function toUpdatePayload(values: BookFormValues): BookUpdate {
  return toCreatePayload(values);
}
