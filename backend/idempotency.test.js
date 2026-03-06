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
  const getRange = () => range;

  beforeEach(() => {
    vi.mocked(idempotency.wasAlreadySent).mockReturnValue(false);
    vi.mocked(idempotency.markAsSent).mockClear();
    delete process.env.DRY_RUN;
  });

  it('runs job even when previous sent marker exists', async () => {
    vi.mocked(idempotency.wasAlreadySent).mockReturnValue(true);
    const runJob = vi.fn().mockResolvedValue({ payload: { ok: true } });

    const result = await runJobWithIdempotency('weekly', getRange, runJob);

    expect(result).toEqual({ payload: { ok: true } });
    expect(runJob).toHaveBeenCalledTimes(1);
    expect(idempotency.markAsSent).not.toHaveBeenCalled();
  });

  it('runs job without writing sent markers', async () => {
    const runJob = vi.fn().mockResolvedValue({ payload: { ok: true } });

    const result = await runJobWithIdempotency('weekly', getRange, runJob);

    expect(result).toEqual({ payload: { ok: true } });
    expect(runJob).toHaveBeenCalledTimes(1);
    expect(idempotency.markAsSent).not.toHaveBeenCalled();
  });

  it('does not mark sent and rethrows when job throws', async () => {
    const runJob = vi.fn().mockRejectedValue(new Error('Job failed'));

    await expect(runJobWithIdempotency('weekly', getRange, runJob)).rejects.toThrow('Job failed');

    expect(idempotency.markAsSent).not.toHaveBeenCalled();
  });

  it('does not write sent markers when DRY_RUN=1', async () => {
    process.env.DRY_RUN = '1';
    const runJob = vi.fn().mockResolvedValue({ payload: {} });

    const result = await runJobWithIdempotency('weekly', getRange, runJob);

    expect(result.skipped).toBeUndefined();
    expect(runJob).toHaveBeenCalledTimes(1);
    expect(idempotency.markAsSent).not.toHaveBeenCalled();
  });

  it('runs job when DRY_RUN=1 even if historical sent marker exists', async () => {
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
