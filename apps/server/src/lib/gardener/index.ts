/**
 * @deprecated This module has been renamed to "curator".
 * 
 * The "Gardener" name is now reserved for relationship maintenance (see gardener-v2).
 * 
 * Please update your imports:
 *   - import { CuratorAgent } from './lib/agents/curator/index.js'
 *   - import { startCuratorService } from './lib/agents/curator/service.js'
 * 
 * This file re-exports from curator for backward compatibility only.
 */

export * from '../agents/curator/index.js';
