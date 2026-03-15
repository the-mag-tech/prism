/**
 * @module logger
 * @description Environment-aware logger that handles MCP stdio constraints
 * 
 * @ref infra/logger
 * @doc docs/CODE-DOC-SYNC.md#logger-module
 * @since 2025-12-21
 * 
 * Problem: MCP stdio mode uses stdout exclusively for JSON-RPC.
 *          Any console.log() pollutes the protocol and breaks parsing.
 * 
 * Solution: Detect runtime mode and route logs appropriately:
 *   - MCP Mode: All logs → stderr (safe, won't pollute JSON-RPC)
 *   - HTTP Mode: Normal console.log/error behavior
 * 
 * Usage:
 * ```typescript
 * import { log, logError, logWarn } from './logger.js';
 * 
 * log('Info message');      // stdout in HTTP mode, stderr in MCP mode
 * logWarn('Warning');       // always stderr
 * logError('Error');        // always stderr
 * ```
 */

// Detect MCP mode: set by prism-mcp-bin entry point
let _isMcpMode = false;

/**
 * Enable MCP mode - all logs will go to stderr
 * Called by mcp/index.ts on startup
 */
export function enableMcpMode(): void {
    _isMcpMode = true;
}

/**
 * Check if running in MCP mode
 */
export function isMcpMode(): boolean {
    return _isMcpMode;
}

/**
 * Log info message
 * - MCP mode: stderr (to avoid polluting JSON-RPC stdout)
 * - HTTP mode: stdout (normal behavior)
 */
export function log(...args: unknown[]): void {
    if (_isMcpMode) {
        console.error(...args);
    } else {
        console.log(...args);
    }
}

/**
 * Log warning message (always stderr)
 */
export function logWarn(...args: unknown[]): void {
    console.error(...args);
}

/**
 * Log error message (always stderr)
 */
export function logError(...args: unknown[]): void {
    console.error(...args);
}

/**
 * Create a prefixed logger for a module
 * 
 * @example
 * const logger = createLogger('[AI-Clients]');
 * logger.log('Initialized');  // "[AI-Clients] Initialized"
 * logger.error('Failed');     // "[AI-Clients] Failed"
 */
export function createLogger(prefix: string) {
    return {
        log: (...args: unknown[]) => log(prefix, ...args),
        warn: (...args: unknown[]) => logWarn(prefix, ...args),
        error: (...args: unknown[]) => logError(prefix, ...args),
    };
}

