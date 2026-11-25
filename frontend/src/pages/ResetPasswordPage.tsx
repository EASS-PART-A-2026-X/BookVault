import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ApiError, ValidationError, confirmPasswordReset } from '../api/books';
import { useAuth } from '../auth/context';
import { Spinner } from '../components/Spinner';
import { TextField } from '../components/TextField';
import { validateNewPassword } from '../lib/authValidation';
import { describeError, mapIssuesToFields } from '../lib/errors';
import { useToast } from '../toast/context';
import { PASSWORD_MIN_LENGTH } from '../types';
import { AuthCard } from './LoginPage';

type Field = 'new_password' | 'confirm';

/** Opened from the emailed link: /reset-password?token=… */
export function ResetPasswordPage() {
  const auth = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  // Read once, then dropped from the address bar so it doesn't stay in the history.
  const [token] = useState(() => params.get('token') ?? '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState<ReactNode>(null);
  const [submitting, setSubmitting] = useState(false);
  const busy = useRef(false);

  useEffect(() => {
    if (params.has('token')) setParams({}, { replace: true });
  }, [params, setParams]);

  if (!token) {
    return (
      <AuthCard title="Reset your password" subtitle="This page needs the link from your email.">
        <div className="alert alert--error" role="alert">
          This reset link is incomplete. Open the link from the email again, or ask for a new one.
        </div>
        <p className="auth-switch">
          <Link to="/forgot-password">Send me a new link</Link>
        </p>
      </AuthCard>
    );
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy.current) return;
    const clientErrors: Partial<Record<Field, string>> = {};
    const passwordError = validateNewPassword(password);
    if (passwordError) clientErrors.new_password = passwordError;
    if (confirm !== password) clientErrors.confirm = 'Passwords don’t match.';
    setErrors(clientErrors);
    if (Object.keys(clientErrors).length) {
      document.getElementById(clientErrors.new_password ? 'new_password' : 'confirm')?.focus();
      return;
    }
    busy.current = true;
    setSubmitting(true);
    setFormError(null);
    try {
      await confirmPasswordReset(token, password);
      // The reset logged the account out everywhere, this browser included.
      if (auth.user) await auth.logout().catch(() => undefined);
      toast.success('Password changed. Log in with your new password.');
      navigate('/login', { replace: true });
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) {
        setFormError(
          <>
            {error.message} <Link to="/forgot-password">Send me a new link</Link>
          </>,
        );
      } else if (error instanceof ValidationError) {
        const mapped = mapIssuesToFields(error.issues, ['new_password'] as Field[]);
        setErrors(mapped.fieldErrors);
        if (mapped.formErrors.length) setFormError(mapped.formErrors.join(' '));
      } else {
        const { title, message } = describeError(error);
        setFormError(`${title}. ${message}`);
      }
    } finally {
      busy.current = false;
      setSubmitting(false);
    }
  }

  return (
    <AuthCard title="Choose a new password" subtitle="You’ll be logged out on every device.">
      <form
        className="book-form"
        onSubmit={handleSubmit}
        noValidate
        aria-busy={submitting || undefined}
      >
        {formError && (
          <div className="alert alert--error" role="alert">
            <span>{formError}</span>
          </div>
        )}
        <fieldset className="book-form__fields" disabled={submitting}>
          <TextField
            id="new_password"
            label="New password"
            type="password"
            value={password}
            onChange={(v) => {
              setPassword(v);
              if (errors.new_password) setErrors((e) => ({ ...e, new_password: undefined }));
            }}
            error={errors.new_password}
            hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
            autoComplete="new-password"
            required
          />
          <TextField
            id="confirm"
            label="Confirm new password"
            type="password"
            value={confirm}
            onChange={(v) => {
              setConfirm(v);
              if (errors.confirm) setErrors((e) => ({ ...e, confirm: undefined }));
            }}
            error={errors.confirm}
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
                <Spinner label="Saving your new password…" inline />
                <span aria-hidden="true">Saving…</span>
              </>
            ) : (
              'Set new password'
            )}
          </button>
        </fieldset>
      </form>
    </AuthCard>
  );
}
