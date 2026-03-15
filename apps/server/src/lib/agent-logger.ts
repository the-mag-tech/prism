/**
 * AgentLogger - Unified logging for all agent operations
 * 
 * @ref infra/agent-logger
 * @doc docs/WORKER-CHECKLIST.md#1-日志与错误处理
 * @since 2025-12-24 v2: Added log() method
 * 
 * Provides structured logging to both console (stderr) and database.
 * All agent operations should use this for consistent tracking.
 * 
 * Usage:
 * ```typescript
 * const logger = new AgentLogger('deep_explorer');
 * const handle = logger.start('explore', { query: 'test' }, 'session-123');
 * try {
 *   const result = await doSomething();
 *   handle.success({ findings: result.length });
 * } catch (e) {
 *   handle.error(e);  // Persisted to agent_logs table
 * }
 * 
 * // Simple logging (v2)
 * logger.log('message', { data: 'value' });
 * ```
 */

import { getDB } from '../db.js';
import { randomUUID } from 'crypto';

export type AgentType = 'scout' | 'curator' | 'deep_explorer' | 'graph_link' | 'mcp' | 'serendipity' | 'extraction' | 'vm';
export type LogStatus = 'ok' | 'error' | 'timeout' | 'skipped';

export interface AgentLogEntry {
  id?: number;
  agent: AgentType;
  action: string;
  entity_id?: string;
  session_id?: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  duration_ms?: number;
  tokens_used?: number;
  status: LogStatus;
  error?: string;
  created_at?: string;
}

/**
 * Active log handle for tracking an operation
 */
export class AgentLogHandle {
  private startTime: number;
  private saved = false;

  constructor(
    private agent: AgentType,
    private action: string,
    private input: Record<string, unknown>,
    private sessionId?: string,
    private entityId?: string,
  ) {
    this.startTime = Date.now();
    console.error(`[${agent}] ▶ ${action}`, this.formatInput(input));
  }

  private formatInput(input: Record<string, unknown>): string {
    const keys = Object.keys(input);
    if (keys.length === 0) return '';
    if (keys.length === 1 && typeof input[keys[0]] === 'string') {
      const val = input[keys[0]] as string;
      return val.length > 50 ? `"${val.substring(0, 50)}..."` : `"${val}"`;
    }
    return JSON.stringify(input).substring(0, 100);
  }

  /**
   * Mark operation as successful and save to database
   */
  success(output?: Record<string, unknown>, tokensUsed?: number): void {
    if (this.saved) return;
    this.saved = true;

    const duration = Date.now() - this.startTime;
    console.error(`[${this.agent}] ✓ ${this.action} (${duration}ms)`);

    this.saveToDb({
      agent: this.agent,
      action: this.action,
      entity_id: this.entityId,
      session_id: this.sessionId,
      input: this.input,
      output,
      duration_ms: duration,
      tokens_used: tokensUsed,
      status: 'ok',
    });
  }

  /**
   * Mark operation as failed and save to database
   */
  error(err: unknown): void {
    if (this.saved) return;
    this.saved = true;

    const duration = Date.now() - this.startTime;
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[${this.agent}] ✗ ${this.action} failed: ${errorMsg} (${duration}ms)`);

    this.saveToDb({
      agent: this.agent,
      action: this.action,
      entity_id: this.entityId,
      session_id: this.sessionId,
      input: this.input,
      duration_ms: duration,
      status: 'error',
      error: errorMsg,
    });
  }

  /**
   * Mark operation as skipped (e.g., no work needed)
   */
  skip(reason?: string): void {
    if (this.saved) return;
    this.saved = true;

    const duration = Date.now() - this.startTime;
    console.error(`[${this.agent}] ○ ${this.action} skipped${reason ? `: ${reason}` : ''}`);

    this.saveToDb({
      agent: this.agent,
      action: this.action,
      entity_id: this.entityId,
      session_id: this.sessionId,
      input: this.input,
      duration_ms: duration,
      status: 'skipped',
      output: reason ? { reason } : undefined,
    });
  }

  /**
   * Mark operation as timed out
   */
  timeout(): void {
    if (this.saved) return;
    this.saved = true;

    const duration = Date.now() - this.startTime;
    console.error(`[${this.agent}] ⏱ ${this.action} timed out (${duration}ms)`);

    this.saveToDb({
      agent: this.agent,
      action: this.action,
      entity_id: this.entityId,
      session_id: this.sessionId,
      input: this.input,
      duration_ms: duration,
      status: 'timeout',
    });
  }

  private saveToDb(entry: AgentLogEntry): void {
    try {
      const db = getDB();
      db.query(`
        INSERT INTO agent_logs (agent, action, entity_id, session_id, input, output, duration_ms, tokens_used, status, error)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        entry.agent,
        entry.action,
        entry.entity_id ?? null,
        entry.session_id ?? null,
        entry.input ? JSON.stringify(entry.input) : null,
        entry.output ? JSON.stringify(entry.output) : null,
        entry.duration_ms ?? null,
        entry.tokens_used ?? null,
        entry.status,
        entry.error ?? null,
      );
    } catch (e) {
      // Don't let logging failures break the app
      console.error(`[AgentLogger] Failed to save log:`, e);
    }
  }
}

/**
 * Logger instance for a specific agent
 */
export class AgentLogger {
  constructor(private agent: AgentType) {}

  /**
   * Start tracking an operation (returns handle for success/error tracking)
   */
  start(
    action: string,
    input: Record<string, unknown> = {},
    sessionId?: string,
    entityId?: string,
  ): AgentLogHandle {
    return new AgentLogHandle(this.agent, action, input, sessionId, entityId);
  }

  /**
   * Simple log (for quick debug/info messages without tracking)
   * This prevents "logger.log is not a function" errors
   */
  log(message: string, data?: Record<string, unknown>): void {
    const dataStr = data ? ` ${JSON.stringify(data)}` : '';
    console.log(`[${this.agent}] ${message}${dataStr}`);
  }

  /**
   * Generate a new session ID
   */
  static newSessionId(): string {
    return randomUUID().substring(0, 8);
  }
}

// =============================================================================
// QUERY HELPERS
// =============================================================================

/**
 * Get recent agent logs
 */
export function getAgentLogs(options: {
  agent?: AgentType;
  action?: string;
  status?: LogStatus;
  limit?: number;
} = {}): AgentLogEntry[] {
  const db = getDB();
  const { agent, action, status, limit = 100 } = options;

  let sql = 'SELECT * FROM agent_logs WHERE 1=1';
  const params: unknown[] = [];

  if (agent) {
    sql += ' AND agent = ?';
    params.push(agent);
  }
  if (action) {
    sql += ' AND action = ?';
    params.push(action);
  }
  if (status) {
    sql += ' AND status = ?';
    params.push(status);
  }

  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);

  const rows = db.query(sql).all(...params) as AgentLogEntry[];
  
  return rows.map(row => ({
    ...row,
    input: row.input ? JSON.parse(row.input as unknown as string) : undefined,
    output: row.output ? JSON.parse(row.output as unknown as string) : undefined,
  }));
}

/**
 * Get agent statistics
 */
export function getAgentStats(agent?: AgentType): {
  total: number;
  success: number;
  errors: number;
  avgDuration: number;
  totalTokens: number;
} {
  const db = getDB();
  
  let sql = `
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END) as success,
      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as errors,
      AVG(duration_ms) as avg_duration,
      SUM(COALESCE(tokens_used, 0)) as total_tokens
    FROM agent_logs
  `;
  
  if (agent) {
    sql += ' WHERE agent = ?';
    const row = db.query(sql).get(agent) as any;
    return {
      total: row.total || 0,
      success: row.success || 0,
      errors: row.errors || 0,
      avgDuration: Math.round(row.avg_duration || 0),
      totalTokens: row.total_tokens || 0,
    };
  }

  const row = db.query(sql).get() as any;
  return {
    total: row.total || 0,
    success: row.success || 0,
    errors: row.errors || 0,
    avgDuration: Math.round(row.avg_duration || 0),
    totalTokens: row.total_tokens || 0,
  };
}







