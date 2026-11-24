import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { searchUsers } from '../api/books';
import { Avatar } from '../components/Avatar';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner } from '../components/ErrorBanner';
import { FollowButton } from '../components/FollowButton';
import { Spinner } from '../components/Spinner';
import { useResource } from '../hooks/useResource';
import type { UserSummary } from '../types';

const DEBOUNCE_MS = 300;

/** Find readers by name; the query lives in the URL (?q=). */
export function PeoplePage() {
  const [params, setParams] = useSearchParams();
  const q = (params.get('q') ?? '').trim();
  const [text, setText] = useState(params.get('q') ?? '');

  // Update the URL (and so the search) shortly after typing stops.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (text.trim() !== q) setParams(text.trim() ? { q: text.trim() } : {}, { replace: true });
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [text, q, setParams]);

  const { data, error, loading, reload, setData } = useResource<UserSummary[]>(
    q ? q.toLowerCase() : null,
    (signal) => searchUsers(q, signal),
  );

  return (
    <section aria-labelledby="people-heading" className="narrow">
      <h1 id="people-heading" className="page-title">
        Find readers
      </h1>
      <form role="search" className="people-search" onSubmit={(e) => e.preventDefault()}>
        <label htmlFor="people-q" className="visually-hidden">
          Search people
        </label>
        <input
          id="people-q"
          type="search"
          placeholder="Search by name or @username"
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoComplete="off"
          autoFocus
        />
      </form>

      {!q && (
        <EmptyState title="Discover other readers" icon="🔭">
          Search for friends by name or username, see what they’re reading and follow them.
        </EmptyState>
      )}

      {q && error !== undefined && (
        <ErrorBanner error={error} onRetry={reload} retrying={loading} />
      )}
      {q && loading && data === undefined && <Spinner label="Searching…" />}

      {q && data !== undefined && !loading && data.length === 0 && (
        <EmptyState title={`No one matches “${q}”`} icon="🔍">
          Check the spelling, or try part of their name.
        </EmptyState>
      )}

      {q && data !== undefined && data.length > 0 && (
        <ul className="people-list" aria-label="People" aria-busy={loading || undefined}>
          {data.map((person) => (
            <li key={person.username} className="person card">
              <Link to={`/u/${person.username}`} className="person__link">
                <Avatar name={person.display_name} username={person.username} />
                <span className="person__names">
                  <span className="person__name">{person.display_name}</span>
                  <span className="person__handle">
                    @{person.username}
                    {!person.is_public && (
                      <span className="lock" title="Private profile">
                        {' '}
                        · Private
                      </span>
                    )}
                  </span>
                </span>
              </Link>
              {person.follow_status === 'self' ? (
                <span className="muted small">You</span>
              ) : (
                <FollowButton
                  size="small"
                  username={person.username}
                  displayName={person.display_name}
                  isPublic={person.is_public}
                  status={person.follow_status}
                  onChange={(status) =>
                    setData((list) =>
                      (list ?? []).map((p) =>
                        p.username === person.username ? { ...p, follow_status: status } : p,
                      ),
                    )
                  }
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
