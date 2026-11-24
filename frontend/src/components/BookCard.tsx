import { Link } from 'react-router';
import type { Book } from '../types';
import { Stars } from './StarRating';

const MAX_CARD_TROPES = 3;

interface Props {
  book: Book;
  /** The list's query string, so "Back to books" returns to the same filters. */
  fromSearch: string;
}

export function BookCard({ book, fromSearch }: Props) {
  return (
    <article className="card book-card" aria-labelledby={`book-${book.id}-title`}>
      <div className="book-card__top">
        <span className="badge">{book.genre}</span>
        <span className={book.is_read ? 'status status--read' : 'status'}>
          {book.is_read ? 'Read' : 'Unread'}
        </span>
      </div>
      <h2 className="book-card__title" id={`book-${book.id}-title`}>
        <Link to={`/books/${book.id}`} state={{ fromSearch }} className="stretched-link">
          {book.title}
        </Link>
      </h2>
      <p className="book-card__author">{book.author}</p>
      {book.tropes.length > 0 && (
        <ul className="chips chips--small" aria-label="Tropes">
          {book.tropes.slice(0, MAX_CARD_TROPES).map((trope) => (
            <li key={trope} className="chip">
              {trope}
            </li>
          ))}
          {book.tropes.length > MAX_CARD_TROPES && (
            <li className="chip chip--more">+{book.tropes.length - MAX_CARD_TROPES} more</li>
          )}
        </ul>
      )}
      <Stars value={book.rating} />
    </article>
  );
}
