import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
const { jobTokenAuth } = await import('./index.js');

describe('jobTokenAuth', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  function mockReq(headerValue) {
    return {
      get(name) {
        if (typeof name !== 'string') return undefined;
        const lower = name.toLowerCase();
        if (lower === 'x-job-token') return headerValue;
        return undefined;
      },
    };
  }

  function mockRes() {
    const res = {};
    res.status = vi.fn(() => res);
    res.json = vi.fn(() => res);
    return res;
  }

  it('calls next() when X-Job-Token header matches JOB_TOKEN', () => {
    process.env.JOB_TOKEN = 'x';
    const req = mockReq('x');
    const res = mockRes();
    const next = vi.fn();

    jobTokenAuth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 401 JSON when header is missing', () => {
    process.env.JOB_TOKEN = 'x';
    const req = mockReq(undefined);
    const res = mockRes();
    const next = vi.fn();

    jobTokenAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
  });

  it('returns 401 JSON when header does not match JOB_TOKEN', () => {
    process.env.JOB_TOKEN = 'x';
    const req = mockReq('wrong');
    const res = mockRes();
    const next = vi.fn();

    jobTokenAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
  });

  it('returns 401 JSON when JOB_TOKEN is not set', () => {
    delete process.env.JOB_TOKEN;
    const req = mockReq('x');
    const res = mockRes();
    const next = vi.fn();

    jobTokenAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
  });
});
