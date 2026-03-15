/**
 * ESLint Configuration for Prism Server
 * 
 * Primary purpose: Enforce Data Access Layer boundaries
 * 
 * @ref dal/lint-rules
 * @since 2026-01-09
 * 
 * IMPORTANT: This config reads from architecture.config.ts
 * Any module boundary changes should be made there, not here.
 */

import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

// =============================================================================
// ARCHITECTURE CONFIGURATION (from architecture.config.ts)
// =============================================================================

// Note: We inline the patterns here because ESLint config can't use async imports
// Keep in sync with src/architecture.config.ts
// 
// @ref architecture/module-registry
// @sync-check: scripts/check-architecture-sync.sh (TODO)

const ALLOWED_DB_PATTERNS = [
  // L0: Database Layer
  /\/db\.ts$/,
  
  // L1: Graph Link Layer (DAL internals)
  /\/graph-link\//,
  /\/source-manager\.ts$/,
  
  // L1_CORE: Core encapsulated functions
  /\/recall\.ts$/,
  /\/recommend\.ts$/,
  /\/ingest\.ts$/,
  /\/health-check\.ts$/,
  
  // L0_INFRA: Infrastructure subsystems
  /\/feature-flags\.ts$/,
  /\/settings\.ts$/,
  /\/pipeline-version\.ts$/,
  /\/server\.ts$/,
  /\/agent-logger\.ts$/,
  /\/search-logger\.ts$/,
  
  // L1.5: Queue system
  /\/queue\//,
  
  // L2: Intelligence agents (Phase 5b tech debt)
  /\/agents\//,
  /\/ripple\//,
  /\/deep-explorer\//,
  /\/data-gap\//,
  /\/storytelling\//,
  
  // L2: System classes (Phase 5b tech debt)
  /\/systems\//,
  
  // L3: API layer (Phase 5c tech debt)
  /\/app\.ts$/,
  /\/pages\.ts$/,
  /\/navigation\.ts$/,
  /\/ask\.ts$/,
  /\/extract\.ts$/,
  /\/mcp\//,
  
  // L3: CLI tools
  /\/cli\//,
  
  // Utility modules
  /\/graph\.ts$/,
  /\/public-content\.ts$/,
  /\/background-worker\.ts$/,
  
  // Migrations
  /\/migrations\//,
  
  // Tests
  /\.test\.ts$/,
  /\/tests\//,
];

// =============================================================================
// CUSTOM RULE: no-direct-db-access
// =============================================================================

/**
 * Custom rule: no-direct-db-access
 * 
 * Warns when getDB() is imported outside of allowed modules.
 * This enforces the DAL architecture where only specific layers
 * should directly access the database.
 * 
 * Configuration is driven by architecture.config.ts patterns.
 */
const noDirectDbAccessRule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Disallow direct database access outside DAL layer',
      recommended: 'warn',
    },
    messages: {
      avoidDirectDb: 
        'Avoid direct getDB() usage. Use GraphReader/Writer or source-manager instead. ' +
        'See docs/CODE-DOC-SYNC.md#21-data-access-layer. ' +
        'If this module needs DB access, add it to src/architecture.config.ts',
    },
    schema: [],
  },
  create(context) {
    const filename = context.getFilename();
    
    // Check if file is in allowed list (from architecture.config.ts)
    if (ALLOWED_DB_PATTERNS.some(pattern => pattern.test(filename))) {
      return {};
    }

    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        if (typeof source === 'string' && source.includes('/db')) {
          for (const specifier of node.specifiers) {
            if (
              specifier.type === 'ImportSpecifier' &&
              specifier.imported.name === 'getDB'
            ) {
              context.report({
                node: specifier,
                messageId: 'avoidDirectDb',
              });
            }
          }
        }
      },
    };
  },
};

// =============================================================================
// PLUGIN & EXPORT
// =============================================================================

const dalPlugin = {
  rules: {
    'no-direct-db-access': noDirectDbAccessRule,
  },
};

export default [
  {
    files: ['src/**/*.ts'],
    ignores: [
      'src/migrations/**',
      'src/cli/**',
      '**/*.test.ts',
      '**/tests/**',
      'src/architecture.config.ts', // Meta-config file
    ],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      'dal': dalPlugin,
    },
    rules: {
      // DAL enforcement - WARN for now, upgrade to ERROR in Phase 5d
      'dal/no-direct-db-access': 'warn',
    },
  },
];
