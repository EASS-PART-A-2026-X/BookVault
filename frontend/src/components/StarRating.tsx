import { MAX_RATING } from '../types';

const STARS = Array.from({ length: MAX_RATING }, (_, i) => i + 1);

interface DisplayProps {
  value: number | null;
}

/** Read-only stars, e.g. on a book card. */
export function Stars({ value }: DisplayProps) {
  const label = value === null ? 'Not rated' : `Rated ${value} out of ${MAX_RATING}`;
  return (
    <span className="stars" role="img" aria-label={label} title={label}>
      {STARS.map((n) => (
        <span
          key={n}
          className={value !== null && n <= value ? 'star star--on' : 'star'}
          aria-hidden="true"
        >
          ★
        </span>
      ))}
    </span>
  );
}

interface InputProps {
  value: number | null;
  onChange: (value: number | null) => void;
  disabled?: boolean;
  /** Accessible name of the group, e.g. "Rating". */
  label: string;
  /** Show a "Clear" button to go back to no rating. */
  clearable?: boolean;
  id?: string;
  invalid?: boolean;
  describedBy?: string;
}

/** Clickable stars. Each star is a toggle button: "Rate 3 out of 5". */
export function StarInput({
  value,
  onChange,
  disabled = false,
  label,
  clearable = true,
  id,
  invalid = false,
  describedBy,
}: InputProps) {
  return (
    <div
      className="star-input"
      role="group"
      aria-label={label}
      id={id}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
    >
      {STARS.map((n) => {
        const on = value !== null && n <= value;
        return (
          <button
            key={n}
            type="button"
            className={on ? 'star-btn star-btn--on' : 'star-btn'}
            aria-label={`Rate ${n} out of ${MAX_RATING}`}
            aria-pressed={value === n}
            disabled={disabled}
            onClick={() => onChange(n)}
          >
            ★
          </button>
        );
      })}
      {clearable && value !== null && (
        <button
          type="button"
          className="btn btn--link"
          disabled={disabled}
          onClick={() => onChange(null)}
        >
          Clear
        </button>
      )}
    </div>
  );
}
