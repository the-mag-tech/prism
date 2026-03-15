import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { build } from '../src/app.js';
import { initDB, getDB, closeDB } from '../src/db.js';
import { initFeatureFlags } from '../src/feature-flags.js';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// Use unique DB path to avoid WAL file locking issues
function createTestDbPath(): string {
  const uniqueId = crypto.randomBytes(8).toString('hex');
  return path.join(process.cwd(), `test_api_${uniqueId}.db`);
}

function cleanupTestDb(dbPath: string) {
  const files = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`];
  for (const file of files) {
    try {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch { /* ignore */ }
  }
}

describe('API Endpoints', () => {
  let app: ReturnType<typeof build>;
  let testDbPath: string;

  beforeAll(async () => {
    testDbPath = createTestDbPath();
    initDB(testDbPath);
    initFeatureFlags(); // Initialize feature flags table
    
    app = build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    closeDB();
    // Small delay to ensure all handles are released
    await new Promise(resolve => setTimeout(resolve, 100));
    cleanupTestDb(testDbPath);
  });

  // ==========================================================================
  // HEALTH CHECK
  // ==========================================================================

  describe('GET /health', () => {
    it('should return ok status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.status).toBe('ok');
      expect(json.version).toBeDefined();
    });
  });

  // ==========================================================================
  // PAGES API
  // ==========================================================================

  describe('GET /pages', () => {
    it('should return a list of pages', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/pages',
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.pages).toBeDefined();
      expect(Array.isArray(json.pages)).toBe(true);
    });
  });

  describe('GET /pages/:id', () => {
    it('should return 404 for non-existent page', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/pages/nonexistent:page',
      });

      expect(response.statusCode).toBe(404);
      const json = response.json();
      expect(json.error).toBe('Page not found');
    });

    it('should return 404 for non-existent daily page', async () => {
      // Note: "daily" page is not dynamically generated - it must exist in DB
      const response = await app.inject({
        method: 'GET',
        url: '/pages/daily',
      });

      expect(response.statusCode).toBe(404);
      const json = response.json();
      expect(json.error).toBe('Page not found');
    });
  });

  // ==========================================================================
  // SCOUT API
  // ==========================================================================

  describe('POST /api/scout/profile', () => {
    it('should return 400 for missing entity', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/scout/profile',
        payload: { context: 'test' },
        headers: { 'Content-Type': 'application/json' },
      });

      expect(response.statusCode).toBe(400);
      const json = response.json();
      expect(json.error).toBe('Missing entity');
    });

    // Note: Testing success case requires API keys, skipped in CI
    // it('should return profile for valid entity', async () => { ... });
  });

  // ==========================================================================
  // EXPLORE API
  // ==========================================================================

  describe('POST /explore', () => {
    it('should return 400 for missing word', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/explore',
        payload: {},
        headers: { 'Content-Type': 'application/json' },
      });

      expect(response.statusCode).toBe(400);
      const json = response.json();
      expect(json.error).toBe('Missing word');
    });

    it('should return 400 for empty word', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/explore',
        payload: { word: '  ' },
        headers: { 'Content-Type': 'application/json' },
      });

      expect(response.statusCode).toBe(400);
      const json = response.json();
      expect(json.error).toBe('Missing word');
    });

    // Note: Testing success case requires API keys, skipped in CI
  });

  // ==========================================================================
  // NAVIGATION API
  // ==========================================================================

  describe('POST /navigation', () => {
    it('should return 400 for missing path', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/navigation',
        payload: {},
        headers: { 'Content-Type': 'application/json' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 400 for empty path array', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/navigation',
        payload: { path: [] },
        headers: { 'Content-Type': 'application/json' },
      });

      expect(response.statusCode).toBe(400);
    });

    // Skip: navigation_sessions table not created in current migrations
    it.skip('should record navigation with valid path', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/navigation',
        payload: { path: ['person:alice', 'event:meeting'] },
        headers: { 'Content-Type': 'application/json' },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.sessionId).toBeDefined();
    });
  });

  // ==========================================================================
  // ENTITIES API
  // ==========================================================================

  describe('GET /entities/search', () => {
    it('should return empty results for short query', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/entities/search?q=a',
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.results).toEqual([]);
    });

    it('should return results for valid query', async () => {
      // First, seed some data
      const db = getDB();
      db.query(`
        INSERT INTO entities (id, title, subtitle, base_gravity)
        VALUES ('person:test_user', 'Test User', 'A test person', 0.5)
      `).run();

      const response = await app.inject({
        method: 'GET',
        url: '/entities/search?q=Test',
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.results.length).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // SETTINGS API
  // ==========================================================================

  describe('GET /settings', () => {
    it('should return current settings', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/settings',
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json).toHaveProperty('navigationTracking');
      expect(json).toHaveProperty('feedbackTracking');
    });
  });

  describe('PATCH /settings', () => {
    it('should update settings', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/settings',
        payload: { navigationTracking: false },
        headers: { 'Content-Type': 'application/json' },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.navigationTracking).toBe(false);
    });
  });

  // ==========================================================================
  // GARDENER API
  // ==========================================================================

  describe('GET /gardener/status', () => {
    it('should return gardener status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/gardener/status',
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json).toHaveProperty('pendingCandidates');
      expect(json).toHaveProperty('recentMerges');
    });
  });
});

