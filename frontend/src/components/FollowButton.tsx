import { useState } from 'react';
import { followUser, unfollowUser } from '../api/books';
import { describeError } from '../lib/errors';
import { useToast } from '../toast/context';
import type { FollowStatus } from '../types';
import { ConfirmDialog } from './ConfirmDialog';

interface Props {
  username: string;
  displayName: string;
  isPublic: boolean;
  status: FollowStatus;
  onChange: (status: FollowStatus) => void;
  size?: 'small' | 'normal';
}

/**
 * Follow / Request to follow / Requested (click to cancel) / Following (click to
 * unfollow). Unfollowing a private profile asks first, because getting back in needs
 * their approval again.
 */
export function FollowButton({
  username,
  displayName,
  isPublic,
  status,
  onChange,
  size = 'normal',
}: Props) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  if (status === 'self') return null;

  async function run(action: () => Promise<FollowStatus>, success: (s: FollowStatus) => string) {
    setBusy(true);
    try {
      const next = await action();
      onChange(next);
      toast.success(success(next));
    } catch (error) {
      toast.error(describeError(error).message);
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  const follow = () =>
    run(
      () => followUser(username),
      (s) =>
        s === 'following' ? `You’re following ${displayName}.` : `Request sent to ${displayName}.`,
    );
  const unfollow = (message: string) =>
    run(
      async () => {
        await unfollowUser(username);
        return 'none';
      },
      () => message,
    );

  const small = size === 'small' ? ' btn--small' : '';
  let button;
  if (status === 'none') {
    button = (
      <button type="button" className={`btn btn--primary${small}`} onClick={follow} disabled={busy}>
        {busy ? 'Sending…' : isPublic ? 'Follow' : 'Request to follow'}
      </button>
    );
  } else if (status === 'requested') {
    button = (
      <button
        type="button"
        className={`btn btn--ghost${small}`}
        onClick={() => unfollow('Request cancelled.')}
        disabled={busy}
        title="Click to cancel your request"
        aria-label={`Requested. Cancel your request to follow ${displayName}`}
      >
        {busy ? 'Cancelling…' : 'Requested'}
      </button>
    );
  } else {
    button = (
      <button
        type="button"
        className={`btn btn--ghost btn--following${small}`}
        onClick={() => (isPublic ? unfollow(`Unfollowed ${displayName}.`) : setConfirming(true))}
        disabled={busy}
        aria-label={`Following. Unfollow ${displayName}`}
      >
        {busy ? 'Updating…' : 'Following'}
      </button>
    );
  }

  return (
    <>
      {button}
      <ConfirmDialog
        open={confirming}
        title={`Unfollow ${displayName}?`}
        confirmLabel="Unfollow"
        danger
        busy={busy}
        onConfirm={() => unfollow(`Unfollowed ${displayName}.`)}
        onCancel={() => setConfirming(false)}
      >
        <p>Their profile is private: to see their books again you’ll have to send a new request.</p>
      </ConfirmDialog>
    </>
  );
}
