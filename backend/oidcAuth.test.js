import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockVerifyIdToken = vi.fn();
vi.mock('google-auth-library', () => ({
  OAuth2Client: vi.fn().mockImplementation(() => ({
    verifyIdToken: mockVerifyIdToken,
  })),
}));

const { oidcAuth } = await import('./index.js');

describe('oidcAuth', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.OIDC_AUDIENCE = 'https://my-service-xxx.run.app';
    mockVerifyIdToken.mockReset();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  function mockReq(authHeader) {
    return {
      get(name) {
        if (typeof name !== 'string') return undefined;
        const lower = name.toLowerCase();
        if (lower === 'authorization') return authHeader;
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

  it('calls next() when Bearer token is valid and audience matches', async () => {
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => ({ email: 'scheduler@project.iam.gserviceaccount.com' }),
    });
    const req = mockReq('Bearer valid-id-token');
    const res = mockRes();
    const next = vi.fn();

    await oidcAuth(req, res, next);

    expect(mockVerifyIdToken).toHaveBeenCalledWith({
      idToken: 'valid-id-token',
      audience: 'https://my-service-xxx.run.app',
    });
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 401 when Authorization header is missing', async () => {
    const req = mockReq(undefined);
    const res = mockRes();
    const next = vi.fn();

    await oidcAuth(req, res, next);

    expect(mockVerifyIdToken).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
  });

  it('returns 401 when Authorization is not Bearer', async () => {
    const req = mockReq('Basic xyz');
    const res = mockRes();
    const next = vi.fn();

    await oidcAuth(req, res, next);

    expect(mockVerifyIdToken).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 401 when OIDC_AUDIENCE is not set', async () => {
    delete process.env.OIDC_AUDIENCE;
    const req = mockReq('Bearer token');
    const res = mockRes();
    const next = vi.fn();

    await oidcAuth(req, res, next);

    expect(mockVerifyIdToken).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 401 when verifyIdToken throws', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('Invalid token'));
    const req = mockReq('Bearer bad-token');
    const res = mockRes();
    const next = vi.fn();

    await oidcAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
  });

  it('returns 403 when SCHEDULER_SA_EMAIL is set and token email does not match', async () => {
    process.env.SCHEDULER_SA_EMAIL = 'allowed@project.iam.gserviceaccount.com';
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => ({ email: 'other@project.iam.gserviceaccount.com' }),
    });
    const req = mockReq('Bearer valid-token');
    const res = mockRes();
    const next = vi.fn();

    await oidcAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Forbidden' });
  });

  it('calls next() when SCHEDULER_SA_EMAIL is set and token email matches', async () => {
    process.env.SCHEDULER_SA_EMAIL = 'scheduler@project.iam.gserviceaccount.com';
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => ({ email: 'scheduler@project.iam.gserviceaccount.com' }),
    });
    const req = mockReq('Bearer valid-token');
    const res = mockRes();
    const next = vi.fn();

    await oidcAuth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});
