import { useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  ApiError,
  getFollowers,
  getFollowing,
  getProfile,
  getUserBooks,
  removeFollower,
} from '../api/books';
import { useAuth } from '../auth/context';
import { Avatar } from '../components/Avatar';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner } from '../components/ErrorBanner';
import { FollowButton } from '../components/FollowButton';
import { ReviewCard } from '../components/ReviewCard';
import { Spinner } from '../components/Spinner';
import { useResource } from '../hooks/useResource';
import { describeError } from '../lib/errors';
import { formatDate } from '../lib/format';
import { useToast } from '../toast/context';
import type { Profile, UserSummary } from '../types';
import { NotFoundPage } from './NotFoundPage';

type Tab = 'books' | 'followers' | 'following';

export function ProfilePage() {
  const username = (useParams().username ?? '').toLowerCase();
  const profile = useResource<Profile>(username, (signal) => getProfile(username, signal));

  if (profile.error instanceof ApiError && profile.error.status === 404) {
    return (
      <NotFoundPage
        title="Reader not found"
        message={`There’s no one called @${username} on Book Vault.`}
      />
    );
  }
  if (profile.data === undefined || profile.data.username !== username) {
    return profile.error !== undefined ? (
      <div className="narrow">
        <ErrorBanner error={profile.error} onRetry={profile.reload} retrying={profile.loading} />
      </div>
    ) : (
      <div className="narrow page-loading">
        <Spinner label="Loading profile…" />
      </div>
    );
  }
  return (
    <ProfileView
      key={username}
      profile={profile.data}
      onProfileChange={(p) => profile.setData(() => p)}
      reloadProfile={profile.reload}
    />
  );
}

function ProfileView({
  profile,
  onProfileChange,
  reloadProfile,
}: {
  profile: Profile;
  onProfileChange: (profile: Profile) => void;
  reloadProfile: () => void;
}) {
  const [tab, setTab] = useState<Tab>('books');
  const isSelf = profile.follow_status === 'self';

  return (
    <article className="profile" aria-labelledby="profile-name">
      <header className="profile__header card">
        <Avatar name={profile.display_name} username={profile.username} size="lg" />
        <div className="profile__info">
          <h1 id="profile-name" className="profile__name">
            {profile.display_name}
          </h1>
          <p className="profile__handle">
            @{profile.username}
            <span className="badge profile__visibility">
              {profile.is_public ? 'Public' : 'Private'}
            </span>
            {profile.follows_you && <span className="badge badge--gold">Follows you</span>}
          </p>
          {profile.bio && <p className="profile__bio">{profile.bio}</p>}
          <p className="muted small">Joined {formatDate(profile.created_at)}</p>
        </div>
        <div className="profile__action">
          {isSelf ? (
            <Link to="/settings" className="btn btn--ghost">
              Edit profile
            </Link>
          ) : (
            <FollowButton
              username={profile.username}
              displayName={profile.display_name}
              isPublic={profile.is_public}
              status={profile.follow_status}
              onChange={() => reloadProfile()}
            />
          )}
        </div>
        <dl className="profile__stats">
          <Stat
            label="Books"
            value={profile.book_count}
            onClick={() => setTab('books')}
            active={tab === 'books'}
            enabled={profile.can_view_books}
          />
          <Stat
            label="Followers"
            value={profile.follower_count}
            onClick={() => setTab('followers')}
            active={tab === 'followers'}
            enabled={profile.can_view_books}
          />
          <Stat
            label="Following"
            value={profile.following_count}
            onClick={() => setTab('following')}
            active={tab === 'following'}
            enabled={profile.can_view_books}
          />
        </dl>
      </header>

      {!profile.can_view_books ? (
        <EmptyState title="This profile is private" icon="🔒">
          {profile.follow_status === 'requested'
            ? `Your request is waiting for ${profile.display_name} to accept it.`
            : `Follow ${profile.display_name} to see their books and reviews. They’ll need to accept your request.`}
        </EmptyState>
      ) : tab === 'books' ? (
        <BooksTab profile={profile} />
      ) : (
        <PeopleTab
          key={tab}
          profile={profile}
          which={tab}
          onRemoved={() =>
            onProfileChange({ ...profile, follower_count: Math.max(0, profile.follower_count - 1) })
          }
        />
      )}
    </article>
  );
}

function Stat({
  label,
  value,
  onClick,
  active,
  enabled,
}: {
  label: string;
  value: number;
  onClick: () => void;
  active: boolean;
  enabled: boolean;
}) {
  return (
    <div className="stat">
      <dt className="stat__label">{label}</dt>
      <dd className="stat__value">
        {enabled ? (
          <button
            type="button"
            className={active ? 'stat__button stat__button--active' : 'stat__button'}
            aria-pressed={active}
            aria-label={`${value} ${label}`}
            onClick={onClick}
          >
            {value}
          </button>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

function BooksTab({ profile }: { profile: Profile }) {
  const books = useResource(`books@${profile.username}`, (signal) =>
    getUserBooks(profile.username, signal),
  );
  if (books.error !== undefined)
    return <ErrorBanner error={books.error} onRetry={books.reload} retrying={books.loading} />;
  if (books.data === undefined) return <Spinner label="Loading books…" />;
  if (books.data.length === 0) {
    return (
      <EmptyState title="No books yet" icon="📚">
        {profile.follow_status === 'self'
          ? 'Books you add will show up here for your followers.'
          : `${profile.display_name} hasn’t added any books yet.`}
      </EmptyState>
    );
  }
  return (
    <section aria-label={`${profile.display_name}’s books`}>
      <ul className="book-grid review-grid">
        {books.data.map((book) => (
          <li key={book.id}>
            <ReviewCard book={book} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function PeopleTab({
  profile,
  which,
  onRemoved,
}: {
  profile: Profile;
  which: 'followers' | 'following';
  onRemoved: () => void;
}) {
  const { user } = useAuth();
  const toast = useToast();
  const people = useResource<UserSummary[]>(`${which}@${profile.username}`, (signal) =>
    which === 'followers'
      ? getFollowers(profile.username, signal)
      : getFollowing(profile.username, signal),
  );
  const ownFollowers = which === 'followers' && profile.username === user?.username;

  async function remove(person: UserSummary) {
    try {
      await removeFollower(person.username);
      people.setData((list) => (list ?? []).filter((p) => p.username !== person.username));
      onRemoved();
      toast.success(`Removed ${person.display_name} from your followers.`);
    } catch (error) {
      toast.error(describeError(error).message);
    }
  }

  if (people.error !== undefined)
    return <ErrorBanner error={people.error} onRetry={people.reload} retrying={people.loading} />;
  if (people.data === undefined) return <Spinner label="Loading…" />;
  if (people.data.length === 0) {
    return (
      <EmptyState
        title={which === 'followers' ? 'No followers yet' : 'Not following anyone yet'}
        icon="👥"
      />
    );
  }
  return (
    <ul className="people-list" aria-label={which === 'followers' ? 'Followers' : 'Following'}>
      {people.data.map((person) => (
        <li key={person.username} className="person card">
          <Link to={`/u/${person.username}`} className="person__link">
            <Avatar name={person.display_name} username={person.username} />
            <span className="person__names">
              <span className="person__name">{person.display_name}</span>
              <span className="person__handle">@{person.username}</span>
            </span>
          </Link>
          {ownFollowers && (
            <button
              type="button"
              className="btn btn--ghost btn--small"
              onClick={() => remove(person)}
            >
              Remove
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
