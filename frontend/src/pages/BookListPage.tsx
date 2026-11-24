import { Link, useLocation } from 'react-router';
import { BookCard } from '../components/BookCard';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner } from '../components/ErrorBanner';
import { Filters } from '../components/Filters';
import { Spinner } from '../components/Spinner';
import { useBookFilters } from '../hooks/useBookFilters';
import { useBooks } from '../hooks/useBooks';

const SKELETON_CARDS = 6;

export function BookListPage() {
  const { filters, apiFilters, setFilters, clearFilters, isFiltered } = useBookFilters();
  const { books, error, loading, reload } = useBooks(apiFilters);
  const { search } = useLocation();

  const firstLoad = books === undefined && error === undefined;
  const showEmpty = !loading && error === undefined && books !== undefined && books.length === 0;

  return (
    <section aria-labelledby="list-heading">
      <div className="page-head">
        <h1 id="list-heading">Your books</h1>
        <Link to="/books/new" className="btn btn--primary">
          Add book
        </Link>
      </div>

      <Filters
        value={filters}
        onChange={setFilters}
        onClear={clearFilters}
        isFiltered={isFiltered}
      />

      {error !== undefined && <ErrorBanner error={error} onRetry={reload} retrying={loading} />}

      {firstLoad && (
        <>
          <Spinner label="Loading books…" />
          <ul className="book-grid skeleton-grid" aria-hidden="true">
            {Array.from({ length: SKELETON_CARDS }, (_, i) => (
              <li key={i} className="card skeleton-card" />
            ))}
          </ul>
        </>
      )}

      {showEmpty && !isFiltered && (
        <EmptyState
          title="Your vault is empty"
          action={
            <Link to="/books/new" className="btn btn--primary">
              Add your first book
            </Link>
          }
        >
          Add the books you own to track what you’ve read and how you rated them.
        </EmptyState>
      )}

      {showEmpty && isFiltered && (
        <EmptyState
          title="No books match these filters"
          icon="🔍"
          action={
            <button type="button" className="btn btn--primary" onClick={clearFilters}>
              Clear filters
            </button>
          }
        >
          Try a different genre, status or minimum rating.
        </EmptyState>
      )}

      {books !== undefined && books.length > 0 && (
        <>
          <div className="result-count">
            <span className="muted" aria-live="polite">
              {books.length} {books.length === 1 ? 'book' : 'books'}
            </span>
            {loading && <Spinner label="Updating…" />}
          </div>
          <ul className="book-grid" aria-label="Books" aria-busy={loading || undefined}>
            {books.map((book) => (
              <li key={book.id}>
                <BookCard book={book} fromSearch={search} />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
