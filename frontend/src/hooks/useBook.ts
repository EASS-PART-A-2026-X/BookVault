import { useCallback, useEffect, useState } from 'react';
import { getBook, isAbortError } from '../api/books';
import type { Book } from '../types';

interface Result {
  key: string | null;
  book?: Book;
  error?: unknown;
}

/** Fetch one book. `setBook` lets the page apply a successful update locally. */
export function useBook(id: number) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<Result>({ key: null });
  const key = `${id}#${attempt}`;

  useEffect(() => {
    const controller = new AbortController();
    getBook(id, controller.signal).then(
      (book) => setResult({ key, book }),
      (error: unknown) => {
        if (!isAbortError(error)) setResult({ key, error });
      },
    );
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const loading = result.key !== key;
  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const setBook = useCallback((book: Book) => setResult((prev) => ({ ...prev, book })), []);

  return {
    book: loading ? undefined : result.book,
    error: loading ? undefined : result.error,
    loading,
    reload,
    setBook,
  };
}
