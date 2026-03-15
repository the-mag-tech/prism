/**
 * Quick check script for alias status
 */
import { initDB, getDB } from '../db.js';
import { config } from '../config.js';

initDB(config.dbPath);
const db = getDB();

console.log('=== Entity Aliases ===');
const aliases = db.query('SELECT canonical_id, alias_id FROM entity_aliases').all();
console.table(aliases);

console.log('\n=== Seed-related entities ===');
const seeds = db.query(`SELECT id, title FROM entities WHERE id LIKE '%seed%'`).all();
console.table(seeds);

console.log('\n=== Entities that are aliases (should be filtered) ===');
const aliasEntities = db.query(`
  SELECT e.id, e.title 
  FROM entities e 
  WHERE EXISTS (SELECT 1 FROM entity_aliases ea WHERE ea.alias_id = e.id)
`).all();
console.table(aliasEntities);




