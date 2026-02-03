import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getPreviousCalendarWeekRange } from './lib/dateRanges.js';

vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail: () => Promise.resolve() }) } }));
vi.mock('exceljs', () => ({
  default: {
    Workbook: class {
      addWorksheet() {
        return { getCell: () => ({ value: null, font: {} }), addRow: function () { return this; }, getRow: () => ({ font: {} }), get columns() { return []; }, set columns(_) {}, rowCount: 0 };
      }
      get xlsx() {
        return { writeBuffer: () => Promise.resolve(Buffer.from([0x50, 0x4b])) };
      }
    },
  },
}));
vi.mock('./idempotency/localFileStore.js', () => ({
  wasAlreadySent: vi.fn(),
  markAsSent: vi.fn(),
  clearSent: vi.fn(),
}));

const { runJobWithIdempotency } = await import('./index.js');
const idempotency = await import('./idempotency/localFileStore.js');

describe('runJobWithIdempotency', () => {
  const range = getPreviousCalendarWeekRange(new Date('2026-01-26T09:30:00'));
  const label = range.label;
  const getRange = () => range;

  beforeEach(() => {
    vi.mocked(idempotency.wasAlreadySent).mockReturnValue(false);
    vi.mocked(idempotency.markAsSent).mockClear();
    delete process.env.DRY_RUN;
  });

  it('returns skipped when run for jobType+label is already sent', async () => {
    vi.mocked(idempotency.wasAlreadySent).mockReturnValue(true);
    const runJob = vi.fn();

    const result = await runJobWithIdempotency('weekly', getRange, runJob);

    expect(result).toEqual({ skipped: true, reason: 'already_sent', jobType: 'weekly', label });
    expect(runJob).not.toHaveBeenCalled();
    expect(idempotency.markAsSent).not.toHaveBeenCalled();
  });

  it('runs job and marks sent when not already sent', async () => {
    const runJob = vi.fn().mockResolvedValue({ payload: { ok: true } });

    const result = await runJobWithIdempotency('weekly', getRange, runJob);

    expect(result).toEqual({ payload: { ok: true } });
    expect(runJob).toHaveBeenCalledTimes(1);
    expect(idempotency.markAsSent).toHaveBeenCalledWith('weekly', label);
  });

  it('does not mark sent and rethrows when job throws', async () => {
    const runJob = vi.fn().mockRejectedValue(new Error('Job failed'));

    await expect(runJobWithIdempotency('weekly', getRange, runJob)).rejects.toThrow('Job failed');

    expect(idempotency.markAsSent).not.toHaveBeenCalled();
  });

  it('does not mark sent when DRY_RUN=1', async () => {
    process.env.DRY_RUN = '1';
    const runJob = vi.fn().mockResolvedValue({ payload: {} });

    const result = await runJobWithIdempotency('weekly', getRange, runJob);

    expect(result.skipped).toBeUndefined();
    expect(runJob).toHaveBeenCalledTimes(1);
    expect(idempotency.markAsSent).not.toHaveBeenCalled();
  });

  it('runs job when DRY_RUN=1 even if wasAlreadySent would return true (no skip, no mark)', async () => {
    process.env.DRY_RUN = '1';
    vi.mocked(idempotency.wasAlreadySent).mockReturnValue(true);
    const runJob = vi.fn().mockResolvedValue({ payload: {}, dryRunPath: '/out/weekly.json' });

    const result = await runJobWithIdempotency('weekly', getRange, runJob);

    expect(result.skipped).toBeUndefined();
    expect(result.dryRunPath).toBe('/out/weekly.json');
    expect(runJob).toHaveBeenCalledTimes(1);
    expect(idempotency.markAsSent).not.toHaveBeenCalled();
  });
});
