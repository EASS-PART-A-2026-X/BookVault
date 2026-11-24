import { Link } from 'react-router';

interface Props {
  title?: string;
  message?: string;
}

export function NotFoundPage({
  title = 'Page not found',
  message = 'There’s nothing at this address. Check the link, or head back to your books.',
}: Props) {
  return (
    <section className="narrow empty card" aria-labelledby="nf-heading">
      <span className="empty__icon" aria-hidden="true">
        🔎
      </span>
      <p className="empty__code" aria-hidden="true">
        404
      </p>
      <h1 id="nf-heading">{title}</h1>
      <p className="muted">{message}</p>
      <Link to="/" className="btn btn--primary">
        Back to your books
      </Link>
    </section>
  );
}
