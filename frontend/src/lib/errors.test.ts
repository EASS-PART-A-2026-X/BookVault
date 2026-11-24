import { describe, expect, it } from 'vitest';
import { ApiError, NetworkError, ValidationError } from '../api/books';
import { describeError, isNotFound, mapValidationIssues } from './errors';

describe('mapValidationIssues', () => {
  it('maps body field errors to their fields', () => {
    expect(
      mapValidationIssues([
        {
          type: 'string_too_short',
          loc: ['body', 'title'],
          msg: 'String should have at least 1 character',
        },
        {
          type: 'enum',
          loc: ['body', 'genre'],
          msg: "Input should be 'Fantasy', 'Romance' or 'Sci-Fi'",
        },
        {
          type: 'less_than_equal',
          loc: ['body', 'rating'],
          msg: 'Input should be less than or equal to 5',
        },
      ]),
    ).toEqual({
      fieldErrors: {
        title: 'String should have at least 1 character',
        genre: "Input should be 'Fantasy', 'Romance' or 'Sci-Fi'",
        rating: 'Input should be less than or equal to 5',
      },
      formErrors: [],
    });
  });

  it('maps the model-level "X cannot be null" error to field X', () => {
    expect(
      mapValidationIssues([
        { type: 'value_error', loc: ['body'], msg: 'Value error, title cannot be null' },
      ]),
    ).toEqual({ fieldErrors: { title: 'Title cannot be null' }, formErrors: [] });
  });

  it('keeps errors it cannot place as form-level messages', () => {
    expect(
      mapValidationIssues([
        { type: 'json_invalid', loc: ['body', 42], msg: 'JSON decode error' },
        { type: 'extra', loc: ['body', 'isbn'], msg: 'Extra inputs are not permitted' },
        { type: 'enum', loc: ['query', 'genre'], msg: 'Bad genre' },
      ]).formErrors,
    ).toEqual(['JSON decode error', 'Extra inputs are not permitted', 'Bad genre']);
  });

  it('joins several messages for one field', () => {
    expect(
      mapValidationIssues([
        { type: 'a', loc: ['body', 'title'], msg: 'First.' },
        { type: 'b', loc: ['body', 'title'], msg: 'Second.' },
      ]).fieldErrors.title,
    ).toBe('First. Second.');
  });
});

describe('describeError', () => {
  it('explains a network failure and offers a retry', () => {
    expect(describeError(new NetworkError())).toMatchObject({
      kind: 'network',
      title: "Can't reach the server",
      retryable: true,
    });
  });

  it('classifies 404, 5xx, 422 and unknown errors', () => {
    expect(describeError(new ApiError(404, 'Book not found', 'Book not found'))).toMatchObject({
      kind: 'not-found',
      retryable: false,
    });
    expect(describeError(new ApiError(503, 'Database unavailable', null))).toMatchObject({
      kind: 'server',
      retryable: true,
    });
    expect(describeError(new ValidationError([]))).toMatchObject({ kind: 'validation' });
    expect(describeError('boom')).toMatchObject({
      kind: 'unknown',
      message: 'An unexpected error occurred.',
    });
  });

  it('detects not-found errors', () => {
    expect(isNotFound(new ApiError(404, 'x', 'x'))).toBe(true);
    expect(isNotFound(new ApiError(500, 'x', 'x'))).toBe(false);
    expect(isNotFound(new Error('x'))).toBe(false);
  });
});
