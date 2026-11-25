/** Client-side checks for the login and sign-up forms, mirroring the backend. */
import {
  DISPLAY_NAME_MAX_LENGTH,
  EMAIL_MAX_LENGTH,
  EMAIL_PATTERN,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  USERNAME_PATTERN,
  normalizeEmail,
  normalizeUsername,
} from '../types';

export function validateEmail(raw: string): string | undefined {
  const email = normalizeEmail(raw);
  if (!email) return 'Enter your email address.';
  if (email.length > EMAIL_MAX_LENGTH) return `At most ${EMAIL_MAX_LENGTH} characters.`;
  return EMAIL_PATTERN.test(email) ? undefined : 'Enter an email address like name@example.com.';
}

export function validateNewPassword(password: string): string | undefined {
  if (password.length < PASSWORD_MIN_LENGTH)
    return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  return password.length > PASSWORD_MAX_LENGTH
    ? `At most ${PASSWORD_MAX_LENGTH} characters.`
    : undefined;
}

export interface RegisterValues {
  username: string;
  email: string;
  display_name: string;
  password: string;
  confirm: string;
}

export type RegisterField = keyof RegisterValues;
export const REGISTER_FIELDS: RegisterField[] = [
  'username',
  'email',
  'display_name',
  'password',
  'confirm',
];

export function validateRegisterField(
  field: RegisterField,
  values: RegisterValues,
): string | undefined {
  switch (field) {
    case 'username': {
      const name = normalizeUsername(values.username);
      if (!name) return 'Choose a username.';
      if (name.length < 3 || name.length > 30) return 'Usernames are 3–30 characters.';
      return USERNAME_PATTERN.test(name)
        ? undefined
        : 'Use only letters, numbers, “_” and “.” (no spaces).';
    }
    case 'email':
      return validateEmail(values.email);
    case 'display_name':
      return values.display_name.trim().length > DISPLAY_NAME_MAX_LENGTH
        ? `At most ${DISPLAY_NAME_MAX_LENGTH} characters.`
        : undefined;
    case 'password':
      return validateNewPassword(values.password);
    case 'confirm':
      return values.confirm === values.password ? undefined : 'Passwords don’t match.';
  }
}

export function validateRegister(values: RegisterValues): Partial<Record<RegisterField, string>> {
  const errors: Partial<Record<RegisterField, string>> = {};
  for (const field of REGISTER_FIELDS) {
    const message = validateRegisterField(field, values);
    if (message) errors[field] = message;
  }
  return errors;
}

export interface LoginValues {
  username: string;
  password: string;
}

export function validateLogin(values: LoginValues): Partial<Record<keyof LoginValues, string>> {
  const errors: Partial<Record<keyof LoginValues, string>> = {};
  if (!values.username.trim()) errors.username = 'Enter your username.';
  if (!values.password) errors.password = 'Enter your password.';
  return errors;
}
