/**
 * Prism Architecture Configuration (SSOT)
 * 
 * Central registry for module boundaries and DAL rules.
 * 
 * @ref architecture/module-registry
 * @doc docs/ARCHITECTURE.md
 * @since 2026-01-09
 * 
 * This file is consumed by:
 * - eslint.config.js (DAL boundary enforcement)
 * - docs/CODE-DOC-SYNC.md (reference validation)
 * - Future: Architecture visualization tools
 */

// =============================================================================
// LAYER DEFINITIONS
// =============================================================================

export type LayerId = 
  | 'L0'           // Database Layer
  | 'L1'           // Graph Link (DAL)
  | 'L1_CORE'      // Core encapsulated functions
  | 'L0_INFRA'     // Infrastructure subsystems
  | 'L1_5'         // Queue system
  | 'L2_AGENT'     // Intelligence agents
  | 'L2_SYSTEM'    // System classes
  | 'L3_API'       // REST/MCP interface
  | 'L3_CLI'       // CLI tools
  | 'UTILITY'      // Standalone utilities
  | 'MIGRATION'    // Schema migrations
  | 'TEST';        // Test files

export interface ModuleConfig {
  /** Human-readable name */
  name: string;
  /** Description of module responsibility */
  description: string;
  /** Path patterns (glob-like, converted to RegExp) */
  paths: string[];
  /** Whether direct getDB() access is allowed */
  allowDirectDb: boolean;
  /** Reference to documentation */
  docRef?: string;
  /** Technical debt notes */
  techDebt?: string;
}

// =============================================================================
// MODULE REGISTRY
// =============================================================================

export const MODULES: Record<LayerId, ModuleConfig> = {
  // ---------------------------------------------------------------------------
  // L0: Database Layer (Internal)
  // ---------------------------------------------------------------------------
  L0: {
    name: 'Database Layer',
    description: 'SQLite connection and raw DB access',
    paths: ['src/db.ts'],
    allowDirectDb: true,
    docRef: 'ARCHITECTURE.md#2.1',
  },

  // ---------------------------------------------------------------------------
  // L1: Graph Link Layer (DAL Internals)
  // ---------------------------------------------------------------------------
  L1: {
    name: 'Graph Link Layer',
    description: 'GraphReader/Writer internals - the official DAL',
    paths: [
      'src/lib/graph-link/**',
      'src/lib/source-manager.ts',
    ],
    allowDirectDb: true,
    docRef: 'ARCHITECTURE.md#2.2',
  },

  // ---------------------------------------------------------------------------
  // L1_CORE: Core Encapsulated Functions
  // ---------------------------------------------------------------------------
  L1_CORE: {
    name: 'Core Functions',
    description: 'Encapsulated business logic functions',
    paths: [
      'src/recall.ts',
      'src/recommend.ts',
      'src/ingest.ts',
      'src/health-check.ts',
    ],
    allowDirectDb: true,
    docRef: 'CODE-DOC-SYNC.md#21',
    techDebt: 'Consider migrating to GraphReader methods',
  },

  // ---------------------------------------------------------------------------
  // L0_INFRA: Infrastructure Subsystems
  // ---------------------------------------------------------------------------
  L0_INFRA: {
    name: 'Infrastructure',
    description: 'Independent subsystems with their own data needs',
    paths: [
      'src/feature-flags.ts',
      'src/settings.ts',
      'src/pipeline-version.ts',
      'src/server.ts',
      'src/lib/agent-logger.ts',
      'src/lib/search-logger.ts',
    ],
    allowDirectDb: true,
    docRef: 'ARCHITECTURE.md#2.4',
  },

  // ---------------------------------------------------------------------------
  // L1.5: Queue System
  // ---------------------------------------------------------------------------
  L1_5: {
    name: 'Queue System',
    description: 'Durable task queue (liteque-based)',
    paths: ['src/lib/queue/**'],
    allowDirectDb: true,
    docRef: 'CODE-DOC-SYNC.md#15',
  },

  // ---------------------------------------------------------------------------
  // L2: Intelligence Agents
  // ---------------------------------------------------------------------------
  L2_AGENT: {
    name: 'Intelligence Agents',
    description: 'Scout, Ripple, Curator, Explorer agents',
    paths: [
      'src/lib/agents/**',
      'src/lib/ripple/**',
      'src/lib/deep-explorer/**',
      'src/lib/data-gap/**',
      'src/lib/storytelling/**',
    ],
    allowDirectDb: true, // TODO: Phase 5b - refactor to use GraphReader
    techDebt: 'Phase 5b: Refactor to use GraphReader/Writer',
    docRef: 'ARCHITECTURE.md#2.3',
  },

  // ---------------------------------------------------------------------------
  // L2: System Classes
  // ---------------------------------------------------------------------------
  L2_SYSTEM: {
    name: 'System Classes',
    description: 'PhysicsSystem, ScoutSystem, RippleSystem',
    paths: ['src/systems/**'],
    allowDirectDb: true, // TODO: Phase 5b
    techDebt: 'Phase 5b: Refactor to use GraphReader',
    docRef: 'ARCHITECTURE.md#2.2',
  },

  // ---------------------------------------------------------------------------
  // L3: API Layer
  // ---------------------------------------------------------------------------
  L3_API: {
    name: 'API Layer',
    description: 'REST API and MCP tools',
    paths: [
      'src/app.ts',
      'src/pages.ts',
      'src/navigation.ts',
      'src/ask.ts',
      'src/extract.ts',
      'src/mcp/**',
    ],
    allowDirectDb: true, // TODO: Phase 5c
    techDebt: 'Phase 5c: Refactor REST endpoints to use GraphReader',
    docRef: 'ARCHITECTURE.md#2.4',
  },

  // ---------------------------------------------------------------------------
  // L3: CLI Tools
  // ---------------------------------------------------------------------------
  L3_CLI: {
    name: 'CLI Tools',
    description: 'One-time operation scripts',
    paths: ['src/cli/**'],
    allowDirectDb: true,
    docRef: 'ARCHITECTURE.md#2.4',
  },

  // ---------------------------------------------------------------------------
  // Utility Modules
  // ---------------------------------------------------------------------------
  UTILITY: {
    name: 'Utility Modules',
    description: 'Standalone utilities with specific data needs',
    paths: [
      'src/graph.ts',
      'src/public-content.ts',
      'src/background-worker.ts',
    ],
    allowDirectDb: true,
    techDebt: 'Consider consolidating into GraphReader',
  },

  // ---------------------------------------------------------------------------
  // Migrations
  // ---------------------------------------------------------------------------
  MIGRATION: {
    name: 'Migrations',
    description: 'Database schema migrations',
    paths: ['src/migrations/**'],
    allowDirectDb: true,
  },

  // ---------------------------------------------------------------------------
  // Tests
  // ---------------------------------------------------------------------------
  TEST: {
    name: 'Tests',
    description: 'Test files',
    paths: [
      '**/*.test.ts',
      '**/tests/**',
    ],
    allowDirectDb: true,
  },
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Convert glob-like path to RegExp
 * 
 * @example
 * pathToRegex('src/lib/graph-link/**') => /\/lib\/graph-link\//
 * pathToRegex('src/db.ts') => /\/db\.ts$/
 */
export function pathToRegex(path: string): RegExp {
  // Handle ** (any directory depth)
  if (path.endsWith('/**')) {
    const base = path.slice(0, -3).replace(/\//g, '\\/');
    return new RegExp(base.replace(/^src/, '') + '\\/');
  }
  
  // Handle specific file
  if (path.endsWith('.ts')) {
    const escaped = path.replace(/\./g, '\\.').replace(/\//g, '\\/');
    return new RegExp(escaped.replace(/^src/, '') + '$');
  }
  
  // Handle directory
  const escaped = path.replace(/\./g, '\\.').replace(/\//g, '\\/');
  return new RegExp(escaped.replace(/^src/, ''));
}

/**
 * Get all path patterns that allow direct DB access
 */
export function getAllowedDbPatterns(): RegExp[] {
  const patterns: RegExp[] = [];
  
  for (const module of Object.values(MODULES)) {
    if (module.allowDirectDb) {
      for (const path of module.paths) {
        patterns.push(pathToRegex(path));
      }
    }
  }
  
  return patterns;
}

/**
 * Check if a file path is allowed to use direct DB access
 */
export function isDbAccessAllowed(filePath: string): boolean {
  const patterns = getAllowedDbPatterns();
  return patterns.some(pattern => pattern.test(filePath));
}

/**
 * Get modules with tech debt
 */
export function getModulesWithTechDebt(): Array<{ id: LayerId; module: ModuleConfig }> {
  return Object.entries(MODULES)
    .filter(([_, module]) => module.techDebt)
    .map(([id, module]) => ({ id: id as LayerId, module }));
}

/**
 * Generate markdown summary for documentation
 */
export function generateArchitectureSummary(): string {
  let md = '## Module Registry\n\n';
  md += '| Layer | Name | Paths | Direct DB | Tech Debt |\n';
  md += '|-------|------|-------|-----------|----------|\n';
  
  for (const [id, module] of Object.entries(MODULES)) {
    const paths = module.paths.slice(0, 2).join(', ') + (module.paths.length > 2 ? '...' : '');
    const techDebt = module.techDebt ? '⚠️' : '✅';
    md += `| ${id} | ${module.name} | \`${paths}\` | ${module.allowDirectDb ? 'Yes' : 'No'} | ${techDebt} |\n`;
  }
  
  return md;
}
