/**
 * The only module that talks to the Book Vault API. Everything else imports these
 * functions and error classes, so components never call fetch directly.
 */
import type { Book, BookCreate, BookFilters, BookUpdate } from '../types';

const DEFAULT_API_URL = 'http://localhost:8000';

/** Base URL from VITE_API_URL (build/dev time), without a trailing slash. */
export const API_URL: string = (import.meta.env.VITE_API_URL || DEFAULT_API_URL).replace(
  /\/+$/,
  '',
);

/** One entry of FastAPI's 422 `detail` array. */
export interface ValidationIssue {
  type: string;
  loc: (string | number)[];
  msg: string;
  input?: unknown;
  ctx?: Record<string, unknown>;
}

/** The server answered with a non-2xx status. */
export class ApiError extends Error {
  readonly status: number;
  /** The raw `detail` from the body: a string (404) or a list of issues (422). */
  readonly detail: unknown;

  constructor(status: number, message: string, detail: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }
}

/** A 422 from FastAPI, with its `detail` array parsed. */
export class ValidationError extends ApiError {
  readonly issues: ValidationIssue[];

  constructor(issues: ValidationIssue[]) {
    super(422, issues.map((issue) => issue.msg).join('; ') || 'Validation failed', issues);
    this.name = 'ValidationError';
    this.issues = issues;
  }
}

/** The request never got an HTTP response: server down, DNS, CORS, offline... */
export class NetworkError extends Error {
  constructor(cause?: unknown) {
    super(`Can't reach the Book Vault API (${API_URL}).`, { cause });
    this.name = 'NetworkError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidationIssue(value: unknown): value is ValidationIssue {
  return isRecord(value) && typeof value.msg === 'string' && Array.isArray(value.loc);
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { Accept: 'application/json', ...init.headers },
    });
  } catch (error) {
    // Let callers recognise their own cancellations (e.g. on unmount).
    if (isAbortError(error)) throw error;
    throw new NetworkError(error);
  }

  const body = await readJson(response);

  if (!response.ok) {
    // Only trust `detail` from a JSON body; a proxy's HTML/text error page is not a message.
    const detail = isRecord(body) ? body.detail : undefined;
    if (response.status === 422 && Array.isArray(detail) && detail.every(isValidationIssue)) {
      throw new ValidationError(detail);
    }
    const message =
      typeof detail === 'string' && detail ? detail : `Request failed (HTTP ${response.status})`;
    throw new ApiError(response.status, message, detail);
  }

  return body as T;
}

function jsonInit(method: string, data: unknown, signal?: AbortSignal): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
    signal,
  };
}

/** Build the GET /books query string; undefined filters are left out. */
export function toQueryString(filters: BookFilters = {}): string {
  const params = new URLSearchParams();
  if (filters.genre) params.set('genre', filters.genre);
  if (filters.is_read !== undefined) params.set('is_read', String(filters.is_read));
  if (filters.min_rating !== undefined) params.set('min_rating', String(filters.min_rating));
  const query = params.toString();
  return query ? `?${query}` : '';
}

export function listBooks(filters: BookFilters = {}, signal?: AbortSignal): Promise<Book[]> {
  return request<Book[]>(`/books${toQueryString(filters)}`, { signal });
}

export function getBook(id: number, signal?: AbortSignal): Promise<Book> {
  return request<Book>(`/books/${id}`, { signal });
}

export function createBook(data: BookCreate, signal?: AbortSignal): Promise<Book> {
  return request<Book>('/books', jsonInit('POST', data, signal));
}

export function updateBook(id: number, data: BookUpdate, signal?: AbortSignal): Promise<Book> {
  return request<Book>(`/books/${id}`, jsonInit('PUT', data, signal));
}

export async function deleteBook(id: number, signal?: AbortSignal): Promise<void> {
  await request<undefined>(`/books/${id}`, { method: 'DELETE', signal });
}

/** True for a cancelled request (AbortController). DOMException isn't always an Error. */
export function isAbortError(error: unknown): boolean {
  return isRecord(error) && error.name === 'AbortError';
}
