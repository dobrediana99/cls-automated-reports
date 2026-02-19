import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mondayRequest } from '../monday/client.js';
import {
  fetchActivitiesForItems,
  fetchAllItems,
  fetchItemsDirectory,
  ensureRequiredColumn,
} from './fetchData.js';

vi.mock('../monday/client.js', () => ({ mondayRequest: vi.fn() }));

function fullData(chunk) {
  const data = {};
  for (const id of chunk) {
    data[`t_${id}`] = {
      timeline_items_page: {
        timeline_items: [
          { type: 'email', created_at: '2026-01-28T10:00:00Z', user: { id: '1' } },
        ],
      },
    };
  }
  return data;
}

describe('fetchActivitiesForItems', () => {
  beforeEach(() => {
    mondayRequest.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns empty array when itemIds is empty', async () => {
    const start = new Date('2026-01-27T00:00:00Z');
    const end = new Date('2026-02-02T23:59:59Z');
    const result = await fetchActivitiesForItems([], start, end);
    expect(result).toEqual([]);
    expect(mondayRequest).not.toHaveBeenCalled();
  });

  it('chunk fails first time (429) then succeeds on retry', async () => {
    const err429 = new Error('Too Many Requests');
    err429.statusCode = 429;
    err429.retryAfter = 1;
    const start = new Date('2026-01-27T00:00:00Z');
    const end = new Date('2026-02-02T23:59:59Z');
    const itemIds = [100, 101];
    mondayRequest
      .mockRejectedValueOnce(err429)
      .mockResolvedValueOnce(fullData([100, 101]));

    const result = await fetchActivitiesForItems(itemIds, start, end);
    expect(mondayRequest).toHaveBeenCalledTimes(2);
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThanOrEqual(0);
  });

  it('chunk fails with 5xx then succeeds on retry', async () => {
    const err503 = new Error('Service Unavailable');
    err503.statusCode = 503;
    const start = new Date('2026-01-27T00:00:00Z');
    const end = new Date('2026-02-02T23:59:59Z');
    const itemIds = [200, 201];
    mondayRequest
      .mockRejectedValueOnce(err503)
      .mockResolvedValueOnce(fullData([200, 201]));

    const result = await fetchActivitiesForItems(itemIds, start, end);
    expect(mondayRequest).toHaveBeenCalledTimes(2);
    expect(Array.isArray(result)).toBe(true);
  });

  it('chunk returns incomplete (missing itemId) => retry => still incomplete => throw', async () => {
    const start = new Date('2026-01-27T00:00:00Z');
    const end = new Date('2026-02-02T23:59:59Z');
    const itemIds = [300, 301, 302];
    const incomplete = {
      t_300: { timeline_items_page: { timeline_items: [] } },
      t_301: { timeline_items_page: { timeline_items: [] } },
      // t_302 missing
    };
    mondayRequest.mockResolvedValue(incomplete);

    await expect(fetchActivitiesForItems(itemIds, start, end)).rejects.toThrow(
      /incomplete response/
    );
    expect(mondayRequest).toHaveBeenCalledTimes(5);
  }, 25000);

  it('chunk returns incomplete then complete on retry => ok', async () => {
    const start = new Date('2026-01-27T00:00:00Z');
    const end = new Date('2026-02-02T23:59:59Z');
    const itemIds = [400, 401];
    const incomplete = {
      t_400: { timeline_items_page: { timeline_items: [] } },
      // t_401 missing
    };
    const complete = fullData([400, 401]);
    mondayRequest
      .mockResolvedValueOnce(incomplete)
      .mockResolvedValueOnce(complete);

    const result = await fetchActivitiesForItems(itemIds, start, end);
    expect(mondayRequest).toHaveBeenCalledTimes(2);
    expect(Array.isArray(result)).toBe(true);
  }, 15000);

  it('non-transient 4xx fails immediately (no retry)', async () => {
    const err401 = new Error('Unauthorized');
    err401.statusCode = 401;
    const start = new Date('2026-01-27T00:00:00Z');
    const end = new Date('2026-02-02T23:59:59Z');
    mondayRequest.mockRejectedValueOnce(err401);

    await expect(fetchActivitiesForItems([500, 501], start, end)).rejects.toThrow('Unauthorized');
    expect(mondayRequest).toHaveBeenCalledTimes(1);
  });

  it('sorts itemIds and returns activities in date range only', async () => {
    const start = new Date('2026-01-27T00:00:00Z');
    const end = new Date('2026-02-02T23:59:59Z');
    const itemIds = [600, 601];
    const data = {
      t_600: {
        timeline_items_page: {
          timeline_items: [
            { type: 'email', created_at: '2026-01-28T12:00:00Z', user: { id: '1' } },
            { type: 'call', created_at: '2026-02-10T12:00:00Z', user: { id: '1' } },
          ],
        },
      },
      t_601: {
        timeline_items_page: {
          timeline_items: [
            { type: 'email', created_at: '2026-01-26T12:00:00Z', user: { id: '2' } },
          ],
        },
      },
    };
    mondayRequest.mockResolvedValueOnce(data);

    const result = await fetchActivitiesForItems(itemIds, start, end);
    expect(result).toHaveLength(1);
    expect(result[0].created_at).toBe('2026-01-28T12:00:00Z');
  });
});

describe('ensureRequiredColumn', () => {
  it('throws when colId is null/undefined with boardId and logical name', () => {
    expect(() => ensureRequiredColumn(123, 'DATA_CTR', null)).toThrow(
      /Required column missing.*boardId=123.*logicalColumn=DATA_CTR/
    );
    expect(() => ensureRequiredColumn(456, 'OWNER', undefined)).toThrow(
      /Required column missing.*boardId=456.*logicalColumn=OWNER/
    );
  });

  it('throws when colId is empty string', () => {
    expect(() => ensureRequiredColumn(123, 'DATA', '')).toThrow(
      /Required column missing.*boardId=123.*logicalColumn=DATA/
    );
    expect(() => ensureRequiredColumn(123, 'STATUS', '   ')).toThrow(
      /Required column missing/
    );
  });

  it('throws when boardColumns provided and colId not on board', () => {
    const boardColumns = [{ id: 'col_a' }, { id: 'col_b' }];
    expect(() => ensureRequiredColumn(123, 'DATA', 'col_c', boardColumns)).toThrow(
      /Required column not found on board.*boardId=123.*logicalColumn=DATA.*columnId=col_c/
    );
  });

  it('does not throw when colId is non-empty and no boardColumns', () => {
    expect(() => ensureRequiredColumn(123, 'DATA', 'date__1')).not.toThrow();
  });

  it('does not throw when colId exists in boardColumns', () => {
    const boardColumns = [{ id: 'col_a' }, { id: 'col_b' }];
    expect(() => ensureRequiredColumn(123, 'DATA', 'col_a', boardColumns)).not.toThrow();
  });
});

describe('fetchAllItems', () => {
  const boardId = 999;
  const colIds = ['col1', 'col2'];

  beforeEach(() => {
    mondayRequest.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.MONDAY_ITEMS_MAX_PAGES;
  });

  it('returns all items when single page (no cursor)', async () => {
    const page = {
      boards: [
        {
          items_page: {
            items: [{ id: 1, name: 'A', column_values: [] }],
            cursor: null,
          },
        },
      ],
    };
    mondayRequest.mockResolvedValueOnce(page);

    const result = await fetchAllItems(boardId, colIds);
    expect(result).toEqual({ items_page: { items: [{ id: 1, name: 'A', column_values: [] }] } });
    expect(mondayRequest).toHaveBeenCalledTimes(1);
  });

  it('repeated cursor (loop) throws with clear message', async () => {
    const sameCursor = 'repeated-cursor-id';
    const pageWithCursor = {
      boards: [
        {
          items_page: { items: [{ id: 1 }], cursor: sameCursor },
        },
      ],
    };
    mondayRequest
      .mockResolvedValueOnce(pageWithCursor)
      .mockResolvedValueOnce(pageWithCursor);

    await expect(fetchAllItems(boardId, colIds)).rejects.toThrow(
      /repeated cursor \(loop\) detected.*boardId=999/
    );
    expect(mondayRequest).toHaveBeenCalledTimes(2);
  });

  it('max pages exceeded throws with clear message', async () => {
    process.env.MONDAY_ITEMS_MAX_PAGES = '2';
    const pageWithCursor = (cursor) => ({
      boards: [{ items_page: { items: [], cursor } }],
    });
    mondayRequest
      .mockResolvedValueOnce(pageWithCursor('c1'))
      .mockResolvedValueOnce(pageWithCursor('c2'));

    await expect(fetchAllItems(boardId, colIds)).rejects.toThrow(
      /max pages exceeded.*boardId=999.*limit=2/
    );
    expect(mondayRequest).toHaveBeenCalledTimes(2);
  });
});

describe('fetchItemsDirectory', () => {
  const boardId = 888;
  const ownerColId = 'owner_col';

  beforeEach(() => {
    mondayRequest.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.MONDAY_ITEMS_MAX_PAGES;
  });

  it('returns items when single page (no cursor)', async () => {
    const page = {
      boards: [
        {
          items_page: {
            items: [{ id: 10, column_values: [] }],
            cursor: null,
          },
        },
      ],
    };
    mondayRequest.mockResolvedValueOnce(page);

    const result = await fetchItemsDirectory(boardId, ownerColId);
    expect(result).toEqual({ items_page: { items: [{ id: 10, column_values: [] }] } });
    expect(mondayRequest).toHaveBeenCalledTimes(1);
  });

  it('repeated cursor (loop) throws with clear message', async () => {
    const sameCursor = 'dir-repeated-cursor';
    const pageWithCursor = {
      boards: [
        {
          items_page: { items: [], cursor: sameCursor },
        },
      ],
    };
    mondayRequest
      .mockResolvedValueOnce(pageWithCursor)
      .mockResolvedValueOnce(pageWithCursor);

    await expect(fetchItemsDirectory(boardId, ownerColId)).rejects.toThrow(
      /repeated cursor \(loop\) detected.*boardId=888/
    );
    expect(mondayRequest).toHaveBeenCalledTimes(2);
  });

  it('max pages exceeded throws with clear message', async () => {
    process.env.MONDAY_ITEMS_MAX_PAGES = '2';
    const pageWithCursor = (cursor) => ({
      boards: [{ items_page: { items: [], cursor } }],
    });
    mondayRequest
      .mockResolvedValueOnce(pageWithCursor('d1'))
      .mockResolvedValueOnce(pageWithCursor('d2'));

    await expect(fetchItemsDirectory(boardId, ownerColId)).rejects.toThrow(
      /max pages exceeded.*boardId=888.*limit=2/
    );
    expect(mondayRequest).toHaveBeenCalledTimes(2);
  });
});
