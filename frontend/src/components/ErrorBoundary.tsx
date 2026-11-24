import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** When this changes (e.g. the route), a crashed boundary resets itself. */
  resetKey?: unknown;
  /** Render a custom fallback; defaults to a friendly crash page. */
  fallback?: (props: { error: Error; reset: () => void }) => ReactNode;
}

interface State {
  error: Error | null;
  resetKey: unknown;
}

/**
 * Catches render errors anywhere below it, so a bug shows a fallback page
 * instead of a blank white screen.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    // Navigating elsewhere clears the crash.
    if (props.resetKey !== state.resetKey) return { error: null, resetKey: props.resetKey };
    return null;
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Uncaught error in UI:', error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback({ error, reset: this.reset });
    return <CrashFallback error={error} onReset={this.reset} />;
  }
}

function CrashFallback({ error, onReset }: { error: Error; onReset: () => void }) {
  return (
    <section className="narrow empty card crash" role="alert" aria-labelledby="crash-heading">
      <span className="empty__icon" aria-hidden="true">
        ⚠️
      </span>
      <h1 id="crash-heading">Something went wrong</h1>
      <p className="muted">
        This page hit an unexpected error. Your books are safe on the server; try again or go back
        to your list.
      </p>
      <details className="crash__details">
        <summary>Technical details</summary>
        <pre>{error.message}</pre>
      </details>
      <div className="form-actions crash__actions">
        <button type="button" className="btn btn--ghost" onClick={onReset}>
          Try again
        </button>
        {/* A plain link (full load) in case the router itself is what broke. */}
        <a href="/" className="btn btn--primary">
          Back to your books
        </a>
      </div>
    </section>
  );
}
