import { Link } from 'react-router';
import type { Book } from '../types';
import { Stars } from './StarRating';

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
      <Stars value={book.rating} />
    </article>
  );
}
