import { useCallback, useEffect, useState } from 'react';
import { isAbortError, listBooks, toQueryString } from '../api/books';
import type { Book, BookFilters } from '../types';

interface Result {
  /** Which request this result belongs to. */
  key: string | null;
  books?: Book[];
  error?: unknown;
}

/**
 * Fetch the book list for `filters` (pass a memoised object). Loading is derived:
 * the hook is loading whenever the latest result belongs to an older request.
 * The previous list stays visible while new filters load, so the page doesn't flash,
 * and the last error stays until a request succeeds.
 */
export function useBooks(filters: BookFilters) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<Result>({ key: null });
  const key = `${toQueryString(filters)}#${attempt}`;

  useEffect(() => {
    const controller = new AbortController();
    listBooks(filters, controller.signal).then(
      (books) => setResult({ key, books }),
      (error: unknown) => {
        if (!isAbortError(error)) setResult((prev) => ({ key, books: prev.books, error }));
      },
    );
    return () => controller.abort();
    // `key` changes exactly when `filters` or `attempt` change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const loading = result.key !== key;
  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  return {
    books: result.books,
    // Kept while a retry is in flight, so the banner can say "Retrying…".
    error: result.error,
    loading,
    reload,
  };
}
