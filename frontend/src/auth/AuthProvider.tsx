import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ApiError,
  getMe,
  isAbortError,
  logout as apiLogout,
  setUnauthorizedHandler,
} from '../api/books';
import { useToast } from '../toast/context';
import type { User } from '../types';
import { AuthContext, type AuthApi, type AuthState } from './context';

/**
 * Knows who is logged in. Asks the server once on start (the session cookie is
 * httpOnly, so only the server can tell), and drops to "anonymous" whenever any
 * request comes back 401 (session expired or logged out elsewhere).
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    getMe(controller.signal).then(
      (user) => setState({ status: 'authenticated', user }),
      (error: unknown) => {
        if (isAbortError(error)) return;
        if (error instanceof ApiError && error.status === 401) setState({ status: 'anonymous' });
        else setState({ status: 'error', error });
      },
    );
    return () => controller.abort();
  }, [attempt]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setState((prev) => {
        if (prev.status === 'authenticated') {
          toast.error('Your session has ended. Please log in again.');
        }
        return { status: 'anonymous' };
      });
    });
    return () => setUnauthorizedHandler(null);
  }, [toast]);

  const setUser = useCallback((user: User) => setState({ status: 'authenticated', user }), []);

  const logout = useCallback(async () => {
    await apiLogout();
    setState({ status: 'anonymous' });
  }, []);

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((n) => n + 1);
  }, []);

  const api = useMemo<AuthApi>(
    () => ({
      state,
      user: state.status === 'authenticated' ? state.user : null,
      setUser,
      logout,
      retry,
    }),
    [state, setUser, logout, retry],
  );

  return <AuthContext.Provider value={api}>{children}</AuthContext.Provider>;
}
