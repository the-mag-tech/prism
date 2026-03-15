/**
 * Minimal type declarations for bun:sqlite
 * These are just stubs for tsc - actual implementation is provided by Bun runtime
 * 
 * Note: Using `any` return types for compatibility with existing code
 * that uses direct type assertions after query results.
 */

declare module 'bun:sqlite' {
  export interface RunResult {
    changes: number;
    lastInsertRowid: number;
  }

  export class Statement {
    run(...params: unknown[]): RunResult;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get(...params: unknown[]): any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    all(...params: unknown[]): any[];
    values(...params: unknown[]): unknown[][];
  }

  export class Database {
    constructor(filename: string);
    query(sql: string): Statement;
    prepare(sql: string): Statement;
    run(sql: string, ...params: unknown[]): RunResult;
    exec(sql: string): void;
    transaction<T>(fn: () => T): () => T;
    close(): void;
  }
}

