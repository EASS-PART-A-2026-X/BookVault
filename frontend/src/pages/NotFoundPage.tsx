import { Link } from 'react-router';

interface Props {
  title?: string;
  message?: string;
}

export function NotFoundPage({
  title = 'Page not found',
  message = "There's nothing at this address.",
}: Props) {
  return (
    <section className="narrow empty" aria-labelledby="nf-heading">
      <h1 id="nf-heading">{title}</h1>
      <p className="muted">{message}</p>
      <Link to="/" className="btn btn--primary">
        Back to your books
      </Link>
    </section>
  );
}
