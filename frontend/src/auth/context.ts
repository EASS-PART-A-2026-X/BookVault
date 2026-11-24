import { createContext, useContext } from 'react';
import type { User } from '../types';

export type AuthState =
  | { status: 'loading' }
  | { status: 'authenticated'; user: User }
  | { status: 'anonymous' }
  /** Couldn't even ask the server who we are (e.g. backend down). */
  | { status: 'error'; error: unknown };

export interface AuthApi {
  state: AuthState;
  /** The logged-in user, or null. */
  user: User | null;
  /** After a successful login/register/profile update. */
  setUser: (user: User) => void;
  logout: () => Promise<void>;
  /** Ask the server again (after an error). */
  retry: () => void;
}

export const AuthContext = createContext<AuthApi | null>(null);

export function useAuth(): AuthApi {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error('useAuth must be used inside <AuthProvider>');
  return auth;
}
