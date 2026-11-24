import { describe, expect, it } from 'vitest';
import { parseApiDate } from './format';

describe('parseApiDate', () => {
  it('treats naive API timestamps as UTC', () => {
    expect(parseApiDate('2026-11-24T14:33:50.579924').toISOString()).toBe(
      '2026-11-24T14:33:50.579Z',
    );
  });

  it('respects an explicit offset', () => {
    expect(parseApiDate('2026-11-24T14:00:00+02:00').toISOString()).toBe(
      '2026-11-24T12:00:00.000Z',
    );
  });
});
