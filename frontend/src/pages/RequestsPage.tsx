import { useState } from 'react';
import { Link } from 'react-router';
import { answerFollowRequest, listFollowRequests } from '../api/books';
import { Avatar } from '../components/Avatar';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner } from '../components/ErrorBanner';
import { Spinner } from '../components/Spinner';
import { useResource } from '../hooks/useResource';
import { describeError } from '../lib/errors';
import { formatDate } from '../lib/format';
import { useToast } from '../toast/context';
import type { FollowRequest } from '../types';
import { useRequestCount } from '../social/requestCount';

/** People who asked to follow your private profile. */
export function RequestsPage() {
  const toast = useToast();
  const { refresh: refreshBadge } = useRequestCount();
  const { data, error, loading, reload, setData } = useResource<FollowRequest[]>(
    'requests',
    (signal) => listFollowRequests(signal),
  );
  const [busy, setBusy] = useState<string | null>(null);

  async function answer(request: FollowRequest, choice: 'accept' | 'decline') {
    setBusy(request.username);
    try {
      await answerFollowRequest(request.username, choice);
      setData((list) => (list ?? []).filter((r) => r.username !== request.username));
      refreshBadge();
      toast.success(
        choice === 'accept'
          ? `${request.display_name} can now see your books.`
          : `Declined ${request.display_name}’s request.`,
      );
    } catch (err) {
      toast.error(describeError(err).message);
      reload();
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="narrow" aria-labelledby="requests-heading">
      <h1 id="requests-heading" className="page-title">
        Follow requests
      </h1>
      {error !== undefined && <ErrorBanner error={error} onRetry={reload} retrying={loading} />}
      {loading && data === undefined && <Spinner label="Loading requests…" />}
      {data !== undefined && data.length === 0 && (
        <EmptyState title="No requests right now" icon="✉️">
          When someone asks to follow your private profile, they’ll appear here.
        </EmptyState>
      )}
      {data !== undefined && data.length > 0 && (
        <ul className="people-list" aria-label="Follow requests">
          {data.map((request) => (
            <li key={request.username} className="person card">
              <Link to={`/u/${request.username}`} className="person__link">
                <Avatar name={request.display_name} username={request.username} />
                <span className="person__names">
                  <span className="person__name">{request.display_name}</span>
                  <span className="person__handle">
                    @{request.username} · asked {formatDate(request.requested_at)}
                  </span>
                </span>
              </Link>
              <span className="person__actions">
                <button
                  type="button"
                  className="btn btn--primary btn--small"
                  disabled={busy !== null}
                  onClick={() => answer(request, 'accept')}
                  aria-label={`Accept ${request.display_name}`}
                >
                  Accept
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--small"
                  disabled={busy !== null}
                  onClick={() => answer(request, 'decline')}
                  aria-label={`Decline ${request.display_name}`}
                >
                  Decline
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
