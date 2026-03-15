/**
 * Migration V40 Test Suite
 * 
 * @ref worker/checklist
 * 
 * Verifies that the extraction_status migration:
 * 1. Adds the extraction_status column
 * 2. Creates appropriate index
 * 3. Marks orphan findings as 'pending'
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { migration as v40_extraction_status } from "../../src/migrations/v40_extraction_status.js";

describe("Migration V40: Extraction Status", () => {
  let db: Database;

  beforeEach(() => {
    // Use in-memory database for speed and isolation
    db = new Database(":memory:");
    
    // Setup: Create the entities and relations tables (simulate pre-V40 state)
    db.exec(`
      CREATE TABLE entities (
        id TEXT PRIMARY KEY,
        title TEXT,
        subtitle TEXT,
        body TEXT,
        tag TEXT,
        memo_id INTEGER,
        created_at TEXT DEFAULT '2025-01-01'
      );

      CREATE TABLE relations (
        id INTEGER PRIMARY KEY,
        source TEXT,
        target TEXT,
        type TEXT,
        weight REAL DEFAULT 1.0,
        created_at TEXT DEFAULT '2025-01-01'
      );
    `);

    // Seed Data: Create findings
    // 1. Finding with extracted entities (should stay 'completed')
    db.run(`
      INSERT INTO entities (id, title, memo_id)
      VALUES ('finding:1', 'Complete Finding', 1)
    `);
    db.run(`
      INSERT INTO relations (source, target, type)
      VALUES ('finding:1', 'topic:extracted', 'contains')
    `);

    // 2. Orphan finding without extracted entities (should be marked 'pending')
    db.run(`
      INSERT INTO entities (id, title, memo_id)
      VALUES ('finding:2', 'Orphan Finding', 2)
    `);

    // 3. Another orphan finding
    db.run(`
      INSERT INTO entities (id, title, memo_id)
      VALUES ('finding:3', 'Another Orphan', 3)
    `);

    // 4. Non-finding entity (should be unaffected)
    db.run(`
      INSERT INTO entities (id, title)
      VALUES ('person:test', 'Test Person')
    `);
  });

  afterEach(() => {
    db.close();
  });

  test("should add extraction_status column with default 'completed'", () => {
    v40_extraction_status.up(db);

    // Check column exists
    const columns = db.query(`PRAGMA table_info(entities)`).all() as any[];
    const statusColumn = columns.find((c: any) => c.name === 'extraction_status');
    
    expect(statusColumn).toBeTruthy();
    expect(statusColumn.dflt_value).toBe("'completed'");
  });

  test("should mark orphan findings as 'pending'", () => {
    v40_extraction_status.up(db);

    // Check that orphan findings are marked as pending
    const orphan1 = db.query(`
      SELECT extraction_status FROM entities WHERE id = 'finding:2'
    `).get() as any;
    expect(orphan1.extraction_status).toBe('pending');

    const orphan2 = db.query(`
      SELECT extraction_status FROM entities WHERE id = 'finding:3'
    `).get() as any;
    expect(orphan2.extraction_status).toBe('pending');
  });

  test("should keep findings with relations as 'completed'", () => {
    v40_extraction_status.up(db);

    // Finding with 'contains' relation should stay completed
    const complete = db.query(`
      SELECT extraction_status FROM entities WHERE id = 'finding:1'
    `).get() as any;
    expect(complete.extraction_status).toBe('completed');
  });

  test("should not affect non-finding entities", () => {
    v40_extraction_status.up(db);

    // Person entity should have default 'completed'
    const person = db.query(`
      SELECT extraction_status FROM entities WHERE id = 'person:test'
    `).get() as any;
    expect(person.extraction_status).toBe('completed');
  });

  test("should create index for pending/failed status queries", () => {
    v40_extraction_status.up(db);

    // Check index exists
    const indexes = db.query(`
      SELECT name FROM sqlite_master 
      WHERE type = 'index' AND name = 'idx_entities_extraction_status'
    `).all();
    
    expect(indexes.length).toBe(1);
  });

  test("should be idempotent (run twice without error)", () => {
    v40_extraction_status.up(db);
    
    // Running again should not throw
    expect(() => v40_extraction_status.up(db)).not.toThrow();
    
    // Counts should remain the same
    const pendingCount = db.query(`
      SELECT COUNT(*) as c FROM entities WHERE extraction_status = 'pending'
    `).get() as any;
    expect(pendingCount.c).toBe(2); // Still 2 orphans
  });
});





