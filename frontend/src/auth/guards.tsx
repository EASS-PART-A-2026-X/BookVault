import { Navigate, Outlet, useLocation, useSearchParams } from 'react-router';
import { ErrorBanner } from '../components/ErrorBanner';
import { Spinner } from '../components/Spinner';
import { useAuth } from './context';
import { safeNext } from './next';

function AuthPending() {
  const { state, retry } = useAuth();
  if (state.status === 'error') {
    return (
      <div className="narrow">
        <ErrorBanner error={state.error} onRetry={retry} />
      </div>
    );
  }
  return (
    <div className="narrow page-loading">
      <Spinner label="Checking your session…" />
    </div>
  );
}

/** Pages that need an account: sends logged-out visitors to /login?next=<here>. */
export function RequireAuth() {
  const { state } = useAuth();
  const location = useLocation();
  if (state.status === 'loading' || state.status === 'error') return <AuthPending />;
  if (state.status === 'anonymous') {
    const next = location.pathname + location.search;
    const to = next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`;
    return <Navigate to={to} replace />;
  }
  return <Outlet />;
}

/** Login/sign-up pages: already logged in? Go where you were heading. */
export function PublicOnly() {
  const { state } = useAuth();
  const [params] = useSearchParams();
  if (state.status === 'loading' || state.status === 'error') return <AuthPending />;
  if (state.status === 'authenticated')
    return <Navigate to={safeNext(params.get('next'))} replace />;
  return <Outlet />;
}
