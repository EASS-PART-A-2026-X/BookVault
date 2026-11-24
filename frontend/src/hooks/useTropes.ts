import { useEffect, useState } from 'react';
import { isAbortError, listTropes } from '../api/books';
import type { TropeCount } from '../types';

/**
 * Tropes in use (for the filter dropdown and form suggestions). Refetches when
 * `refreshKey` changes, e.g. after the book list reloads. Failures are non-fatal:
 * the list just stays as it was (the page shows its own error banner).
 */
export function useTropes(refreshKey: unknown = null): TropeCount[] {
  const [tropes, setTropes] = useState<TropeCount[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    listTropes(controller.signal).then(setTropes, (error: unknown) => {
      if (!isAbortError(error)) console.warn('Could not load tropes', error);
    });
    return () => controller.abort();
  }, [refreshKey]);

  return tropes;
}
