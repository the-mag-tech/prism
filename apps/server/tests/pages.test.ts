import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { initDB, closeDB } from '../src/db.js';
import { 
  getEntity, 
  getPageFromDB, 
  listPagesFromDB, 
  hasPage,
  upsertEntity,
  addPageBlock,
  addRelation,
  clearPageData
} from '../src/pages.js';

describe('Pages Data Layer', () => {
  const testDbPath = './test_pages.db';

  beforeAll(() => {
    initDB(testDbPath);
    clearPageData();
    
    // Seed test data
    upsertEntity({ id: 'person:alice', title: 'Alice', subtitle: 'Engineer' });
    upsertEntity({ id: 'person:bob', title: 'Bob', body: 'Works at Acme' });
    upsertEntity({ id: 'company:acme', title: 'Acme Corp', tag: 'COMPANY' });
    upsertEntity({ id: 'event:meeting', title: 'Team Meeting', subtitle: 'Tomorrow 10am' });
    upsertEntity({ id: 'daily', title: 'Today', subtitle: 'Monday' });
    
    // Set up page blocks for daily page
    addPageBlock('daily', 'daily', 0);
    addPageBlock('daily', 'event:meeting', 1, 'event:meeting', 'URGENT');
    addPageBlock('daily', 'person:alice', 2, 'person:alice');
    
    // Set up page blocks for event page
    addPageBlock('event:meeting', 'event:meeting', 0);
    addPageBlock('event:meeting', 'person:alice', 1, 'person:alice', 'ATTENDEE');
    addPageBlock('event:meeting', 'person:bob', 2, 'person:bob', 'ATTENDEE');
    
    // Add relations
    addRelation({ source: 'event:meeting', target: 'person:alice', type: 'participant' });
    addRelation({ source: 'event:meeting', target: 'person:bob', type: 'participant' });
    addRelation({ source: 'person:alice', target: 'company:acme', type: 'related', evidence: 'linkedin' });
  });

  afterAll(() => {
    closeDB();
    // Clean up test database
    const fs = require('fs');
    try {
      fs.unlinkSync(testDbPath);
      fs.unlinkSync(testDbPath + '-wal');
      fs.unlinkSync(testDbPath + '-shm');
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  describe('getEntity', () => {
    it('should return entity by ID', () => {
      const entity = getEntity('person:alice');
      expect(entity).not.toBeNull();
      expect(entity?.title).toBe('Alice');
      expect(entity?.subtitle).toBe('Engineer');
    });

    it('should return null for non-existent entity', () => {
      const entity = getEntity('person:nonexistent');
      expect(entity).toBeNull();
    });
  });

  describe('hasPage', () => {
    it('should return true for existing page', () => {
      expect(hasPage('daily')).toBe(true);
      expect(hasPage('event:meeting')).toBe(true);
    });

    it('should return false for non-existent page', () => {
      expect(hasPage('nonexistent:page')).toBe(false);
    });
  });

  describe('getPageFromDB', () => {
    it('should return page with blocks', () => {
      const page = getPageFromDB('daily');
      expect(page).not.toBeNull();
      expect(page?.id).toBe('daily');
      expect(page?.blocks.length).toBeGreaterThan(0);
    });

    it('should include header block first', () => {
      const page = getPageFromDB('daily');
      expect(page?.blocks[0].id).toBe('daily');
      expect(page?.blocks[0].title).toBe('Today');
    });

    it('should include other blocks with overridden tags', () => {
      const page = getPageFromDB('daily');
      const meetingBlock = page?.blocks.find(b => b.id === 'event:meeting');
      expect(meetingBlock).toBeDefined();
      expect(meetingBlock?.tag).toBe('URGENT'); // Overridden tag
    });

    it('should include relations', () => {
      const page = getPageFromDB('event:meeting');
      expect(page?.relations).toBeDefined();
      expect(page?.relations?.length).toBeGreaterThan(0);
      
      const aliceRelation = page?.relations?.find(r => r.target === 'person:alice');
      expect(aliceRelation?.type).toBe('participant');
    });

    it('should return null for non-existent page', () => {
      const page = getPageFromDB('nonexistent:page');
      expect(page).toBeNull();
    });
  });

  describe('listPagesFromDB', () => {
    it('should return list of pages with titles', () => {
      const pages = listPagesFromDB();
      expect(pages.length).toBeGreaterThan(0);
      
      const dailyPage = pages.find(p => p.id === 'daily');
      expect(dailyPage).toBeDefined();
      expect(dailyPage?.title).toBe('Today');
    });
  });

  describe('upsertEntity', () => {
    it('should update existing entity', () => {
      upsertEntity({ id: 'person:alice', title: 'Alice Updated', subtitle: 'Senior Engineer' });
      
      const entity = getEntity('person:alice');
      expect(entity?.title).toBe('Alice Updated');
      expect(entity?.subtitle).toBe('Senior Engineer');
    });

    it('should create new entity', () => {
      upsertEntity({ id: 'person:charlie', title: 'Charlie', body: 'New person' });
      
      const entity = getEntity('person:charlie');
      expect(entity).not.toBeNull();
      expect(entity?.title).toBe('Charlie');
    });
  });
});

