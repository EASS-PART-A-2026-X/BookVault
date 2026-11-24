import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ApiError, ValidationError, register } from '../api/books';
import { useAuth } from '../auth/context';
import { safeNext } from '../auth/next';
import { Spinner } from '../components/Spinner';
import { TextField } from '../components/TextField';
import {
  REGISTER_FIELDS,
  validateRegister,
  validateRegisterField,
  type RegisterField,
  type RegisterValues,
} from '../lib/authValidation';
import { describeError, mapIssuesToFields } from '../lib/errors';
import { useToast } from '../toast/context';
import { PASSWORD_MIN_LENGTH } from '../types';
import { AuthCard } from './LoginPage';

const EMPTY: RegisterValues = { username: '', display_name: '', password: '', confirm: '' };

export function RegisterPage() {
  const { setUser } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));

  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<RegisterField, string>>>({});
  const [touched, setTouched] = useState<Partial<Record<RegisterField, boolean>>>({});
  const [formError, setFormError] = useState<ReactNode>(null);
  const [submitting, setSubmitting] = useState(false);
  const busy = useRef(false);

  function set(field: RegisterField, value: string) {
    const updated = { ...values, [field]: value };
    setValues(updated);
    if (touched[field] || errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: validateRegisterField(field, updated) }));
    }
  }

  function blur(field: RegisterField) {
    setTouched((prev) => ({ ...prev, [field]: true }));
    setErrors((prev) => ({ ...prev, [field]: validateRegisterField(field, values) }));
  }

  function focusFirst(fieldErrors: Partial<Record<RegisterField, string>>) {
    const first = REGISTER_FIELDS.find((f) => fieldErrors[f]);
    if (first) window.setTimeout(() => document.getElementById(first)?.focus());
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy.current) return;
    const clientErrors = validateRegister(values);
    setErrors(clientErrors);
    setTouched({ username: true, display_name: true, password: true, confirm: true });
    if (Object.keys(clientErrors).length > 0) {
      focusFirst(clientErrors);
      return;
    }
    busy.current = true;
    setSubmitting(true);
    setFormError(null);
    try {
      const user = await register({
        username: values.username,
        password: values.password,
        display_name: values.display_name.trim() || undefined,
      });
      setUser(user);
      toast.success(`Welcome to Book Vault, ${user.display_name}!`);
      navigate(next, { replace: true });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        const fieldErrors = { username: 'That username is taken. Try another one.' };
        setErrors(fieldErrors);
        focusFirst(fieldErrors);
      } else if (error instanceof ValidationError) {
        const { fieldErrors, formErrors } = mapIssuesToFields(error.issues, REGISTER_FIELDS);
        setErrors(fieldErrors);
        if (formErrors.length) setFormError(formErrors.join(' '));
        focusFirst(fieldErrors);
      } else {
        const { title, message } = describeError(error);
        setFormError(`${title}. ${message}`);
      }
    } finally {
      busy.current = false;
      setSubmitting(false);
    }
  }

  const field = (name: RegisterField) => ({
    id: name,
    value: values[name],
    onChange: (v: string) => set(name, v),
    onBlur: () => blur(name),
    error: errors[name],
  });

  return (
    <AuthCard title="Create your account" subtitle="Your books, your reviews, your vault.">
      <form
        className="book-form"
        onSubmit={handleSubmit}
        noValidate
        aria-busy={submitting || undefined}
      >
        {formError && (
          <div className="alert alert--error" role="alert">
            {formError}
          </div>
        )}
        <fieldset className="book-form__fields" disabled={submitting}>
          <TextField
            {...field('username')}
            label="Username"
            hint="3–30 characters: letters, numbers, “_” and “.”"
            autoComplete="username"
            required
          />
          <TextField
            {...field('display_name')}
            label={
              <>
                Display name <span className="hint">(optional)</span>
              </>
            }
            hint="Shown to other readers. Defaults to your username."
            autoComplete="nickname"
          />
          <TextField
            {...field('password')}
            label="Password"
            type="password"
            hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
            autoComplete="new-password"
            required
          />
          <TextField
            {...field('confirm')}
            label="Confirm password"
            type="password"
            autoComplete="new-password"
            required
          />
          <button
            type="submit"
            className="btn btn--primary btn--block"
            onMouseDown={(e) => e.preventDefault()}
          >
            {submitting ? (
              <>
                <Spinner label="Creating your account…" inline />
                <span aria-hidden="true">Creating account…</span>
              </>
            ) : (
              'Create account'
            )}
          </button>
        </fieldset>
      </form>
      <p className="auth-switch">
        Already have an account?{' '}
        <Link to={next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`}>Log in</Link>
      </p>
    </AuthCard>
  );
}
