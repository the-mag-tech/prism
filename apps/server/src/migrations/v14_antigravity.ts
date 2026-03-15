import { Database } from 'bun:sqlite';

export const up = (db: Database) => {
  // 1. Add base_gravity to entities
  try {
    db.exec('ALTER TABLE entities ADD COLUMN base_gravity REAL DEFAULT 0.5');
  } catch (e: any) {
    if (!e.message.includes('duplicate column')) throw e;
  }

  // 2. Create entity_gravity cache table
  db.exec(`
    CREATE TABLE IF NOT EXISTS entity_gravity (
      entity_id TEXT PRIMARY KEY,
      gravity_score REAL NOT NULL,
      components JSON, -- { convergence: 0.8, path: 0.2, spark: 0.1 }
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // 3. Create field_snapshots for history/debugging
  db.exec(`
    CREATE TABLE IF NOT EXISTS field_snapshots (
      id TEXT PRIMARY KEY,
      created_at TEXT DEFAULT (datetime('now')),
      context_mode TEXT, -- 'default', 'morning', 'work', 'social'
      blocks JSON -- The full layout configuration
    )
  `);
  
  // 4. Initialize base gravity for existing types
  // Events are high mass (0.8), People are medium (0.6), Topics (0.5), Docs (0.3)
  db.exec(`UPDATE entities SET base_gravity = 0.8 WHERE id LIKE 'event:%'`);
  db.exec(`UPDATE entities SET base_gravity = 0.6 WHERE id LIKE 'person:%'`);
  db.exec(`UPDATE entities SET base_gravity = 0.5 WHERE id LIKE 'topic:%'`);
  db.exec(`UPDATE entities SET base_gravity = 0.5 WHERE id LIKE 'company:%'`);
  db.exec(`UPDATE entities SET base_gravity = 0.3 WHERE id LIKE 'doc:%'`);
};

export const down = (db: Database) => {
  db.exec('DROP TABLE IF EXISTS field_snapshots');
  db.exec('DROP TABLE IF EXISTS entity_gravity');
  try {
    db.exec('ALTER TABLE entities DROP COLUMN base_gravity');
  } catch (e) {
    // SQLite doesn't support dropping columns in older versions, ignore
  }
};
