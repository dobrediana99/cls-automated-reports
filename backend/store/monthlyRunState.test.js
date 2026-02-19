/**
 * Unit tests for monthly run-state store (checkpointing).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createInitialState,
  isValidRunState,
  loadMonthlyRunState,
  saveMonthlyRunState,
  markCollectOk,
  markDepartmentLlmOk,
  markDepartmentSend,
  ensureEmployeeEntry,
  markEmployeeLlmOk,
  markEmployeeSend,
  markCompleted,
  RUN_STATE_VERSION,
  RUN_STATE_CORRUPT,
  RUN_STATE_UNAVAILABLE,
} from './monthlyRunState.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_DIR = path.join(__dirname, '..', 'state', 'monthly_runs');
function stateFilePath(label) {
  const safe = String(label ?? '').replace(/[/\\?*:]/g, '_');
  return path.join(STATE_DIR, `monthly-${safe}.json`);
}

describe('monthlyRunState', () => {
  const label = '2025-12-01..2025-12-31';
  const periodStart = '2025-12-01';
  const periodEnd = '2025-12-31';

  beforeEach(() => {
    delete process.env.SNAPSHOT_BUCKET;
  });
  afterEach(() => {
    delete process.env.SNAPSHOT_BUCKET;
  });

  describe('createInitialState', () => {
    it('returns state with correct shape and version', () => {
      const state = createInitialState({ label, periodStart, periodEnd });
      expect(state.version).toBe(RUN_STATE_VERSION);
      expect(state.jobType).toBe('monthly');
      expect(state.label).toBe(label);
      expect(state.periodStart).toBe(periodStart);
      expect(state.periodEnd).toBe(periodEnd);
      expect(state.completed).toBe(false);
      expect(state.stages.collect.status).toBe('pending');
      expect(state.stages.department.llm.status).toBe('pending');
      expect(state.stages.department.send.status).toBe('pending');
      expect(state.stages.employees).toEqual({});
    });
  });

  describe('isValidRunState', () => {
    it('accepts valid state', () => {
      const state = createInitialState({ label, periodStart, periodEnd });
      expect(isValidRunState(state, label)).toBe(true);
    });
    it('rejects wrong label', () => {
      const state = createInitialState({ label, periodStart, periodEnd });
      expect(isValidRunState(state, 'other-label')).toBe(false);
    });
    it('rejects invalid doc', () => {
      expect(isValidRunState(null, label)).toBe(false);
      expect(isValidRunState({}, label)).toBe(false);
      expect(isValidRunState({ version: 1, jobType: 'monthly', label }, label)).toBe(false);
    });
  });

  describe('local load/save (no SNAPSHOT_BUCKET)', () => {
    it('saves and loads state round-trip', async () => {
      const uniqueLabel = `test-${Date.now()}-2025-12-01..2025-12-31`;
      const state = createInitialState({ label: uniqueLabel, periodStart, periodEnd });
      await saveMonthlyRunState(uniqueLabel, state);
      const loaded = await loadMonthlyRunState(uniqueLabel);
      expect(loaded).not.toBeNull();
      expect(loaded?.label).toBe(uniqueLabel);
      expect(loaded?.stages.collect.status).toBe('pending');
    });
  });

  describe('loadMonthlyRunState fail-closed semantics', () => {
    it('returns null on MISS (local ENOENT)', async () => {
      const label = 'nonexistent-label-' + Date.now();
      const loaded = await loadMonthlyRunState(label);
      expect(loaded).toBeNull();
    });

    it('throws RUN_STATE_CORRUPT on invalid JSON (local)', async () => {
      const label = 'test-corrupt-json-' + Date.now();
      if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
      fs.writeFileSync(stateFilePath(label), 'not json', 'utf8');
      try {
        await expect(loadMonthlyRunState(label)).rejects.toMatchObject({
          code: RUN_STATE_CORRUPT,
          message: expect.stringContaining('invalid JSON'),
        });
      } finally {
        try { fs.unlinkSync(stateFilePath(label)); } catch (_) {}
      }
    });

    it('throws RUN_STATE_CORRUPT on invalid schema (local)', async () => {
      const label = 'test-corrupt-schema-' + Date.now();
      if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
      const invalidState = { version: 1, jobType: 'monthly', label, stages: {} };
      fs.writeFileSync(stateFilePath(label), JSON.stringify(invalidState), 'utf8');
      try {
        await expect(loadMonthlyRunState(label)).rejects.toMatchObject({
          code: RUN_STATE_CORRUPT,
          message: expect.stringContaining('invalid schema'),
        });
      } finally {
        try { fs.unlinkSync(stateFilePath(label)); } catch (_) {}
      }
    });

    it('throws RUN_STATE_UNAVAILABLE on non-miss read error (local)', async () => {
      vi.spyOn(fs, 'readFileSync').mockImplementationOnce(() => {
        throw Object.assign(new Error('Permission denied'), { code: 'EACCES' });
      });
      try {
        await expect(loadMonthlyRunState('any-label')).rejects.toMatchObject({
          code: RUN_STATE_UNAVAILABLE,
          message: expect.stringContaining('read failed'),
        });
      } finally {
        vi.restoreAllMocks();
      }
    });
  });

  describe('stage helpers', () => {
    it('markCollectOk updates state', async () => {
      const state = createInitialState({ label, periodStart, periodEnd });
      const save = vi.fn().mockResolvedValue(undefined);
      await markCollectOk(state, save);
      expect(state.stages.collect.status).toBe('ok');
      expect(save).toHaveBeenCalledWith(state);
    });

    it('markDepartmentLlmOk and markDepartmentSend update state', async () => {
      const state = createInitialState({ label, periodStart, periodEnd });
      const save = vi.fn().mockResolvedValue(undefined);
      await markDepartmentLlmOk(state, { foo: 'bar' }, save);
      expect(state.stages.department.llm.status).toBe('ok');
      expect(state.stages.department.llmSections).toEqual({ foo: 'bar' });
      await markDepartmentSend(state, 'ok', null, save);
      expect(state.stages.department.send.status).toBe('ok');
    });

    it('ensureEmployeeEntry and employee marks update state', async () => {
      const state = createInitialState({ label, periodStart, periodEnd });
      const save = vi.fn().mockResolvedValue(undefined);
      ensureEmployeeEntry(state, 'a@b.com', 'Alice');
      expect(state.stages.employees['a@b.com'].name).toBe('Alice');
      await markEmployeeLlmOk(state, 'a@b.com', { sect: 1 }, save);
      expect(state.stages.employees['a@b.com'].llm.status).toBe('ok');
      await markEmployeeSend(state, 'a@b.com', 'ok', null, save);
      expect(state.stages.employees['a@b.com'].send.status).toBe('ok');
    });

    it('markCompleted sets completed', async () => {
      const state = createInitialState({ label, periodStart, periodEnd });
      const save = vi.fn().mockResolvedValue(undefined);
      await markCompleted(state, save);
      expect(state.completed).toBe(true);
      expect(save).toHaveBeenCalledWith(state);
    });
  });
});
