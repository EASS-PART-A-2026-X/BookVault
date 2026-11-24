/**
 * The API stores UTC but serialises naive datetimes ("2026-11-24T14:33:50.57"),
 * which JS would read as local time. Treat a timestamp without an offset as UTC.
 */
export function parseApiDate(value: string): Date {
  const hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
  return new Date(hasOffset ? value : `${value}Z`);
}

export function formatDate(value: string): string {
  const date = parseApiDate(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
