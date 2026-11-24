/** Turn any thrown value into something the UI can show. */
import {
  API_URL,
  ApiError,
  NetworkError,
  ValidationError,
  type ValidationIssue,
} from '../api/books';
import { FIELD_ORDER, type FieldErrors } from './validation';

export type ErrorKind = 'network' | 'auth' | 'not-found' | 'validation' | 'server' | 'unknown';

export interface DescribedError {
  kind: ErrorKind;
  title: string;
  message: string;
  /** Worth offering a Retry button. */
  retryable: boolean;
}

/** "at http://…" for an absolute API URL; nothing for a same-origin path like "/api". */
const apiWhere = /^https?:\/\//.test(API_URL) ? ` at ${API_URL}` : '';

const UNREACHABLE: DescribedError = {
  kind: 'network',
  title: "Can't reach the server",
  message: `The Book Vault API${apiWhere} isn't responding. Check that the backend is running, then try again.`,
  retryable: true,
};

/**
 * 502 Bad Gateway / 504 Gateway Timeout come from a reverse proxy (nginx in Docker)
 * that couldn't reach the backend, which for the user is the same as being offline.
 */
const GATEWAY_STATUSES = new Set([502, 504]);

export function describeError(error: unknown): DescribedError {
  if (error instanceof NetworkError) return UNREACHABLE;
  if (error instanceof ApiError && GATEWAY_STATUSES.has(error.status)) return UNREACHABLE;
  if (error instanceof ValidationError) {
    return {
      kind: 'validation',
      title: 'Some fields need attention',
      message: error.message,
      retryable: false,
    };
  }
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return {
        kind: 'auth',
        title: 'You’re signed out',
        message: 'Please log in again to continue.',
        retryable: false,
      };
    }
    if (error.status === 404) {
      return { kind: 'not-found', title: 'Not found', message: error.message, retryable: false };
    }
    if (error.status >= 500) {
      return {
        kind: 'server',
        title: 'The server ran into a problem',
        message: `Something went wrong on the server (HTTP ${error.status}). Please try again.`,
        retryable: true,
      };
    }
    return {
      kind: 'unknown',
      title: 'Request failed',
      message: error.message,
      retryable: true,
    };
  }
  return {
    kind: 'unknown',
    title: 'Something went wrong',
    message:
      error instanceof Error && error.message ? error.message : 'An unexpected error occurred.',
    retryable: true,
  };
}

export function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

/** Pydantic prefixes model-validator messages with "Value error, ". */
function cleanMessage(msg: string): string {
  const text = msg.replace(/^Value error, /, '');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Map FastAPI's 422 `detail` to form fields.
 *   loc ["body", "title"]  -> fieldErrors.title
 *   loc ["body"] + "title cannot be null" (model validator) -> fieldErrors.title
 *   anything else          -> formErrors (shown above the form)
 * Several issues for one field are joined.
 */
export function mapValidationIssues(issues: ValidationIssue[]): {
  fieldErrors: FieldErrors;
  formErrors: string[];
} {
  return mapIssuesToFields(issues, FIELD_ORDER);
}

/** The same mapping for any form, given the names of its fields. */
export function mapIssuesToFields<F extends string>(
  issues: ValidationIssue[],
  fields: readonly F[],
): { fieldErrors: Partial<Record<F, string>>; formErrors: string[] } {
  const isField = (value: unknown): value is F =>
    typeof value === 'string' && (fields as readonly string[]).includes(value);
  const fieldErrors: Partial<Record<F, string>> = {};
  const formErrors: string[] = [];

  for (const issue of issues) {
    const [source, name] = issue.loc;
    let field: F | undefined;
    if (source === 'body' && isField(name)) {
      field = name;
    } else if (source === 'body' && issue.loc.length === 1) {
      const match = /^Value error, (\w+) cannot be null/.exec(issue.msg);
      if (match && isField(match[1])) field = match[1];
    }

    const message = cleanMessage(issue.msg);
    if (field) {
      const previous = fieldErrors[field];
      fieldErrors[field] = previous ? `${previous} ${message}` : message;
    } else {
      formErrors.push(message);
    }
  }
  return { fieldErrors, formErrors };
}
