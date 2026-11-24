import { useId, useState, type FormEvent } from 'react';
import { GENRES, isGenre } from '../types';
import type { BookFormValues } from '../lib/bookForm';
import { StarInput } from './StarRating';

interface Props {
  initialValues: BookFormValues;
  submitLabel: string;
  /** Resolve on success; throw to keep the form open (the error is shown). */
  onSubmit: (values: BookFormValues) => Promise<void>;
  onCancel?: () => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

/** Shared add/edit form. */
export function BookForm({ initialValues, submitLabel, onSubmit, onCancel }: Props) {
  const [values, setValues] = useState(initialValues);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const uid = useId();
  const ids = {
    title: `${uid}-title`,
    author: `${uid}-author`,
    genre: `${uid}-genre`,
    rating: `${uid}-rating`,
    isRead: `${uid}-is-read`,
    review: `${uid}-review`,
  };

  function set<K extends keyof BookFormValues>(field: K, value: BookFormValues[K]) {
    setValues((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setFormError(null);
    try {
      await onSubmit(values);
    } catch (error) {
      setFormError(errorMessage(error));
      setSubmitting(false);
      return;
    }
    // On success the parent usually navigates away or swaps this form out.
    setSubmitting(false);
  }

  return (
    <form className="book-form" onSubmit={handleSubmit} aria-busy={submitting || undefined}>
      {formError && (
        <div className="alert alert--error" role="alert">
          {formError}
        </div>
      )}

      <div className="field">
        <label htmlFor={ids.title}>Title</label>
        <input
          id={ids.title}
          name="title"
          value={values.title}
          onChange={(e) => set('title', e.target.value)}
          autoComplete="off"
        />
      </div>

      <div className="field">
        <label htmlFor={ids.author}>Author</label>
        <input
          id={ids.author}
          name="author"
          value={values.author}
          onChange={(e) => set('author', e.target.value)}
          autoComplete="off"
        />
      </div>

      <div className="field">
        <label htmlFor={ids.genre}>Genre</label>
        <select
          id={ids.genre}
          name="genre"
          value={values.genre}
          onChange={(e) => set('genre', isGenre(e.target.value) ? e.target.value : '')}
        >
          <option value="">Choose a genre…</option>
          {GENRES.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <span className="label" id={`${ids.rating}-label`}>
          Rating <span className="hint">(optional)</span>
        </span>
        <StarInput
          id={ids.rating}
          label="Rating"
          value={values.rating}
          onChange={(r) => set('rating', r)}
          disabled={submitting}
        />
      </div>

      <div className="field field--inline">
        <input
          id={ids.isRead}
          name="is_read"
          type="checkbox"
          checked={values.is_read}
          onChange={(e) => set('is_read', e.target.checked)}
        />
        <label htmlFor={ids.isRead}>I've read this book</label>
      </div>

      <div className="field">
        <label htmlFor={ids.review}>
          Review <span className="hint">(optional)</span>
        </label>
        <textarea
          id={ids.review}
          name="review"
          rows={4}
          value={values.review}
          onChange={(e) => set('review', e.target.value)}
        />
      </div>

      <div className="form-actions">
        {onCancel && (
          <button type="button" className="btn btn--ghost" onClick={onCancel} disabled={submitting}>
            Cancel
          </button>
        )}
        <button
          type="submit"
          className="btn btn--primary"
          disabled={submitting}
          aria-busy={submitting || undefined}
        >
          {submitting ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
