/** Turn any thrown value into something the UI can show. */
import {
  API_URL,
  ApiError,
  NetworkError,
  ValidationError,
  type ValidationIssue,
} from '../api/books';
import { FIELD_ORDER, type FieldErrors, type FieldName } from './validation';

export type ErrorKind = 'network' | 'not-found' | 'validation' | 'server' | 'unknown';

export interface DescribedError {
  kind: ErrorKind;
  title: string;
  message: string;
  /** Worth offering a Retry button. */
  retryable: boolean;
}

export function describeError(error: unknown): DescribedError {
  if (error instanceof NetworkError) {
    return {
      kind: 'network',
      title: "Can't reach the server",
      message: `The Book Vault API at ${API_URL} isn't responding. Check that the backend is running, then try again.`,
      retryable: true,
    };
  }
  if (error instanceof ValidationError) {
    return {
      kind: 'validation',
      title: 'Some fields need attention',
      message: error.message,
      retryable: false,
    };
  }
  if (error instanceof ApiError) {
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

function isFieldName(value: unknown): value is FieldName {
  return typeof value === 'string' && (FIELD_ORDER as string[]).includes(value);
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
  const fieldErrors: FieldErrors = {};
  const formErrors: string[] = [];

  for (const issue of issues) {
    const [source, name] = issue.loc;
    let field: FieldName | undefined;
    if (source === 'body' && isFieldName(name)) {
      field = name;
    } else if (source === 'body' && issue.loc.length === 1) {
      const match = /^Value error, (\w+) cannot be null/.exec(issue.msg);
      if (match && isFieldName(match[1])) field = match[1];
    }

    const message = cleanMessage(issue.msg);
    if (field) {
      fieldErrors[field] = fieldErrors[field] ? `${fieldErrors[field]} ${message}` : message;
    } else {
      formErrors.push(message);
    }
  }
  return { fieldErrors, formErrors };
}
