import { useId, type KeyboardEvent } from 'react';
import { addTrope } from '../lib/bookForm';
import { MAX_TROPES_PER_BOOK, TROPE_MAX_LENGTH, normalizeTrope } from '../types';

interface Props {
  id: string;
  /** Chosen tropes (normalised). */
  value: string[];
  onChange: (tropes: string[]) => void;
  /** Text typed but not yet added. Owned by the form so a submit can include it. */
  draft: string;
  onDraftChange: (draft: string) => void;
  /** Tropes already used in the vault, offered as suggestions. */
  suggestions: string[];
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
}

/**
 * Tag input for tropes: type and press Enter (or comma, or "Add"); pick from
 * suggestions of tropes you've used before; remove with × or Backspace.
 */
export function TropeInput({
  id,
  value,
  onChange,
  draft,
  onDraftChange,
  suggestions,
  disabled = false,
  invalid = false,
  describedBy,
}: Props) {
  const listId = useId();
  const hintId = useId();
  const full = value.length >= MAX_TROPES_PER_BOOK;
  const options = suggestions.filter((s) => !value.includes(s));

  function commit() {
    onChange(addTrope(value, draft));
    onDraftChange('');
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',') {
      // Enter would otherwise submit the whole form.
      event.preventDefault();
      commit();
    } else if (event.key === 'Backspace' && draft === '' && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div className={invalid ? 'trope-input trope-input--invalid' : 'trope-input'}>
      {value.length > 0 && (
        <ul className="chips" aria-label="Chosen tropes">
          {value.map((trope) => (
            <li key={trope} className="chip">
              <span>{trope}</span>
              <button
                type="button"
                className="chip__remove"
                aria-label={`Remove trope ${trope}`}
                disabled={disabled}
                onClick={() => onChange(value.filter((t) => t !== trope))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="trope-input__row">
        <input
          id={id}
          name="trope"
          list={listId}
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={handleKeyDown}
          maxLength={TROPE_MAX_LENGTH}
          placeholder={full ? `Maximum of ${MAX_TROPES_PER_BOOK} tropes` : 'e.g. enemies to lovers'}
          disabled={disabled || full}
          autoComplete="off"
          aria-invalid={invalid || undefined}
          aria-describedby={[hintId, describedBy].filter(Boolean).join(' ')}
        />
        <button
          type="button"
          className="btn btn--ghost"
          onClick={commit}
          disabled={disabled || full || normalizeTrope(draft) === ''}
        >
          Add
        </button>
      </div>
      <datalist id={listId}>
        {options.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <p className="hint small" id={hintId}>
        Press Enter or comma to add. Up to {MAX_TROPES_PER_BOOK}.
      </p>
    </div>
  );
}
