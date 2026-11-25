import { useState } from 'react';
import { NavLink, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router';
import { AuthProvider } from './auth/AuthProvider';
import { useAuth } from './auth/context';
import { PublicOnly, RequireAuth } from './auth/guards';
import { ErrorBoundary } from './components/ErrorBoundary';
import { VaultLogo } from './components/VaultLogo';
import { describeError } from './lib/errors';
import { AddBookPage } from './pages/AddBookPage';
import { AskPage } from './pages/AskPage';
import { BookDetailPage } from './pages/BookDetailPage';
import { BookListPage } from './pages/BookListPage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { PeoplePage } from './pages/PeoplePage';
import { ProfilePage } from './pages/ProfilePage';
import { RegisterPage } from './pages/RegisterPage';
import { RequestsPage } from './pages/RequestsPage';
import { SettingsPage } from './pages/SettingsPage';
import { useRequestCount } from './social/requestCount';
import { RequestCountProvider } from './social/RequestCountProvider';
import { useToast } from './toast/context';
import { ToastProvider } from './toast/ToastProvider';

function UserMenu() {
  const { user, logout } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [leaving, setLeaving] = useState(false);
  if (!user) return null;

  async function handleLogout() {
    setLeaving(true);
    try {
      await logout();
      toast.success('You’ve been logged out.');
      navigate('/login', { replace: true });
    } catch (error) {
      toast.error(`Couldn’t log out: ${describeError(error).message}`);
      setLeaving(false);
    }
  }

  return (
    <div className="user-menu">
      <NavLink
        to={`/u/${user.username}`}
        className="user-menu__name"
        title={`Your profile (@${user.username})`}
      >
        {user.display_name}
      </NavLink>
      <button
        type="button"
        className="btn btn--ghost btn--small"
        onClick={handleLogout}
        disabled={leaving}
      >
        {leaving ? 'Logging out…' : 'Log out'}
      </button>
    </div>
  );
}

function RequestsLink() {
  const { count } = useRequestCount();
  return (
    <NavLink
      to="/requests"
      className="nav-link"
      aria-label={count ? `Requests (${count} waiting)` : 'Requests'}
    >
      Requests
      {count > 0 && (
        <span className="nav-badge" aria-hidden="true">
          {count}
        </span>
      )}
    </NavLink>
  );
}

function Layout() {
  const { pathname } = useLocation();
  const { user, state } = useAuth();
  return (
    <RequestCountProvider enabled={user !== null}>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="site-header">
        <div className="container site-header__inner">
          <NavLink to="/" className="brand" aria-label="Book Vault home">
            <VaultLogo size={44} />
            <span className="brand__name">
              Book Vault
              <span className="brand__tagline">Personal library</span>
            </span>
          </NavLink>
          <nav aria-label="Main" className="site-nav">
            {user ? (
              <>
                <NavLink to="/" end className="nav-link">
                  Books
                </NavLink>
                <NavLink to="/ask" className="nav-link">
                  Ask
                </NavLink>
                <NavLink to="/people" className="nav-link">
                  People
                </NavLink>
                <RequestsLink />
                <UserMenu />
              </>
            ) : state.status === 'anonymous' ? (
              // Only once we know nobody is logged in: while the session check is
              // loading or failed (backend down) we can't tell, so show neither.
              <>
                <NavLink to="/login" className="nav-link">
                  Log in
                </NavLink>
                <NavLink to="/register" className="nav-link">
                  Sign up
                </NavLink>
              </>
            ) : null}
          </nav>
        </div>
      </header>
      <main id="main" className="container">
        {/* A crash in one page shows a fallback there; the header keeps working. */}
        <ErrorBoundary resetKey={pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>
    </RequestCountProvider>
  );
}

export function AppRoutes() {
  return (
    <ToastProvider>
      <AuthProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route element={<PublicOnly />}>
              <Route path="login" element={<LoginPage />} />
              <Route path="register" element={<RegisterPage />} />
            </Route>
            <Route element={<RequireAuth />}>
              <Route index element={<BookListPage />} />
              <Route path="books/new" element={<AddBookPage />} />
              <Route path="books/:id" element={<BookDetailPage />} />
              <Route path="ask" element={<AskPage />} />
              <Route path="people" element={<PeoplePage />} />
              <Route path="u/:username" element={<ProfilePage />} />
              <Route path="requests" element={<RequestsPage />} />
              <Route path="settings" element={<SettingsPage />} />
            </Route>
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </AuthProvider>
    </ToastProvider>
  );
}
