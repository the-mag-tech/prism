/**
 * Prism Server - Main Entry Point
 * 
 * Startup Sequence:
 * 1. Initialize database (runs migrations)
 * 2. Run health check (verify integrity, mark stale data)
 * 3. Self-heal auto-fixable issues
 * 4. Initialize settings
 * 5. Start server
 * 6. Start background worker (lazy migration)
 * 7. Initialize durable task queue (liteque)
 * 8. Recover pending tasks from crash
 */

import { build } from './app.js';
import { initDB, getDB, getCurrentDBVersion } from './db.js';
import { initFeatureFlags } from './feature-flags.js';
import { config } from './config.js';
import { runHealthCheck, selfHeal } from './health-check.js';
import { startBackgroundWorker, getWorkerStatus } from './background-worker.js';
import { ScoutSystem } from './systems/ScoutSystem.js';
import { startCuratorService } from './lib/agents/curator/service.js';
import { checkPipelineVersionMismatch, markOutdatedEntitiesStale, getExtractionVersion } from './pipeline-version.js';
import { rippleSystem } from './systems/RippleSystem.js';
import { initQueueSystem, shutdownQueueSystem, runStartupRecovery } from './lib/queue/index.js';
import { join, dirname } from 'pathe';

// =============================================================================
// ECS SCOUT SYSTEM SERVICE
// =============================================================================

import { isOpenAIAvailable, onKeysConfigured, loadSharedConfig, logAIServicesStatus } from './lib/ai-clients.js';
import { isSearchAvailable } from './lib/search-service.js';

let scoutSystem: ScoutSystem | null = null;
let scoutIntervalId: ReturnType<typeof setInterval> | null = null;
let scoutStartAttempted = false;
let scoutAutoTickEnabled = true; // Can be toggled via API
let scoutTickInProgress = false; // Track if a tick is currently running

// =============================================================================
// SCOUT QUOTA SYSTEM (re-export from dedicated module)
// =============================================================================

export {
  canConsumeQuota,
  consumeQuota,
  getQuotaStatus,
  setDailyQuota,
} from './lib/scout-quota.js';

/**
 * Stop the auto-tick scheduler (but keep scoutSystem instance for manual ticks)
 */
export function stopScoutAutoTick(): void {
  if (scoutIntervalId) {
    clearInterval(scoutIntervalId);
    scoutIntervalId = null;
    console.log('[ScoutSystem] Auto-tick stopped');
  }
  scoutAutoTickEnabled = false;
}

/**
 * Resume the auto-tick scheduler
 */
export function resumeScoutAutoTick(): boolean {
  if (!scoutSystem) {
    // Try to start the system first
    const started = tryStartScoutSystem();
    if (!started) return false;
  }
  
  if (scoutIntervalId) {
    console.log('[ScoutSystem] Auto-tick already running');
    return true;
  }

  const SCOUT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
  scoutIntervalId = setInterval(async () => {
    if (scoutSystem && scoutAutoTickEnabled && !scoutTickInProgress) {
      try {
        scoutTickInProgress = true;
        await scoutSystem.tick();
      } catch (err: any) {
        console.error('[ScoutSystem] Error in tick:', err.message);
      } finally {
        scoutTickInProgress = false;
      }
    }
  }, SCOUT_INTERVAL_MS);

  scoutAutoTickEnabled = true;
  console.log('[ScoutSystem] Auto-tick resumed');
  return true;
}

/**
 * Check if auto-tick is currently enabled
 */
export function isScoutAutoTickEnabled(): boolean {
  return scoutAutoTickEnabled && scoutIntervalId !== null;
}

/**
 * Check if Scout is currently busy (tick in progress)
 */
export function isScoutBusy(): boolean {
  return scoutTickInProgress;
}

/**
 * Get ScoutSystem instance for manual tick (even if auto-tick is disabled)
 */
export function getScoutSystem(): ScoutSystem | null {
  return scoutSystem;
}

/**
 * Try to start ScoutSystem if Tavily is available.
 * 
 * Can be called:
 * 1. At server startup (if env vars are set)
 * 2. When keys are configured via API (hot start)
 * 
 * Safe to call multiple times - will only start once.
 */
function tryStartScoutSystem(): boolean {
  // Already running
  if (scoutSystem !== null) {
    console.log('[ScoutSystem] Already running, skipping start');
    return true;
  }
  
  // Check if any search is available (Tavily or Qveris via direct key or proxy)
  if (!isSearchAvailable()) {
    console.log('[ScoutSystem] ⚠️  No search provider available (Tavily/Qveris). Scout System disabled.');
    return false;
  }

  scoutSystem = new ScoutSystem();
  
  // Register Entity Lifecycle Hooks (proactive scout for new entities)
  scoutSystem.registerHooks();
  console.log('[ScoutSystem] ✓ Entity Lifecycle Hooks registered');
  
  console.log('[ScoutSystem] 🎯 ECS Scout System starting...');
  
  // Run first tick immediately
  scoutTickInProgress = true;
  scoutSystem.tick()
    .catch(err => {
      console.error('[ScoutSystem] Error in initial tick:', err.message);
    })
    .finally(() => {
      scoutTickInProgress = false;
    });

  // Schedule ticks every 5 minutes (reduced from 1 minute for cost savings)
  const SCOUT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
  scoutIntervalId = setInterval(async () => {
    // Check both system exists and auto-tick is enabled
    if (scoutSystem && scoutAutoTickEnabled && !scoutTickInProgress) {
      try {
        scoutTickInProgress = true;
        await scoutSystem.tick();
      } catch (err: any) {
        console.error('[ScoutSystem] Error in tick:', err.message);
      } finally {
        scoutTickInProgress = false;
      }
    }
  }, SCOUT_INTERVAL_MS);

  console.log(`[ScoutSystem] Scheduled: tick every ${SCOUT_INTERVAL_MS / 1000}s`);
  console.log('[ScoutSystem] LOD Policy: G>0.9→1h, G>0.7→12h, G>0.3→48h (cost-optimized)');
  return true;
}

/**
 * Register callback to hot-start ScoutSystem when keys become available.
 * This allows frontend to inject keys after server start.
 */
function registerScoutHotStart() {
  onKeysConfigured(() => {
    if (scoutSystem === null) {
      console.log('[ScoutSystem] Keys configured, attempting hot start...');
      const started = tryStartScoutSystem();
      if (started) {
        console.log('[ScoutSystem] ✓ Hot start successful!');
      }
    }
  });
}

// Legacy wrapper for existing code
function startScoutSystem() {
  scoutStartAttempted = true;
  tryStartScoutSystem();
}

// =============================================================================
// STARTUP SEQUENCE
// =============================================================================

async function startup() {
  console.log('='.repeat(60));
  if (config.devMode) {
    console.log('🔧 Prism Server Starting... [DEV MODE]');
    console.log(`   Port: ${config.port} (fixed dev port)`);
    console.log('   Hot reload: enabled (use bun --watch)');
  } else {
  console.log('Prism Server Starting...');
  }
  console.log('='.repeat(60));
  
  // ---------------------------------------------
  // Step 1: Initialize Database (with migrations)
  // ---------------------------------------------
  console.log('\n[Startup] Step 1: Database initialization');
  try {
initDB(config.dbPath);
    console.log(`[Startup] Database ready at: ${config.dbPath}`);
    console.log(`[Startup] Database version: ${getCurrentDBVersion()}`);
  } catch (error) {
    console.error('[Startup] FATAL: Database initialization failed');
    console.error(error);
    process.exit(1);
  }
  
  // ---------------------------------------------
  // Step 1.5: Sync ECS Tables (entity_profiles, entity_physics)
  // ---------------------------------------------
  try {
    const db = getDB();
    const entitiesCount = (db.query('SELECT COUNT(*) as count FROM entities').get() as { count: number }).count;
    const profilesCount = (db.query('SELECT COUNT(*) as count FROM entity_profiles').get() as { count: number }).count;
    const physicsCount = (db.query('SELECT COUNT(*) as count FROM entity_physics').get() as { count: number }).count;

    // Sync if ECS tables are out of sync with entities table
    if (entitiesCount > 0 && (profilesCount < entitiesCount || physicsCount < entitiesCount)) {
      console.log(`[Startup] Step 1.6: Syncing ECS tables (entities: ${entitiesCount}, profiles: ${profilesCount}, physics: ${physicsCount})`);
      
      // Sync entity_profiles
      db.exec(`
        INSERT OR IGNORE INTO entity_profiles (id, type, title, subtitle, body, tag, action, created_at, updated_at, last_scouted_at)
        SELECT 
          id, 
          substr(id, 1, instr(id, ':') - 1),
          title, subtitle, body, tag, action, created_at, updated_at, last_scouted_at
        FROM entities
      `);

      // Sync entity_physics (unified physics table)
      db.exec(`
        INSERT OR IGNORE INTO entity_physics (entity_id, gravity, base_mass)
        SELECT id, COALESCE(base_gravity, 0.5), COALESCE(base_gravity, 0.5) FROM entities
      `);

      const newProfilesCount = (db.query('SELECT COUNT(*) as count FROM entity_profiles').get() as { count: number }).count;
      const newPhysicsCount = (db.query('SELECT COUNT(*) as count FROM entity_physics').get() as { count: number }).count;
      console.log(`[Startup] ECS tables synced: profiles=${newProfilesCount}, physics=${newPhysicsCount}`);
    }
  } catch (error) {
    console.warn('[Startup] ECS sync failed (non-critical):', error);
  }
  
  // ---------------------------------------------
  // Step 2: Health Check
  // ---------------------------------------------
  console.log('\n[Startup] Step 2: Health check');
  const db = getDB();
  const healthReport = runHealthCheck(db);
  
  if (!healthReport.healthy) {
    console.warn('[Startup] Database health issues detected');
  }
  
  // Log stats
  console.log(`[Startup] Stats: ${healthReport.stats.totalEntities} entities, ${healthReport.stats.totalMemories} memories, ${healthReport.stats.staleEntities} stale`);
  
  // ---------------------------------------------
  // Step 3: Self-Heal (if needed)
  // ---------------------------------------------
  if (healthReport.issues.filter(i => i.autoFixable).length > 0) {
    console.log('\n[Startup] Step 3: Self-healing');
    const healResult = selfHeal(db, healthReport);
    
    if (healResult.failed.length > 0) {
      console.warn(`[Startup] Some issues could not be fixed: ${healResult.failed.join(', ')}`);
    }
  } else {
    console.log('\n[Startup] Step 3: Self-healing (skipped - no issues)');
  }
  
  // ---------------------------------------------
  // Step 4: Pipeline Version Check
  // ---------------------------------------------
  console.log('\n[Startup] Step 4: Pipeline version check');
  const pipelineCheck = checkPipelineVersionMismatch();
  console.log(`[Startup] Current pipeline version: ${getExtractionVersion()}`);
  
  if (pipelineCheck.hasMismatch) {
    console.log(`[Startup] Found ${pipelineCheck.outdatedCount} entities with outdated pipeline version`);
    const marked = markOutdatedEntitiesStale();
    console.log(`[Startup] Marked ${marked} entities for lazy re-extraction`);
  } else {
    console.log('[Startup] All entities are up to date');
  }
  
  // ---------------------------------------------
  // Step 4.5: Load AI Keys from shared config
  // ---------------------------------------------
  console.log('\n[Startup] Step 4.5: Loading AI service keys');
  loadSharedConfig();  // Load from ~/.magpie/prism-config.json
  logAIServicesStatus();

  // ---------------------------------------------
  // Step 5: Initialize Settings
  // ---------------------------------------------
  console.log('\n[Startup] Step 5: Loading feature flags');
  initFeatureFlags();
  
  // ---------------------------------------------
  // Step 6: Start Server
  // ---------------------------------------------
  console.log('\n[Startup] Step 6: Starting HTTP server');
const app = build();

app.listen({ port: config.port, host: config.host }, (err, address) => {
  if (err) {
      console.error('[Startup] FATAL: Server failed to start');
    console.error(err);
    process.exit(1);
  }
    
    console.log(`[Startup] Server listening at ${address}`);
    
    // ---------------------------------------------
    // Step 7: Start Background Worker
    // ---------------------------------------------
    console.log('\n[Startup] Step 7: Starting background worker');
    startBackgroundWorker();
    
    // Log final status
    const workerStatus = getWorkerStatus();
    console.log(`[Startup] Background worker: ${workerStatus.isRunning ? 'running' : 'stopped'}`);
    console.log(`[Startup] Pending lazy migrations: ${workerStatus.pendingCount}`);
    
    // ---------------------------------------------
    // Step 7.5: Initialize Durable Task Queue (liteque)
    // ---------------------------------------------
    console.log('\n[Startup] Step 7.5: Initializing durable task queue');
    (async () => {
      try {
        // Queue database lives alongside main database
        const queueDbPath = join(dirname(config.dbPath), 'prism-queue.db');
        await initQueueSystem(queueDbPath);
        console.log(`[Startup] Queue database: ${queueDbPath}`);
        
        // Recover pending tasks from previous crash
        console.log('[Startup] Checking for pending tasks to recover...');
        const recovery = await runStartupRecovery();
        if (recovery.extractions > 0 || recovery.scouts > 0) {
          console.log(`[Startup] Recovered: ${recovery.extractions} extractions, ${recovery.scouts} scouts`);
        } else {
          console.log('[Startup] No pending tasks to recover');
        }
      } catch (error) {
        console.error('[Startup] ⚠️  Queue initialization failed (non-fatal):', error);
        console.log('[Startup] Background tasks will use legacy system');
      }
    })();
    
    // ---------------------------------------------
    // Step 8: Start ECS Scout System (replaces Legacy Patrol)
    // ---------------------------------------------
    console.log('\n[Startup] Step 8: Starting ECS Scout System');
    // Register hot-start callback for when keys are configured via API
    registerScoutHotStart();
    // Try to start now if keys are already available (e.g., from env vars)
    startScoutSystem();

    // ---------------------------------------------
    // Step 8.5: Start Ripple System (Entity Lifecycle Hooks + Passive Tick)
    // ---------------------------------------------
    console.log('\n[Startup] Step 8.5: Starting Ripple System');
    
    // Register Entity Lifecycle Hooks (primary trigger mechanism)
    rippleSystem.registerHooks();
    console.log('[RippleSystem] ✓ Entity Lifecycle Hooks registered');
    
    // Setup passive tick for catch-up
    if (isSearchAvailable()) {
      const RIPPLE_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
      setInterval(async () => {
        try {
          await rippleSystem.tick();
        } catch (err: any) {
          console.error('[RippleSystem] Error in tick:', err.message);
        }
      }, RIPPLE_INTERVAL_MS);
      console.log(`[RippleSystem] Scheduled: tick every ${RIPPLE_INTERVAL_MS / 1000}s`);
      console.log('[RippleSystem] Policy: G>0.5 + never rippled OR G>0.7 + 7d stale');
    } else {
      console.log('[RippleSystem] ⚠️  No search provider. Passive tick disabled (will use hooks only).');
    }

    // ---------------------------------------------
    // Step 9: Start Gardener Service (Governance)
    // ---------------------------------------------
    console.log('\n[Startup] Step 9: Starting Gardener Service');
    // Curator now supports hot-start via isOpenAIAvailable() (runtime keys + proxy)
    if (isOpenAIAvailable()) {
      startCuratorService();
    } else {
      console.log('[Startup] ⚠️  OpenAI not available. Gardener Service skipped (will hot-start when keys configured).');
    }

    console.log('\n' + '='.repeat(60));
    console.log('Prism Server Ready');
    console.log('='.repeat(60) + '\n');
  });
}

// Run startup
startup().catch((error) => {
  console.error('[Startup] Unhandled error during startup');
  console.error(error);
  process.exit(1);
});
