import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import {
  EMPTY_FILTERS,
  filtersToParams,
  hasActiveFilters,
  parseFilters,
  toApiFilters,
  type FilterState,
} from '../lib/filters';

/** Filters live in the URL query string, so they survive a refresh and can be shared. */
export function useBookFilters() {
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.toString();

  const filters = useMemo(() => parseFilters(new URLSearchParams(search)), [search]);
  const apiFilters = useMemo(() => toApiFilters(filters), [filters]);

  const setFilters = useCallback(
    (patch: Partial<FilterState>) => {
      setSearchParams(filtersToParams({ ...filters, ...patch }), { replace: true });
    },
    [filters, setSearchParams],
  );

  const clearFilters = useCallback(() => {
    setSearchParams(filtersToParams(EMPTY_FILTERS), { replace: true });
  }, [setSearchParams]);

  return { filters, apiFilters, setFilters, clearFilters, isFiltered: hasActiveFilters(filters) };
}
