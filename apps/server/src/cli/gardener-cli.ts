/**
 * @deprecated Use curator-cli.ts instead.
 * This CLI is kept for backward compatibility.
 */

import { CuratorAgent } from '../lib/agents/curator/agent.js';
import { initDB } from '../db.js';
import { config } from '../config.js';

async function main() {
  console.log('⚠️  DEPRECATED: Use `pnpm curator` instead of `pnpm gardener`\n');

  const args = process.argv.slice(2);
  const autoApply = args.includes('--apply');

  initDB(config.dbPath);
  
  const curator = new CuratorAgent();
  
  console.log('📚 Curator CLI started.');
  if (autoApply) {
    console.log('⚠️  AUTO-APPLY MODE. Merges will be executed.');
  } else {
    console.log('ℹ️  Dry Run Mode. Use --apply to execute merges.');
  }

  await curator.run(autoApply);
}

main().catch(console.error);
