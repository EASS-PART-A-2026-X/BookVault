import { formatDate } from '../lib/format';
import type { Book } from '../types';
import { Stars } from './StarRating';

/** Someone else's book: read-only, with the review front and centre. */
export function ReviewCard({ book }: { book: Book }) {
  return (
    <article className="card review-card" aria-labelledby={`review-${book.id}`}>
      <div className="book-card__top">
        <span className="badge">{book.genre}</span>
        <span className={book.is_read ? 'status status--read' : 'status'}>
          {book.is_read ? 'Read' : 'Unread'}
        </span>
      </div>
      <h3 className="book-card__title" id={`review-${book.id}`}>
        {book.title}
      </h3>
      <p className="book-card__author">{book.author}</p>
      <Stars value={book.rating} />
      {book.review ? (
        <blockquote className="review-card__text">{book.review}</blockquote>
      ) : (
        <p className="muted small">No review.</p>
      )}
      {book.tropes.length > 0 && (
        <ul className="chips chips--small" aria-label="Tropes">
          {book.tropes.map((t) => (
            <li key={t} className="chip">
              {t}
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">Updated {formatDate(book.updated_at)}</p>
    </article>
  );
}
