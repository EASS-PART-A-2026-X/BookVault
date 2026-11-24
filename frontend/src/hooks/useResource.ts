import { useCallback, useEffect, useRef, useState } from 'react';
import { isAbortError } from '../api/books';

interface Result<T> {
  key: string | null;
  data?: T;
  error?: unknown;
}

/**
 * Load something for `key` (null = don't load). Same pattern as useBooks: loading is
 * derived from which request the latest result belongs to, the previous data stays
 * visible while reloading, and the last error stays until a request succeeds.
 */
export function useResource<T>(key: string | null, fetcher: (signal: AbortSignal) => Promise<T>) {
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<Result<T>>({ key: null });
  const requestKey = key === null ? null : `${key}#${attempt}`;

  useEffect(() => {
    if (requestKey === null) return;
    const controller = new AbortController();
    fetcherRef.current(controller.signal).then(
      (data) => setResult({ key: requestKey, data }),
      (error: unknown) => {
        if (!isAbortError(error)) setResult((prev) => ({ ...prev, key: requestKey, error }));
      },
    );
    return () => controller.abort();
  }, [requestKey]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const setData = useCallback(
    (update: (data: T | undefined) => T) =>
      setResult((prev) => ({ ...prev, data: update(prev.data) })),
    [],
  );

  return {
    data: result.data,
    error: result.error,
    loading: requestKey !== null && result.key !== requestKey,
    reload,
    setData,
  };
}
