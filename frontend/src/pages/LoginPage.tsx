import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ApiError, login } from '../api/books';
import { useAuth } from '../auth/context';
import { safeNext } from '../auth/next';
import { Spinner } from '../components/Spinner';
import { TextField } from '../components/TextField';
import { VaultLogo } from '../components/VaultLogo';
import { validateLogin, type LoginValues } from '../lib/authValidation';
import { describeError } from '../lib/errors';
import { useToast } from '../toast/context';

export function LoginPage() {
  const { setUser } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));

  const [values, setValues] = useState<LoginValues>({ username: '', password: '' });
  const [errors, setErrors] = useState<Partial<Record<keyof LoginValues, string>>>({});
  const [formError, setFormError] = useState<ReactNode>(null);
  const [submitting, setSubmitting] = useState(false);
  const busy = useRef(false);

  function set(field: keyof LoginValues, value: string) {
    setValues((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy.current) return;
    const clientErrors = validateLogin(values);
    setErrors(clientErrors);
    if (Object.keys(clientErrors).length > 0) {
      document.getElementById(clientErrors.username ? 'username' : 'password')?.focus();
      return;
    }
    busy.current = true;
    setSubmitting(true);
    setFormError(null);
    try {
      const user = await login(values);
      setUser(user);
      toast.success(`Welcome back, ${user.display_name}.`);
      navigate(next, { replace: true });
    } catch (error) {
      setFormError(
        error instanceof ApiError && error.status === 401
          ? 'That username and password don’t match an account.'
          : `${describeError(error).title}. ${describeError(error).message}`,
      );
      setValues((prev) => ({ ...prev, password: '' }));
    } finally {
      busy.current = false;
      setSubmitting(false);
    }
  }

  return (
    <AuthCard title="Log in" subtitle="Welcome back to your vault.">
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
            id="username"
            label="Username"
            value={values.username}
            onChange={(v) => set('username', v)}
            error={errors.username}
            autoComplete="username"
            required
          />
          <TextField
            id="password"
            label="Password"
            type="password"
            value={values.password}
            onChange={(v) => set('password', v)}
            error={errors.password}
            autoComplete="current-password"
            required
          />
          <button
            type="submit"
            className="btn btn--primary btn--block"
            onMouseDown={(e) => e.preventDefault()}
          >
            {submitting ? (
              <>
                <Spinner label="Logging in…" inline />
                <span aria-hidden="true">Logging in…</span>
              </>
            ) : (
              'Log in'
            )}
          </button>
        </fieldset>
      </form>
      <p className="auth-switch">
        New here?{' '}
        <Link to={next === '/' ? '/register' : `/register?next=${encodeURIComponent(next)}`}>
          Create an account
        </Link>
      </p>
    </AuthCard>
  );
}

export function AuthCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <section className="auth" aria-labelledby="auth-heading">
      <div className="auth__brand" aria-hidden="true">
        <VaultLogo size={72} />
      </div>
      <h1 id="auth-heading" className="auth__title">
        {title}
      </h1>
      <p className="auth__subtitle muted">{subtitle}</p>
      <div className="card">{children}</div>
    </section>
  );
}
