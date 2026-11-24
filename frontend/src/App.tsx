import { NavLink, Outlet, Route, Routes, useLocation } from 'react-router';
import { ErrorBoundary } from './components/ErrorBoundary';
import { VaultLogo } from './components/VaultLogo';
import { AddBookPage } from './pages/AddBookPage';
import { BookDetailPage } from './pages/BookDetailPage';
import { BookListPage } from './pages/BookListPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { ToastProvider } from './toast/ToastProvider';

function Layout() {
  const { pathname } = useLocation();
  return (
    <>
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
          <nav aria-label="Main">
            <NavLink to="/" end className="nav-link">
              Books
            </NavLink>
            <NavLink to="/books/new" className="nav-link">
              Add book
            </NavLink>
          </nav>
        </div>
      </header>
      <main id="main" className="container">
        {/* A crash in one page shows a fallback there; the header keeps working. */}
        <ErrorBoundary resetKey={pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>
    </>
  );
}

export function AppRoutes() {
  return (
    <ToastProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<BookListPage />} />
          <Route path="books/new" element={<AddBookPage />} />
          <Route path="books/:id" element={<BookDetailPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </ToastProvider>
  );
}
