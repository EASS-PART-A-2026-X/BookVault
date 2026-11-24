import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { deleteBook, updateBook } from '../api/books';
import { BookForm } from '../components/BookForm';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ErrorBanner } from '../components/ErrorBanner';
import { Spinner } from '../components/Spinner';
import { StarInput } from '../components/StarRating';
import { useBook } from '../hooks/useBook';
import { useTropes } from '../hooks/useTropes';
import { toUpdatePayload, valuesFromBook } from '../lib/bookForm';
import { isNotFound } from '../lib/errors';
import { formatDate } from '../lib/format';
import { useToast } from '../toast/context';
import type { Book, BookUpdate } from '../types';
import { NotFoundPage } from './NotFoundPage';

/** Only positive integers are real ids; anything else can't exist on the server. */
function parseId(raw: string | undefined): number | null {
  return raw && /^\d+$/.test(raw) && Number(raw) > 0 ? Number(raw) : null;
}

function BookNotFound({ id }: { id: number | string }) {
  return (
    <NotFoundPage
      title="Book not found"
      message={`There’s no book with id ${id} in your vault. It may have been deleted.`}
    />
  );
}

export function BookDetailPage() {
  const rawId = useParams().id;
  const id = parseId(rawId);
  if (id === null) return <BookNotFound id={rawId ?? ''} />;
  return <BookDetail key={id} id={id} />;
}

function BookDetail({ id }: { id: number }) {
  const { book, error, loading, reload, setBook } = useBook(id);
  const [goneElsewhere, setGoneElsewhere] = useState(false);
  const location = useLocation();
  const fromSearch = (location.state as { fromSearch?: string } | null)?.fromSearch ?? '';
  const backTo = `/${fromSearch}`;

  if (goneElsewhere || isNotFound(error)) return <BookNotFound id={id} />;

  if (book === undefined) {
    if (error !== undefined) {
      return (
        <div className="narrow">
          <Link to={backTo} className="back-link">
            ← Back to books
          </Link>
          <ErrorBanner error={error} onRetry={reload} retrying={loading} />
        </div>
      );
    }
    return (
      <div className="narrow page-loading">
        <Spinner label="Loading book…" />
      </div>
    );
  }

  return (
    <BookView
      book={book}
      onChange={setBook}
      onGone={() => setGoneElsewhere(true)}
      backTo={backTo}
    />
  );
}

interface ViewProps {
  book: Book;
  onChange: (book: Book) => void;
  /** The server says the book no longer exists (deleted in another tab). */
  onGone: () => void;
  backTo: string;
}

type QuickAction = 'read' | 'rating';

function ratingMessage(rating: number | null): string {
  if (rating === null) return 'Rating cleared.';
  return `Rated ${rating} ${rating === 1 ? 'star' : 'stars'}.`;
}

function BookView({ book, onChange, onGone, backTo }: ViewProps) {
  const navigate = useNavigate();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const tropes = useTropes(editing);
  const [quickSaving, setQuickSaving] = useState<QuickAction | null>(null);
  const [quickError, setQuickError] = useState<unknown>(undefined);
  const [lastQuick, setLastQuick] = useState<{ action: QuickAction; patch: BookUpdate } | null>(
    null,
  );
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<unknown>(undefined);

  const busy = quickSaving !== null;

  async function quickUpdate(action: QuickAction, patch: BookUpdate) {
    if (busy) return;
    setQuickSaving(action);
    setQuickError(undefined);
    setLastQuick({ action, patch });
    try {
      onChange(await updateBook(book.id, patch));
      toast.success(
        action === 'read'
          ? patch.is_read
            ? 'Marked as read.'
            : 'Marked as unread.'
          : ratingMessage(patch.rating ?? null),
      );
    } catch (error) {
      if (isNotFound(error)) onGone();
      else setQuickError(error);
    } finally {
      setQuickSaving(null);
    }
  }

  async function handleDelete() {
    if (deleting) return;
    setDeleting(true);
    setDeleteError(undefined);
    try {
      await deleteBook(book.id);
    } catch (error) {
      setDeleting(false);
      if (!isNotFound(error)) {
        setConfirmOpen(false);
        setDeleteError(error);
        return;
      }
      // Already gone (e.g. deleted in another tab): that's what the user wanted.
    }
    toast.success(`Deleted “${book.title}”.`);
    navigate(backTo, { replace: true });
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
              try {
                onChange(await updateBook(book.id, toUpdatePayload(values)));
              } catch (error) {
                if (isNotFound(error)) {
                  onGone();
                  return;
                }
                throw error;
              }
              setEditing(false);
              toast.success('Changes saved.');
            }}
            onCancel={() => setEditing(false)}
            tropeSuggestions={tropes.map((t) => t.name)}
          />
        </div>
      ) : (
        <>
          <section className="card quick" aria-label="Quick actions" aria-busy={busy || undefined}>
            {quickError !== undefined && (
              <ErrorBanner
                error={quickError}
                retrying={busy}
                onRetry={() => lastQuick && quickUpdate(lastQuick.action, lastQuick.patch)}
              />
            )}
            <div className="quick__row">
              <span className="label">Status</span>
              <span className={book.is_read ? 'status status--read' : 'status'}>
                {book.is_read ? 'Read' : 'Unread'}
              </span>
              <button
                type="button"
                className="btn btn--ghost"
                disabled={busy}
                aria-busy={quickSaving === 'read' || undefined}
                onClick={() => quickUpdate('read', { is_read: !book.is_read })}
              >
                {quickSaving === 'read' ? (
                  <>
                    <Spinner label="Saving…" inline />
                    <span aria-hidden="true">Saving…</span>
                  </>
                ) : book.is_read ? (
                  'Mark as unread'
                ) : (
                  'Mark as read'
                )}
              </button>
            </div>
            <div className="quick__row">
              <span className="label">Your rating</span>
              <StarInput
                label="Your rating"
                value={book.rating}
                disabled={busy}
                onChange={(rating) => {
                  if (rating !== book.rating) void quickUpdate('rating', { rating });
                }}
              />
              {quickSaving === 'rating' && <Spinner label="Saving rating…" inline />}
            </div>
          </section>

          <section className="card" aria-labelledby="tropes-heading">
            <h2 id="tropes-heading" className="card__title">
              Tropes
            </h2>
            {book.tropes.length > 0 ? (
              <ul className="chips" aria-label="Tropes">
                {book.tropes.map((trope) => (
                  <li key={trope}>
                    <Link
                      to={`/?trope=${encodeURIComponent(trope)}`}
                      className="chip chip--link"
                      title={`Show all books with “${trope}”`}
                    >
                      {trope}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No tropes yet. Add some with Edit.</p>
            )}
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

          {deleteError !== undefined && (
            <div className="stack-top">
              <ErrorBanner error={deleteError} onRetry={() => setConfirmOpen(true)} />
            </div>
          )}
          <div className="form-actions">
            <button
              type="button"
              className="btn btn--danger-ghost"
              onClick={() => setConfirmOpen(true)}
              disabled={busy}
            >
              Delete
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => setEditing(true)}
              disabled={busy}
            >
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
