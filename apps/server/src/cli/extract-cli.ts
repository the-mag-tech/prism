/**
 * Entity Extraction CLI
 * 
 * @ref infra/memo-id
 * @doc docs/WORKER-CHECKLIST.md
 * 
 * Usage:
 *   pnpm extract                          - Extract from new memories only
 *   pnpm extract --all                    - Extract from all memories
 *   pnpm extract --memory-ids=1,2,3       - Extract from specific memories
 *   pnpm extract --idempotent             - Update existing + add missing relations
 *   pnpm extract --dry-run                - Preview without saving
 *   pnpm extract --strategy=v2-fine       - Use specific strategy version
 *   pnpm extract --desc="Test run"        - Add description to batch
 * 
 * Environment:
 *   DB_PATH                               - Override database path
 */

import 'dotenv/config';
import { initDB } from '../db.js';
import { runExtraction } from '../extract.js';

const args = process.argv.slice(2);

// Show help if requested
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Entity Extraction CLI

Usage:
  pnpm extract [options]

Options:
  --all                    Process all memories (default: new only)
  --memory-ids=1,2,3       Process specific memory IDs
  --retry-pending, --retry Retry all pending/failed extractions
  --idempotent, -i         Update existing entities, add missing relations
  --dry-run                Preview without saving to database
  --strategy=<version>     Use specific extraction strategy
  --desc="<description>"   Add description to extraction batch

Environment Variables:
  DB_PATH                  Override database path
                           Default: ./prism.db (dev) or ~/Library/.../prism.db (Tauri)

Examples:
  pnpm extract                           # Extract from new memories
  pnpm extract --memory-ids=374          # Extract from specific memory
  pnpm extract --idempotent              # Re-process all, fix missing links
  DB_PATH=~/data/prism.db pnpm extract   # Use custom database
`);
  process.exit(0);
}

// Validate --memory-ids format if provided
const memoryIdsArg = args.find(a => a.startsWith('--memory-ids'));
if (memoryIdsArg && !memoryIdsArg.includes('=')) {
  console.error('Error: --memory-ids requires a value');
  console.error('Usage: --memory-ids=1,2,3');
  console.error('Run with --help for more information');
  process.exit(1);
}

// Initialize database
initDB();

// Run extraction
runExtraction(args).catch(err => {
  console.error('Extraction failed:', err.message);
  process.exit(1);
});

