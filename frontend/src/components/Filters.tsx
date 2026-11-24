import { GENRES, MAX_RATING, MIN_RATING, isGenre, type TropeCount } from '../types';
import type { FilterState, ReadFilter } from '../lib/filters';

interface Props {
  value: FilterState;
  onChange: (patch: Partial<FilterState>) => void;
  onClear: () => void;
  isFiltered: boolean;
  /** Tropes in use, for the trope dropdown. */
  tropes: TropeCount[];
}

const RATINGS = Array.from({ length: MAX_RATING - MIN_RATING + 1 }, (_, i) => i + MIN_RATING);

export function Filters({ value, onChange, onClear, isFiltered, tropes }: Props) {
  // Keep a trope from the URL selectable even if no book uses it (any more).
  const tropeOptions =
    value.trope && !tropes.some((t) => t.name === value.trope)
      ? [...tropes, { name: value.trope, book_count: 0 }]
      : tropes;

  return (
    <form
      className="filters"
      role="search"
      aria-label="Filter books"
      onSubmit={(e) => e.preventDefault()}
    >
      <div className="field">
        <label htmlFor="filter-genre">Genre</label>
        <select
          id="filter-genre"
          value={value.genre}
          onChange={(e) => onChange({ genre: isGenre(e.target.value) ? e.target.value : '' })}
        >
          <option value="">All genres</option>
          {GENRES.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="filter-status">Status</label>
        <select
          id="filter-status"
          value={value.read}
          onChange={(e) => onChange({ read: e.target.value as ReadFilter })}
        >
          <option value="all">All</option>
          <option value="read">Read</option>
          <option value="unread">Unread</option>
        </select>
      </div>

      <div className="field">
        <label htmlFor="filter-rating">Minimum rating</label>
        <select
          id="filter-rating"
          value={value.minRating ?? ''}
          onChange={(e) => onChange({ minRating: e.target.value ? Number(e.target.value) : null })}
        >
          <option value="">Any</option>
          {RATINGS.map((r) => (
            <option key={r} value={r}>
              {'★'.repeat(r)} {r}+
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="filter-trope">Trope</label>
        <select
          id="filter-trope"
          value={value.trope}
          onChange={(e) => onChange({ trope: e.target.value })}
        >
          <option value="">All tropes</option>
          {tropeOptions.map((t) => (
            <option key={t.name} value={t.name}>
              {t.name} ({t.book_count})
            </option>
          ))}
        </select>
      </div>

      {isFiltered && (
        <button type="button" className="btn btn--ghost filters__clear" onClick={onClear}>
          Clear filters
        </button>
      )}
    </form>
  );
}
