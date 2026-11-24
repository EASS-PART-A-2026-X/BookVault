import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { deleteBook, updateBook } from '../api/books';
import { BookForm } from '../components/BookForm';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { StarInput } from '../components/StarRating';
import { useBook } from '../hooks/useBook';
import { toUpdatePayload, valuesFromBook } from '../lib/bookForm';
import { formatDate } from '../lib/format';
import type { Book, BookUpdate } from '../types';
import { NotFoundPage } from './NotFoundPage';

/** Only positive integers are real ids; anything else can't exist on the server. */
function parseId(raw: string | undefined): number | null {
  return raw && /^\d+$/.test(raw) && Number(raw) > 0 ? Number(raw) : null;
}

export function BookDetailPage() {
  const id = parseId(useParams().id);
  if (id === null) return <NotFoundPage />;
  return <BookDetail key={id} id={id} />;
}

function BookDetail({ id }: { id: number }) {
  const { book, error, loading, reload, setBook } = useBook(id);
  const location = useLocation();
  const fromSearch = (location.state as { fromSearch?: string } | null)?.fromSearch ?? '';
  const backTo = `/${fromSearch}`;

  if (loading) return <p className="muted">Loading book…</p>;
  if (error !== undefined || book === undefined) {
    return (
      <div className="alert alert--error" role="alert">
        <span>{error instanceof Error ? error.message : "Couldn't load this book."}</span>
        <button type="button" className="btn btn--ghost" onClick={reload}>
          Retry
        </button>
      </div>
    );
  }
  return <BookView book={book} onChange={setBook} backTo={backTo} />;
}

interface ViewProps {
  book: Book;
  onChange: (book: Book) => void;
  backTo: string;
}

function BookView({ book, onChange, backTo }: ViewProps) {
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [quickSaving, setQuickSaving] = useState(false);
  const [quickError, setQuickError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function quickUpdate(patch: BookUpdate) {
    setQuickSaving(true);
    setQuickError(null);
    try {
      onChange(await updateBook(book.id, patch));
    } catch (error) {
      setQuickError(error instanceof Error ? error.message : 'Update failed.');
    } finally {
      setQuickSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteBook(book.id);
      navigate(backTo, { replace: true });
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : 'Delete failed.');
      setDeleting(false);
    }
  }

  return (
    <article className="narrow" aria-labelledby="book-heading">
      <Link to={backTo} className="back-link">
        ← Back to books
      </Link>

      <div className="page-head">
        <div>
          <h1 id="book-heading">{book.title}</h1>
          <p className="byline">by {book.author}</p>
        </div>
        <span className="badge">{book.genre}</span>
      </div>

      {editing ? (
        <div className="card">
          <h2 className="card__title">Edit book</h2>
          <BookForm
            initialValues={valuesFromBook(book)}
            submitLabel="Save changes"
            onSubmit={async (values) => {
              onChange(await updateBook(book.id, toUpdatePayload(values)));
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
          />
        </div>
      ) : (
        <>
          <section
            className="card quick"
            aria-label="Quick actions"
            aria-busy={quickSaving || undefined}
          >
            {quickError && (
              <div className="alert alert--error" role="alert">
                {quickError}
              </div>
            )}
            <div className="quick__row">
              <span className="label">Status</span>
              <span className={book.is_read ? 'status status--read' : 'status'}>
                {book.is_read ? 'Read' : 'Unread'}
              </span>
              <button
                type="button"
                className="btn btn--ghost"
                disabled={quickSaving}
                onClick={() => quickUpdate({ is_read: !book.is_read })}
              >
                {book.is_read ? 'Mark as unread' : 'Mark as read'}
              </button>
            </div>
            <div className="quick__row">
              <span className="label">Your rating</span>
              <StarInput
                label="Your rating"
                value={book.rating}
                disabled={quickSaving}
                onChange={(rating) => quickUpdate({ rating })}
              />
            </div>
          </section>

          <section className="card" aria-labelledby="review-heading">
            <h2 id="review-heading" className="card__title">
              Review
            </h2>
            {book.review ? (
              <p className="review">{book.review}</p>
            ) : (
              <p className="muted">No review yet.</p>
            )}
            <p className="muted small">
              Added {formatDate(book.created_at)} · Updated {formatDate(book.updated_at)}
            </p>
          </section>

          {deleteError && (
            <div className="alert alert--error" role="alert">
              {deleteError}
            </div>
          )}
          <div className="form-actions">
            <button
              type="button"
              className="btn btn--danger-ghost"
              onClick={() => setConfirmOpen(true)}
            >
              Delete
            </button>
            <button type="button" className="btn btn--primary" onClick={() => setEditing(true)}>
              Edit
            </button>
          </div>
        </>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Delete this book?"
        confirmLabel="Delete"
        danger
        busy={deleting}
        onConfirm={handleDelete}
        onCancel={() => setConfirmOpen(false)}
      >
        <p>“{book.title}” will be removed from your vault. This can’t be undone.</p>
      </ConfirmDialog>
    </article>
  );
}
