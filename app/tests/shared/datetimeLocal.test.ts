import { describe, expect, it } from 'vitest';
import {
  formatDateForDateInput,
  formatIsoForDatetimeLocal,
  parseDateAndTimeToIso,
  parseDatetimeLocalToIso
} from '../../src/shared/utils/datetimeLocal';

describe('datetime-local helpers', () => {
  it('round-trips an ISO timestamp through the datetime-local format without timezone drift', () => {
    const iso = '2026-04-13T08:30:00.000Z';

    expect(parseDatetimeLocalToIso(formatIsoForDatetimeLocal(iso))).toBe(iso);
  });

  it('formats date-only inputs using the local calendar date', () => {
    expect(formatDateForDateInput(new Date(2026, 3, 13, 0, 30))).toBe('2026-04-13');
  });

  it('serializes a local calendar date plus wall-clock time into ISO', () => {
    expect(parseDateAndTimeToIso('2026-04-13', '09:30')).toBe(
      parseDatetimeLocalToIso('2026-04-13T09:30')
    );
  });
});
