import { createContext, useContext } from 'react';

export interface RequestCountApi {
  /** Pending incoming follow requests (0 while unknown). */
  count: number;
  refresh: () => void;
}

export const RequestCountContext = createContext<RequestCountApi>({ count: 0, refresh: () => {} });

export function useRequestCount(): RequestCountApi {
  return useContext(RequestCountContext);
}
