/**
 * Curator CLI
 * 
 * Command-line interface for knowledge graph structure maintenance.
 * 
 * Usage:
 *   pnpm curator              # Dry run - show what would be merged
 *   pnpm curator --apply      # Execute merges
 */

import { CuratorAgent } from '../lib/agents/curator/agent.js';
import { initDB } from '../db.js';
import { config } from '../config.js';

async function main() {
  const args = process.argv.slice(2);
  const autoApply = args.includes('--apply');

  initDB(config.dbPath);
  
  const curator = new CuratorAgent();
  
  console.log('📚 Curator CLI started.');
  if (autoApply) {
    console.log('⚠️  AUTO-APPLY MODE ENABLED. Merges will be executed immediately.');
  } else {
    console.log('ℹ️  Dry Run Mode. Use --apply to execute merges.');
  }

  await curator.run(autoApply);
}

main().catch(console.error);





