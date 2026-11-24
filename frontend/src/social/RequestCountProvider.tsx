import { useMemo, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import { listFollowRequests } from '../api/books';
import { useResource } from '../hooks/useResource';
import { RequestCountContext } from './requestCount';

/** Keeps the header's request badge fresh: on every page change and on demand. */
export function RequestCountProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  const { pathname } = useLocation();
  const { data, reload } = useResource(enabled ? `requests@${pathname}` : null, (signal) =>
    listFollowRequests(signal),
  );
  const value = useMemo(
    () => ({ count: enabled ? (data?.length ?? 0) : 0, refresh: reload }),
    [enabled, data, reload],
  );
  return <RequestCountContext.Provider value={value}>{children}</RequestCountContext.Provider>;
}
