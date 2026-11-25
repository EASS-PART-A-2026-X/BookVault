import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import {
  ApiError,
  ValidationError,
  changeEmail,
  changePassword,
  updateProfile,
} from '../api/books';
import { useAuth } from '../auth/context';
import { TextField } from '../components/TextField';
import { validateEmail, validateNewPassword } from '../lib/authValidation';
import { describeError, mapIssuesToFields } from '../lib/errors';
import { useToast } from '../toast/context';
import {
  BIO_MAX_LENGTH,
  DISPLAY_NAME_MAX_LENGTH,
  EMAIL_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  normalizeEmail,
  type User,
} from '../types';

type Field = 'display_name' | 'bio' | 'is_public';
const FIELDS: Field[] = ['display_name', 'bio', 'is_public'];

/** Your profile: display name, bio, and who can see your books. */
export function SettingsPage() {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const [displayName, setDisplayName] = useState(user?.display_name ?? '');
  const [bio, setBio] = useState(user?.bio ?? '');
  const [isPublic, setIsPublic] = useState(user?.is_public ?? false);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  if (!user) return null;

  const dirty =
    displayName !== user.display_name || bio !== user.bio || isPublic !== user.is_public;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    const name = displayName.trim();
    const clientErrors: Partial<Record<Field, string>> = {};
    if (!name) clientErrors.display_name = 'Display name can’t be empty.';
    else if (name.length > DISPLAY_NAME_MAX_LENGTH)
      clientErrors.display_name = `At most ${DISPLAY_NAME_MAX_LENGTH} characters.`;
    if (bio.trim().length > BIO_MAX_LENGTH)
      clientErrors.bio = `At most ${BIO_MAX_LENGTH} characters.`;
    setErrors(clientErrors);
    setFormError(null);
    if (Object.keys(clientErrors).length) return;

    setSaving(true);
    try {
      const updated = await updateProfile({
        display_name: name,
        bio: bio.trim(),
        is_public: isPublic,
      });
      setUser(updated);
      setDisplayName(updated.display_name);
      setBio(updated.bio);
      toast.success(
        updated.is_public && !user!.is_public
          ? 'Profile saved. It’s public now: pending requests were accepted.'
          : 'Profile saved.',
      );
    } catch (error) {
      if (error instanceof ValidationError) {
        const mapped = mapIssuesToFields(error.issues, FIELDS);
        setErrors(mapped.fieldErrors);
        if (mapped.formErrors.length) setFormError(mapped.formErrors.join(' '));
      } else {
        setFormError(`${describeError(error).title}. ${describeError(error).message}`);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="narrow" aria-labelledby="settings-heading">
      <h1 id="settings-heading" className="page-title">
        Your profile
      </h1>
      <p className="muted settings-intro">
        Signed in as <strong>@{user.username}</strong> ·{' '}
        <Link to={`/u/${user.username}`}>View your profile</Link>
      </p>
      <div className="card">
        <form
          className="book-form"
          onSubmit={handleSubmit}
          noValidate
          aria-busy={saving || undefined}
        >
          {formError && (
            <div className="alert alert--error" role="alert">
              {formError}
            </div>
          )}
          <fieldset className="book-form__fields" disabled={saving}>
            <TextField
              id="display_name"
              label="Display name"
              value={displayName}
              onChange={setDisplayName}
              error={errors.display_name}
              maxLength={DISPLAY_NAME_MAX_LENGTH}
              autoComplete="nickname"
            />
            <div className={errors.bio ? 'field field--invalid' : 'field'}>
              <label htmlFor="bio">
                Bio <span className="hint">(optional)</span>
              </label>
              <textarea
                id="bio"
                rows={3}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                maxLength={BIO_MAX_LENGTH}
                aria-invalid={errors.bio ? true : undefined}
                aria-describedby="bio-count"
              />
              <p className="hint small" id="bio-count">
                {bio.length}/{BIO_MAX_LENGTH}
              </p>
              {errors.bio && <p className="field-error">{errors.bio}</p>}
            </div>

            <fieldset className="privacy">
              <legend className="label">Who can see your books and reviews?</legend>
              <label
                className={isPublic ? 'privacy__option' : 'privacy__option privacy__option--on'}
              >
                <input
                  type="radio"
                  name="visibility"
                  checked={!isPublic}
                  onChange={() => setIsPublic(false)}
                />
                <span>
                  <strong>Private</strong>
                  <span className="muted small">
                    People must ask to follow you, and you approve each request.
                  </span>
                </span>
              </label>
              <label
                className={isPublic ? 'privacy__option privacy__option--on' : 'privacy__option'}
              >
                <input
                  type="radio"
                  name="visibility"
                  checked={isPublic}
                  onChange={() => setIsPublic(true)}
                />
                <span>
                  <strong>Public</strong>
                  <span className="muted small">
                    Anyone can see your books and follow you without asking.
                  </span>
                </span>
              </label>
            </fieldset>

            <div className="form-actions">
              <button
                type="submit"
                className="btn btn--primary"
                disabled={!dirty}
                onMouseDown={(e) => e.preventDefault()}
              >
                {saving ? 'Saving…' : 'Save profile'}
              </button>
            </div>
          </fieldset>
        </form>
      </div>

      <EmailSection user={user} onSaved={setUser} />
      <PasswordSection />
    </section>
  );
}

/** Server answers shared by both account forms: 400 = wrong current password. */
function describeAccountError(error: unknown): string {
  const { title, message } = describeError(error);
  return `${title}. ${message}`;
}

/** The private email that reset links go to. Needs the current password to change. */
function EmailSection({ user, onSaved }: { user: User; onSaved: (user: User) => void }) {
  const toast = useToast();
  const [email, setEmail] = useState(user.email ?? '');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; current_password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dirty = normalizeEmail(email) !== (user.email ?? '');

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    const clientErrors: typeof errors = {};
    const emailError = validateEmail(email);
    if (emailError) clientErrors.email = emailError;
    if (!password) clientErrors.current_password = 'Enter your current password.';
    setErrors(clientErrors);
    setFormError(null);
    if (Object.keys(clientErrors).length) return;

    setSaving(true);
    try {
      const updated = await changeEmail(normalizeEmail(email), password);
      onSaved(updated);
      setEmail(updated.email ?? '');
      setPassword('');
      toast.success('Email saved. Reset links will go there.');
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) {
        setErrors({ current_password: 'That’s not your current password.' });
      } else if (error instanceof ApiError && error.status === 409) {
        setErrors({ email: 'That email is already used by another account.' });
      } else if (error instanceof ValidationError) {
        const mapped = mapIssuesToFields(error.issues, ['email', 'current_password'] as const);
        setErrors(mapped.fieldErrors);
        if (mapped.formErrors.length) setFormError(mapped.formErrors.join(' '));
      } else {
        setFormError(describeAccountError(error));
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card" aria-labelledby="email-heading" role="region">
      <h2 id="email-heading" className="settings-heading">
        Email
      </h2>
      {!user.email && (
        <div className="alert alert--warning" role="status">
          Your account has no email yet, so you can’t reset a forgotten password. Add one below.
        </div>
      )}
      <form
        className="book-form"
        onSubmit={handleSubmit}
        noValidate
        aria-busy={saving || undefined}
      >
        {formError && (
          <div className="alert alert--error" role="alert">
            {formError}
          </div>
        )}
        <fieldset className="book-form__fields" disabled={saving}>
          <TextField
            id="account_email"
            label="Email"
            type="email"
            value={email}
            onChange={setEmail}
            error={errors.email}
            hint="Private: only used to send you a password reset link."
            autoComplete="email"
            maxLength={EMAIL_MAX_LENGTH}
          />
          <TextField
            id="email_current_password"
            label="Current password"
            type="password"
            value={password}
            onChange={setPassword}
            error={errors.current_password}
            autoComplete="current-password"
          />
          <div className="form-actions">
            <button
              type="submit"
              className="btn btn--primary"
              disabled={!dirty}
              onMouseDown={(e) => e.preventDefault()}
            >
              {saving ? 'Saving…' : 'Save email'}
            </button>
          </div>
        </fieldset>
      </form>
    </div>
  );
}

type PasswordField = 'current_password' | 'new_password' | 'confirm';

/** Change the password. Logs out other devices; this one stays logged in. */
function PasswordSection() {
  const toast = useToast();
  const empty = { current_password: '', new_password: '', confirm: '' };
  const [values, setValues] = useState<Record<PasswordField, string>>(empty);
  const [errors, setErrors] = useState<Partial<Record<PasswordField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function set(field: PasswordField, value: string) {
    setValues((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    const clientErrors: Partial<Record<PasswordField, string>> = {};
    if (!values.current_password) clientErrors.current_password = 'Enter your current password.';
    const newError = validateNewPassword(values.new_password);
    if (newError) clientErrors.new_password = newError;
    if (values.confirm !== values.new_password) clientErrors.confirm = 'Passwords don’t match.';
    setErrors(clientErrors);
    setFormError(null);
    if (Object.keys(clientErrors).length) return;

    setSaving(true);
    try {
      await changePassword(values.current_password, values.new_password);
      setValues(empty);
      toast.success('Password changed. Your other devices were logged out.');
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) {
        setErrors({ current_password: 'That’s not your current password.' });
      } else if (error instanceof ValidationError) {
        const mapped = mapIssuesToFields(error.issues, [
          'current_password',
          'new_password',
        ] as const);
        setErrors(mapped.fieldErrors);
        if (mapped.formErrors.length) setFormError(mapped.formErrors.join(' '));
      } else {
        setFormError(describeAccountError(error));
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card" aria-labelledby="password-heading" role="region">
      <h2 id="password-heading" className="settings-heading">
        Password
      </h2>
      <form
        className="book-form"
        onSubmit={handleSubmit}
        noValidate
        aria-busy={saving || undefined}
      >
        {formError && (
          <div className="alert alert--error" role="alert">
            {formError}
          </div>
        )}
        <fieldset className="book-form__fields" disabled={saving}>
          <TextField
            id="current_password"
            label="Current password"
            type="password"
            value={values.current_password}
            onChange={(v) => set('current_password', v)}
            error={errors.current_password}
            autoComplete="current-password"
          />
          <TextField
            id="new_password"
            label="New password"
            type="password"
            value={values.new_password}
            onChange={(v) => set('new_password', v)}
            error={errors.new_password}
            hint={`At least ${PASSWORD_MIN_LENGTH} characters. Your other devices will be logged out.`}
            autoComplete="new-password"
          />
          <TextField
            id="confirm_password"
            label="Confirm new password"
            type="password"
            value={values.confirm}
            onChange={(v) => set('confirm', v)}
            error={errors.confirm}
            autoComplete="new-password"
          />
          <div className="form-actions">
            <button
              type="submit"
              className="btn btn--primary"
              onMouseDown={(e) => e.preventDefault()}
            >
              {saving ? 'Saving…' : 'Change password'}
            </button>
          </div>
        </fieldset>
      </form>
    </div>
  );
}
