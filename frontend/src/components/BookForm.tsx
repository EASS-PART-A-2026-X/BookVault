import { useId, useRef, useState, type FormEvent, type MouseEvent, type ReactNode } from 'react';
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
  // Client and server errors are kept apart: leaving a field re-runs the client
  // check, which must not wipe a 422 message the server gave for that field.
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});
  const [touched, setTouched] = useState<Partial<Record<FieldName, boolean>>>({});
  const [formError, setFormError] = useState<ReactNode>(null);
  const [submitting, setSubmitting] = useState(false);
  // A ref as well as state: blocks a second submit even before React re-renders.
  const submittingRef = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const formErrorRef = useRef<HTMLDivElement>(null);

  /** What's shown per field: the client error if any, else the server's. */
  const shown = (field: FieldName) => errors[field] ?? serverErrors[field];

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
    // so errors clear as soon as they're fixed.
    if (touched[field] || errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: validateField(field, next) }));
    }
    // Editing a field the server rejected means the user is fixing it.
    if (serverErrors[field]) setServerErrors((prev) => ({ ...prev, [field]: undefined }));
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
    setServerErrors({});
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
        setServerErrors(fieldErrors);
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

  /**
   * Pressing a form button would blur the current field first; its blur check can
   * insert an error message above the buttons and shift them down, so the click
   * lands beside the button and is lost. Keeping focus in the field until the click
   * fires avoids that; submit then validates everything itself.
   */
  function keepFocus(event: MouseEvent) {
    event.preventDefault();
  }

  /** Props wiring a control to its error message for assistive tech. */
  function a11y(field: FieldName) {
    return {
      'aria-invalid': shown(field) ? true : undefined,
      'aria-describedby': shown(field) ? errorId(field) : undefined,
    };
  }

  function fieldError(field: FieldName) {
    const message = shown(field);
    if (!message) return null;
    return (
      <p className="field-error" id={errorId(field)}>
        {message}
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
        <div className={shown('title') ? 'field field--invalid' : 'field'}>
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

        <div className={shown('author') ? 'field field--invalid' : 'field'}>
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

        <div className={shown('genre') ? 'field field--invalid' : 'field'}>
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

        <div className={shown('rating') ? 'field field--invalid' : 'field'}>
          <span className="label">
            Rating <span className="hint">(optional)</span>
          </span>
          <StarInput
            id={id('rating')}
            label="Rating"
            value={values.rating}
            onChange={(r) => update('rating', r)}
            disabled={submitting}
            invalid={Boolean(shown('rating'))}
            describedBy={shown('rating') ? errorId('rating') : undefined}
          />
          {fieldError('rating')}
        </div>

        <div className={shown('is_read') ? 'field field--invalid' : 'field'}>
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

        <div className={shown('review') ? 'field field--invalid' : 'field'}>
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
            <button
              type="button"
              className="btn btn--ghost"
              onMouseDown={keepFocus}
              onClick={onCancel}
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            className="btn btn--primary"
            onMouseDown={keepFocus}
            aria-busy={submitting || undefined}
          >
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
