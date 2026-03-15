/**
 * Migration V19: Gravity Signals Enhancement
 * 
 * Adds event_time column for Convergence calculation
 * and ensures entity_visits structure supports Spark calculation.
 */

import type { Database } from 'bun:sqlite';
import type { Migration } from './index.js';

/**
 * Check if a column exists in a table
 */
function columnExists(db: Database, tableName: string, columnName: string): boolean {
  try {
    const columns = db.query(`PRAGMA table_info(${tableName})`).all() as { name: string }[];
    return columns.some(c => c.name === columnName);
  } catch {
    return false;
  }
}

export const v19_gravity_signals: Migration = {
  version: 19,
  name: 'gravity_signals',
  description: 'Add event_time column for Convergence and fix entity_visits for Spark calculation',
  
  up: (db: Database) => {
    // ==========================================================================
    // 1. Add event_time column to entities table for Convergence calculation
    // ==========================================================================
    if (!columnExists(db, 'entities', 'event_time')) {
      console.error('  Adding event_time column to entities...');
      db.exec(`ALTER TABLE entities ADD COLUMN event_time TEXT;`);
    }
    
    // Also add to entity_profiles (ECS)
    if (!columnExists(db, 'entity_profiles', 'event_time')) {
      console.error('  Adding event_time column to entity_profiles...');
      db.exec(`ALTER TABLE entity_profiles ADD COLUMN event_time TEXT;`);
    }
    
    // ==========================================================================
    // 2. Create a view for entity visit counts (for Spark calculation)
    // ==========================================================================
    // The entity_visits table has individual visit records, not aggregated counts.
    // Create a view that aggregates visit data for efficient querying.
    console.error('  Creating entity_visit_stats view...');
    
    db.exec(`DROP VIEW IF EXISTS entity_visit_stats;`);
    db.exec(`
      CREATE VIEW entity_visit_stats AS
      SELECT 
        entity_id,
        COUNT(*) as visit_count,
        MAX(visited_at) as last_visited,
        SUM(dwell_ms) as total_dwell_ms
      FROM entity_visits
      GROUP BY entity_id;
    `);
    
    // ==========================================================================
    // 3. Add index for efficient time-based queries
    // ==========================================================================
    console.error('  Adding index for event_time...');
    db.exec(`CREATE INDEX IF NOT EXISTS idx_entities_event_time ON entities(event_time);`);
    
    // ==========================================================================
    // 4. Backfill event_time for existing event entities (best effort)
    // ==========================================================================
    // For events with time-related tags, try to parse and set event_time
    // This is a heuristic - actual event times should come from extraction
    console.error('  Backfilling event_time for existing events...');
    
    // Get events with specific tags that suggest timing
    const events = db.query(`
      SELECT id, tag FROM entities 
      WHERE id LIKE 'event:%' AND event_time IS NULL
    `).all() as { id: string; tag: string | null }[];
    
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
    const nextWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
    
    for (const event of events) {
      const tag = event.tag?.toUpperCase() || '';
      let eventTime: Date | null = null;
      
      // Heuristic time assignment based on tags
      if (tag.includes('TODAY') || tag.includes('NOW')) {
        eventTime = today;
      } else if (tag.includes('TOMORROW') || tag.includes('TMRW')) {
        eventTime = tomorrow;
      } else if (tag.includes('WEEK') || tag.includes('UPCOMING')) {
        eventTime = nextWeek;
      }
      
      if (eventTime) {
        db.query(`UPDATE entities SET event_time = ? WHERE id = ?`)
          .run(eventTime.toISOString(), event.id);
      }
    }
    
    console.error(`  Processed ${events.length} event entities`);
  },
};

