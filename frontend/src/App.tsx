import { NavLink, Outlet, Route, Routes } from 'react-router';
import { AddBookPage } from './pages/AddBookPage';
import { BookDetailPage } from './pages/BookDetailPage';
import { BookListPage } from './pages/BookListPage';
import { NotFoundPage } from './pages/NotFoundPage';

function Layout() {
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="site-header">
        <div className="container site-header__inner">
          <NavLink to="/" className="brand">
            <span aria-hidden="true" className="brand__mark">
              ▤
            </span>
            Book Vault
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
        <Outlet />
      </main>
    </>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<BookListPage />} />
        <Route path="books/new" element={<AddBookPage />} />
        <Route path="books/:id" element={<BookDetailPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
