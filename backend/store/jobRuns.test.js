import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as jobRuns from './jobRuns.js';

describe('jobRuns store', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('isPersistenceConfigured', () => {
    it('returns false when GCP_PROJECT_ID and FIRESTORE_PROJECT_ID are unset', () => {
      delete process.env.GCP_PROJECT_ID;
      delete process.env.FIRESTORE_PROJECT_ID;
      expect(jobRuns.isPersistenceConfigured()).toBe(false);
    });

    it('returns true when GCP_PROJECT_ID is set', () => {
      process.env.GCP_PROJECT_ID = 'my-project';
      expect(jobRuns.isPersistenceConfigured()).toBe(true);
    });

    it('returns true when FIRESTORE_PROJECT_ID is set', () => {
      process.env.FIRESTORE_PROJECT_ID = 'my-project';
      expect(jobRuns.isPersistenceConfigured()).toBe(true);
    });
  });

  describe('requirePersistenceWhenNotDryRun', () => {
    it('throws when not DRY_RUN and Firestore not configured', () => {
      delete process.env.DRY_RUN;
      delete process.env.GCP_PROJECT_ID;
      delete process.env.FIRESTORE_PROJECT_ID;
      expect(() => jobRuns.requirePersistenceWhenNotDryRun()).toThrow(
        'Firestore is required when not in DRY_RUN'
      );
      expect(() => jobRuns.requirePersistenceWhenNotDryRun()).toThrow(
        'GCP_PROJECT_ID or FIRESTORE_PROJECT_ID'
      );
    });

    it('does not throw when DRY_RUN=1 even if Firestore not configured', () => {
      process.env.DRY_RUN = '1';
      delete process.env.GCP_PROJECT_ID;
      expect(() => jobRuns.requirePersistenceWhenNotDryRun()).not.toThrow();
    });

    it('does not throw when Firestore is configured (GCP_PROJECT_ID set)', () => {
      delete process.env.DRY_RUN;
      process.env.GCP_PROJECT_ID = 'my-project';
      expect(() => jobRuns.requirePersistenceWhenNotDryRun()).not.toThrow();
    });
  });

  describe('getJobRun', () => {
    it('returns null when Firestore not configured (no project id)', async () => {
      delete process.env.GCP_PROJECT_ID;
      delete process.env.FIRESTORE_PROJECT_ID;
      const result = await jobRuns.getJobRun('weekly', '2026-01-19..2026-01-25');
      expect(result).toBeNull();
    });
  });
});
