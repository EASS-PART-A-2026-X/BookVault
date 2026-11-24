import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ValidationError } from '../api/books';
import type { BookFormValues } from '../lib/bookForm';
import { describeError, mapValidationIssues } from '../lib/errors';
import {
  firstInvalidField,
  validateBook,
  validateField,
  type FieldErrors,
  type FieldName,
} from '../lib/validation';
import { GENRES, isGenre } from '../types';
import { Spinner } from './Spinner';
import { StarInput } from './StarRating';

interface Props {
  initialValues: BookFormValues;
  submitLabel: string;
  /** Label while saving, e.g. "Adding…". */
  submittingLabel?: string;
  /** Resolve on success; throw to keep the form open and show the error. */
  onSubmit: (values: BookFormValues) => Promise<void>;
  onCancel?: () => void;
}

/**
 * Shared add/edit form.
 * - Validates like the backend: a field is checked when it loses focus, then live
 *   while it's wrong; everything is checked on submit, and the first problem is focused.
 * - A server 422 is mapped back onto the matching fields.
 * - While saving, every control is disabled, so the form can't be submitted twice.
 */
export function BookForm({
  initialValues,
  submitLabel,
  submittingLabel = 'Saving…',
  onSubmit,
  onCancel,
}: Props) {
  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [touched, setTouched] = useState<Partial<Record<FieldName, boolean>>>({});
  const [formError, setFormError] = useState<ReactNode>(null);
  const [submitting, setSubmitting] = useState(false);
  // A ref as well as state: blocks a second submit even before React re-renders.
  const submittingRef = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const formErrorRef = useRef<HTMLDivElement>(null);

  const uid = useId();
  const id = (field: FieldName) => `${uid}-${field}`;
  const errorId = (field: FieldName) => `${uid}-${field}-error`;

  function focusField(field: FieldName) {
    const el = formRef.current?.querySelector<HTMLElement>(
      field === 'rating' ? `[id="${id(field)}"] button` : `[id="${id(field)}"]`,
    );
    el?.focus();
  }

  function update<K extends FieldName>(field: K, value: BookFormValues[K]) {
    const next = { ...values, [field]: value };
    setValues(next);
    // Live re-validation once the user has left the field (or after a submit),
    // so errors clear as soon as they're fixed. Server errors on this field go too.
    if (touched[field] || errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: validateField(field, next) }));
    }
  }

  function blur(field: FieldName) {
    setTouched((prev) => ({ ...prev, [field]: true }));
    setErrors((prev) => ({ ...prev, [field]: validateField(field, values) }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submittingRef.current) return;

    const clientErrors = validateBook(values);
    setTouched({ title: true, author: true, genre: true, rating: true });
    setErrors(clientErrors);
    const first = firstInvalidField(clientErrors);
    if (first) {
      setFormError(null);
      focusField(first);
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    setFormError(null);
    try {
      await onSubmit(values);
    } catch (error) {
      if (error instanceof ValidationError) {
        const { fieldErrors, formErrors } = mapValidationIssues(error.issues);
        setErrors(fieldErrors);
        setFormError(
          formErrors.length > 0 ? (
            <>
              <strong>The server rejected this book:</strong>
              <ul>
                {formErrors.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </>
          ) : (
            'The server rejected some fields. Check the messages below.'
          ),
        );
        const firstServer = firstInvalidField(fieldErrors);
        // Focus after the fieldset is re-enabled.
        window.setTimeout(() => {
          if (firstServer) focusField(firstServer);
          else formErrorRef.current?.focus();
        });
      } else {
        const { title, message } = describeError(error);
        setFormError(
          <>
            <strong>{title}.</strong> {message} Your changes have not been saved.
          </>,
        );
        window.setTimeout(() => formErrorRef.current?.focus());
      }
      return;
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  /** Props wiring a control to its error message for assistive tech. */
  function a11y(field: FieldName) {
    return {
      'aria-invalid': errors[field] ? true : undefined,
      'aria-describedby': errors[field] ? errorId(field) : undefined,
    };
  }

  function fieldError(field: FieldName) {
    if (!errors[field]) return null;
    return (
      <p className="field-error" id={errorId(field)}>
        {errors[field]}
      </p>
    );
  }

  return (
    <form
      ref={formRef}
      className="book-form"
      onSubmit={handleSubmit}
      noValidate
      aria-busy={submitting || undefined}
    >
      {formError && (
        <div ref={formErrorRef} className="alert alert--error" role="alert" tabIndex={-1}>
          <div>{formError}</div>
        </div>
      )}

      <fieldset className="book-form__fields" disabled={submitting}>
        <div className={errors.title ? 'field field--invalid' : 'field'}>
          <label htmlFor={id('title')}>Title</label>
          <input
            id={id('title')}
            name="title"
            value={values.title}
            onChange={(e) => update('title', e.target.value)}
            onBlur={() => blur('title')}
            autoComplete="off"
            aria-required="true"
            {...a11y('title')}
          />
          {fieldError('title')}
        </div>

        <div className={errors.author ? 'field field--invalid' : 'field'}>
          <label htmlFor={id('author')}>Author</label>
          <input
            id={id('author')}
            name="author"
            value={values.author}
            onChange={(e) => update('author', e.target.value)}
            onBlur={() => blur('author')}
            autoComplete="off"
            aria-required="true"
            {...a11y('author')}
          />
          {fieldError('author')}
        </div>

        <div className={errors.genre ? 'field field--invalid' : 'field'}>
          <label htmlFor={id('genre')}>Genre</label>
          <select
            id={id('genre')}
            name="genre"
            value={values.genre}
            onChange={(e) => update('genre', isGenre(e.target.value) ? e.target.value : '')}
            onBlur={() => blur('genre')}
            aria-required="true"
            {...a11y('genre')}
          >
            <option value="">Choose a genre…</option>
            {GENRES.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
          {fieldError('genre')}
        </div>

        <div className={errors.rating ? 'field field--invalid' : 'field'}>
          <span className="label">
            Rating <span className="hint">(optional)</span>
          </span>
          <StarInput
            id={id('rating')}
            label="Rating"
            value={values.rating}
            onChange={(r) => update('rating', r)}
            disabled={submitting}
            invalid={Boolean(errors.rating)}
            describedBy={errors.rating ? errorId('rating') : undefined}
          />
          {fieldError('rating')}
        </div>

        <div className={errors.is_read ? 'field field--invalid' : 'field'}>
          <div className="field--inline">
            <input
              id={id('is_read')}
              name="is_read"
              type="checkbox"
              checked={values.is_read}
              onChange={(e) => update('is_read', e.target.checked)}
              {...a11y('is_read')}
            />
            <label htmlFor={id('is_read')}>I've read this book</label>
          </div>
          {fieldError('is_read')}
        </div>

        <div className={errors.review ? 'field field--invalid' : 'field'}>
          <label htmlFor={id('review')}>
            Review <span className="hint">(optional)</span>
          </label>
          <textarea
            id={id('review')}
            name="review"
            rows={4}
            value={values.review}
            onChange={(e) => update('review', e.target.value)}
            {...a11y('review')}
          />
          {fieldError('review')}
        </div>

        <div className="form-actions">
          {onCancel && (
            <button type="button" className="btn btn--ghost" onClick={onCancel}>
              Cancel
            </button>
          )}
          <button type="submit" className="btn btn--primary" aria-busy={submitting || undefined}>
            {submitting ? (
              <>
                <Spinner label={submittingLabel} inline />
                <span aria-hidden="true">{submittingLabel}</span>
              </>
            ) : (
              submitLabel
            )}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
