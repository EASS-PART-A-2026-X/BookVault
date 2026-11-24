import { Link, useLocation } from 'react-router';
import { BookCard } from '../components/BookCard';
import { Filters } from '../components/Filters';
import { useBookFilters } from '../hooks/useBookFilters';
import { useBooks } from '../hooks/useBooks';

export function BookListPage() {
  const { filters, apiFilters, setFilters, clearFilters, isFiltered } = useBookFilters();
  const { books, error, loading, reload } = useBooks(apiFilters);
  const { search } = useLocation();

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

      {error !== undefined && (
        <div className="alert alert--error" role="alert">
          <span>{error instanceof Error ? error.message : "Couldn't load your books."}</span>
          <button type="button" className="btn btn--ghost" onClick={reload}>
            Retry
          </button>
        </div>
      )}

      {loading && books === undefined && <p className="muted">Loading books…</p>}

      {books !== undefined && books.length === 0 && !loading && error === undefined && (
        <p className="muted">{isFiltered ? 'No books match these filters.' : 'No books yet.'}</p>
      )}

      {books !== undefined && books.length > 0 && (
        <>
          <p className="muted result-count" aria-live="polite">
            {books.length} {books.length === 1 ? 'book' : 'books'}
          </p>
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
