import { describeError } from '../lib/errors';

interface Props {
  error: unknown;
  /** Show a Retry button that calls this. */
  onRetry?: () => void;
  /** A retry is in flight: the button is disabled and says so. */
  retrying?: boolean;
}

/** A clear, recoverable error message, e.g. when the backend is down. */
export function ErrorBanner({ error, onRetry, retrying = false }: Props) {
  const { kind, title, message, retryable } = describeError(error);
  return (
    <div className={`banner banner--error banner--${kind}`} role="alert">
      <span className="banner__icon" aria-hidden="true">
        {kind === 'network' ? '⚡' : '!'}
      </span>
      <div className="banner__text">
        <strong className="banner__title">{title}</strong>
        <span>{message}</span>
      </div>
      {onRetry && retryable && (
        <button
          type="button"
          className="btn btn--ghost banner__action"
          onClick={onRetry}
          disabled={retrying}
          aria-busy={retrying || undefined}
        >
          {retrying ? 'Retrying…' : 'Retry'}
        </button>
      )}
    </div>
  );
}
