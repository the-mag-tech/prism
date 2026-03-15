import dotenv from 'dotenv';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { fileURLToPath } from 'url';

// =============================================================================
// ENV LOADING: Local First, then Monorepo Root
// =============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Prism Server root (apps/prism-server)
const prismRoot = path.resolve(__dirname, '..');

// Monorepo root (fulmail)
const monorepoRoot = path.resolve(prismRoot, '../..');

// Priority: local .env > monorepo root .env
const localEnvPath = path.join(prismRoot, '.env');
const rootEnvPath = path.join(monorepoRoot, '.env');
const cwdEnvPath = path.join(process.cwd(), '.env');

if (fs.existsSync(localEnvPath)) {
  dotenv.config({ path: localEnvPath });
  // console.log(`[Config] Loaded .env from: ${localEnvPath}`);
} else if (fs.existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath });
  // console.log(`[Config] Loaded .env from: ${rootEnvPath}`);
} else if (fs.existsSync(cwdEnvPath)) {
  dotenv.config({ path: cwdEnvPath });
  // console.log(`[Config] Loaded .env from: ${cwdEnvPath}`);
} else {
  // console.log(`[Config] No .env found, using environment variables only`);
}

// =============================================================================
// DEV MODE DETECTION
// =============================================================================

/**
 * Development mode flag
 * 
 * When DEV_MODE=true:
 * - Uses fixed port 3006 (instead of username-based port)
 * - Easier to connect from frontend dev server
 * - No conflict with Tauri-bundled binary
 * 
 * 端口规范文档: packages/ports/README.md
 */
const DEV_MODE = process.env.DEV_MODE === 'true';

/**
 * Development port (fixed, easy to remember)
 * 
 * 端口分配:
 * - Prism Server: 3006
 * - Magpie Frontend: 4006
 * 
 * @see packages/ports/README.md
 */
const DEV_PORT = 3006;

// =============================================================================
// PORT CALCULATION
// =============================================================================

/**
 * Generate a deterministic port based on username
 * Range: 49152-65535 (IANA dynamic/private ports)
 * Same user always gets same port, different users get different ports
 */
function getUserPort(): number {
  const username = os.userInfo().username;
  // Simple hash function
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    const char = username.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  // Map to port range 49152-65535 (16383 ports)
  const port = 49152 + (Math.abs(hash) % 16383);
  return port;
}

// Default port based on mode
const DEFAULT_PORT = DEV_MODE ? DEV_PORT : getUserPort();

// =============================================================================
// DATABASE PATH DETECTION
// =============================================================================

/**
 * Tauri App identifier (must match tauri.conf.json)
 */
const TAURI_APP_IDENTIFIER = 'com.magpie.desktop';

/**
 * Get the Tauri App data directory based on platform
 * 
 * macOS: ~/Library/Application Support/{identifier}
 * Windows: %APPDATA%/{identifier}
 * Linux: ~/.local/share/{identifier}
 */
function getTauriAppDataDir(): string | null {
  const platform = os.platform();
  const homeDir = os.homedir();
  
  switch (platform) {
    case 'darwin':
      return path.join(homeDir, 'Library', 'Application Support', TAURI_APP_IDENTIFIER);
    case 'win32':
      return path.join(process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming'), TAURI_APP_IDENTIFIER);
    case 'linux':
      return path.join(homeDir, '.local', 'share', TAURI_APP_IDENTIFIER);
    default:
      return null;
  }
}

/**
 * Resolve database path with smart detection
 * 
 * Priority:
 * 1. PRISM_DB_PATH env (explicitly set by Tauri sidecar)
 * 2. Tauri App data directory (auto-detect)
 * 3. Current working directory (fallback for dev)
 */
function resolveDbPath(): string {
  // 1. Explicit env variable (Tauri sidecar sets this)
  if (process.env.PRISM_DB_PATH) {
    return process.env.PRISM_DB_PATH;
  }
  
  // 2. Auto-detect Tauri App data directory
  const tauriDataDir = getTauriAppDataDir();
  if (tauriDataDir) {
    const tauriDbPath = path.join(tauriDataDir, 'prism.db');
    if (fs.existsSync(tauriDbPath)) {
      console.error(`[Config] Auto-detected Tauri DB: ${tauriDbPath}`);
      return tauriDbPath;
    }
    // If Tauri data dir exists but no db, still use it (will be created)
    if (fs.existsSync(tauriDataDir)) {
      console.error(`[Config] Using Tauri data dir: ${tauriDbPath}`);
      return tauriDbPath;
    }
  }
  
  // 3. Fallback to current working directory (dev mode)
  return path.join(process.cwd(), 'prism.db');
}

// =============================================================================
// CONFIG EXPORT
// =============================================================================

export const config = {
  // Development mode flag
  devMode: DEV_MODE,
  
  // Port priority:
  // 1. PRISM_PORT - explicitly set by Tauri for sidecar mode
  // 2. PORT - for Railway/cloud deployment
  // 3. DEFAULT_PORT - calculated from username (production) or 3001 (dev)
  port: parseInt(process.env.PRISM_PORT || process.env.PORT || String(DEFAULT_PORT), 10),
  
  host: process.env.PRISM_HOST || '0.0.0.0',
  dbPath: resolveDbPath(),
  env: process.env.NODE_ENV || 'development'
};

// Export for other modules to use
export { getUserPort, DEFAULT_PORT, DEV_MODE, DEV_PORT };

