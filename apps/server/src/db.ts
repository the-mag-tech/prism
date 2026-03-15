/**
 * Database Module
 * 
 * Provides database initialization and access.
 * Schema is managed by the migrations system (src/migrations/).
 * 
 * Uses Bun's native SQLite API (bun:sqlite) for single-binary compilation.
 * 
 * IMPORTANT: Do NOT add inline CREATE TABLE statements here.
 * All schema changes should go through versioned migrations.
 */

import { Database as BunDatabase } from 'bun:sqlite';
import path from 'path';
import { openDatabase, runMigrations, getDBVersion, needsMigration } from './migrations/index.js';

// Re-export Database type for use in other modules
export type Database = BunDatabase;

let db: Database;

/**
 * Initialize database with migrations.
 * 
 * This function:
 * 1. Opens the database file
 * 2. Runs any pending migrations
 * 3. Stores the db handle for getDB()
 */
export function initDB(dbPath?: string) {
  // Support both DATABASE_PATH (Dockerfile/Railway) and DB_PATH (legacy)
  const finalPath = dbPath || process.env.DATABASE_PATH || process.env.DB_PATH || path.join(process.cwd(), 'prism.db');

  // Log database path for debugging (helps catch wrong DB issues)
  console.error(`[DB] Initializing: ${finalPath}`);
  if (process.env.DATABASE_PATH || process.env.DB_PATH) {
    console.error(`[DB] Using ${process.env.DATABASE_PATH ? 'DATABASE_PATH' : 'DB_PATH'} from environment`);
  }

  // Open database
  db = openDatabase(finalPath);

  // Run migrations
  const result = runMigrations(db);

  if (!result.success) {
    throw new Error(`Database migration failed: ${result.error}`);
  }

  // Log success
  console.error(`[DB] ✓ Ready (version: ${getDBVersion(db)})`);
}

/**
 * Get the database handle.
 * Throws if database hasn't been initialized.
 */
export function getDB(): Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDB() first.');
  }
  return db;
}

/**
 * Close the database connection.
 * Useful for testing and graceful shutdown.
 */
export function closeDB(): void {
  if (db) {
    db.close();
    db = undefined as unknown as Database;
  }
}

/**
 * Get current database version.
 * Useful for debugging and health checks.
 */
export function getCurrentDBVersion(): number {
  if (!db) {
    throw new Error('Database not initialized. Call initDB() first.');
  }
  return getDBVersion(db);
}

/**
 * Check if database needs migrations.
 * Useful for health checks.
 */
export function dbNeedsMigration(): boolean {
  if (!db) {
    throw new Error('Database not initialized. Call initDB() first.');
  }
  return needsMigration(db);
}

// Re-export for convenience
export { openDatabase, runMigrations };
