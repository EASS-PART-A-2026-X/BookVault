import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { requestPasswordReset } from '../api/books';
import { Spinner } from '../components/Spinner';
import { TextField } from '../components/TextField';
import { validateEmail } from '../lib/authValidation';
import { describeError } from '../lib/errors';
import { EMAIL_MAX_LENGTH, normalizeEmail } from '../types';
import { AuthCard } from './LoginPage';

/** Ask for a reset link. The answer never says whether the email has an account. */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const busy = useRef(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy.current) return;
    const clientError = validateEmail(email);
    setError(clientError);
    if (clientError) {
      document.getElementById('email')?.focus();
      return;
    }
    busy.current = true;
    setSubmitting(true);
    setFormError(null);
    try {
      setSent(await requestPasswordReset(normalizeEmail(email)));
    } catch (err) {
      const { title, message } = describeError(err);
      setFormError(`${title}. ${message}`);
    } finally {
      busy.current = false;
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <AuthCard title="Check your email" subtitle="Reset your password.">
        <div className="alert alert--success" role="status">
          {sent}
        </div>
        <p className="muted small">
          No email after a few minutes? Check your spam folder, or make sure you used the address on
          your account.
        </p>
        <p className="auth-switch">
          <Link to="/login">Back to log in</Link>
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Forgot your password?"
      subtitle="Enter your account’s email and we’ll send you a link to choose a new one."
    >
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
            id="email"
            label="Email"
            type="email"
            value={email}
            onChange={(value) => {
              setEmail(value);
              if (error) setError(undefined);
            }}
            error={error}
            autoComplete="email"
            maxLength={EMAIL_MAX_LENGTH}
            required
          />
          <button
            type="submit"
            className="btn btn--primary btn--block"
            onMouseDown={(e) => e.preventDefault()}
          >
            {submitting ? (
              <>
                <Spinner label="Sending the link…" inline />
                <span aria-hidden="true">Sending…</span>
              </>
            ) : (
              'Send reset link'
            )}
          </button>
        </fieldset>
      </form>
      <p className="auth-switch">
        Remembered it? <Link to="/login">Log in</Link>
      </p>
    </AuthCard>
  );
}
