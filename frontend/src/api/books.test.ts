import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  API_URL,
  ApiError,
  NetworkError,
  ValidationError,
  createBook,
  deleteBook,
  getBook,
  listBooks,
  login,
  setUnauthorizedHandler,
  toQueryString,
  updateBook,
} from './books';

function jsonResponse(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockFetch(response: Response | Error | DOMException) {
  const fn = vi.fn<typeof fetch>();
  if (response instanceof Response) fn.mockResolvedValue(response);
  else fn.mockRejectedValue(response);
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe('toQueryString', () => {
  it('is empty without filters', () => {
    expect(toQueryString()).toBe('');
    expect(toQueryString({})).toBe('');
  });

  it('includes every given filter, including is_read=false', () => {
    expect(toQueryString({ genre: 'Sci-Fi', is_read: false, min_rating: 4 })).toBe(
      '?genre=Sci-Fi&is_read=false&min_rating=4',
    );
  });
});

describe('request functions', () => {
  it('defaults to the same-origin /api prefix', () => {
    expect(API_URL).toBe('/api');
  });

  it('lists books with filters', async () => {
    const fetchMock = mockFetch(jsonResponse(200, []));
    await expect(listBooks({ genre: 'Fantasy' })).resolves.toEqual([]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/books?genre=Fantasy');
    expect(fetchMock.mock.calls[0]?.[1]?.credentials).toBe('include');
  });

  it('sends JSON for create and update', async () => {
    const fetchMock = mockFetch(jsonResponse(201, { id: 1 }));
    await createBook({ title: 'Dune', author: 'Frank Herbert', genre: 'Sci-Fi' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/books');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json');
    expect(JSON.parse(String(init?.body))).toEqual({
      title: 'Dune',
      author: 'Frank Herbert',
      genre: 'Sci-Fi',
    });

    mockFetch(jsonResponse(200, { id: 1 }));
    await updateBook(1, { rating: null });
  });

  it('handles 204 No Content on delete', async () => {
    const fetchMock = mockFetch(new Response(null, { status: 204 }));
    await expect(deleteBook(3)).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('DELETE');
  });

  it('turns a 404 into an ApiError with the server message', async () => {
    mockFetch(jsonResponse(404, { detail: 'Book not found' }));
    const error = await getBook(9999).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 404, message: 'Book not found', isNotFound: true });
  });

  it('turns a FastAPI 422 into a ValidationError with its issues', async () => {
    const detail = [
      {
        type: 'string_too_short',
        loc: ['body', 'title'],
        msg: 'String should have at least 1 character',
      },
      {
        type: 'less_than_equal',
        loc: ['body', 'rating'],
        msg: 'Input should be less than or equal to 5',
      },
    ];
    mockFetch(jsonResponse(422, { detail }));
    const error = await createBook({ title: '', author: 'A', genre: 'Fantasy', rating: 6 }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).issues).toEqual(detail);
  });

  it('falls back to a generic message for non-JSON errors', async () => {
    mockFetch(new Response('<html><h1>502 Bad Gateway</h1></html>', { status: 502 }));
    await expect(listBooks()).rejects.toMatchObject({
      status: 502,
      message: 'Request failed (HTTP 502)',
    });
  });

  it('turns a failed fetch into a NetworkError', async () => {
    mockFetch(new TypeError('Failed to fetch'));
    await expect(listBooks()).rejects.toBeInstanceOf(NetworkError);
  });

  it('reports a 401 on normal requests to the unauthorized handler, but not on auth calls', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    try {
      mockFetch(jsonResponse(401, { detail: 'Not authenticated' }));
      await expect(listBooks()).rejects.toMatchObject({ status: 401 });
      expect(handler).toHaveBeenCalledTimes(1);

      mockFetch(jsonResponse(401, { detail: 'Invalid username or password' }));
      await expect(login({ username: 'a', password: 'b' })).rejects.toMatchObject({ status: 401 });
      expect(handler).toHaveBeenCalledTimes(1);
    } finally {
      setUnauthorizedHandler(null);
    }
  });

  it('rethrows aborts untouched', async () => {
    mockFetch(new DOMException('Aborted', 'AbortError'));
    await expect(listBooks()).rejects.toMatchObject({ name: 'AbortError' });
  });
});
