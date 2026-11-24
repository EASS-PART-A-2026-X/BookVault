import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { ValidationError, updateProfile } from '../api/books';
import { useAuth } from '../auth/context';
import { TextField } from '../components/TextField';
import { describeError, mapIssuesToFields } from '../lib/errors';
import { useToast } from '../toast/context';
import { BIO_MAX_LENGTH, DISPLAY_NAME_MAX_LENGTH } from '../types';

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
    </section>
  );
}
