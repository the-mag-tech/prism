/**
 * Local Prism Client (Stub for Phase 1)
 *
 * Phase 1 will implement: use wa-sqlite to run Prism locally in the browser
 *
 * This stub exists to:
 * 1. Define the interface contract
 * 2. Allow code to reference LocalPrismClient without build errors
 * 3. Provide clear error messages during Phase 0.5
 */

import type { IPrismClient } from './interface';
import type { ExploreResult, ExploreLog, TrendingWord } from './types';

export class LocalPrismClient implements IPrismClient {
  constructor() {
    // Phase 1: Initialize wa-sqlite here
    // this.core = new PrismCore({ database: 'wasm' });
  }

  async explore(_word: string, _guestId?: string): Promise<ExploreResult> {
    throw new LocalPrismNotImplementedError(
      'LocalPrismClient.explore() is not implemented yet. ' +
        'This will be available in Phase 1 with browser-side wa-sqlite. ' +
        'Please use HttpPrismClient for now.'
    );
  }

  async getExploreHistory(_limit?: number): Promise<ExploreLog[]> {
    throw new LocalPrismNotImplementedError(
      'LocalPrismClient.getExploreHistory() is not implemented yet. ' +
        'Please use HttpPrismClient for now.'
    );
  }

  async getTrending(_limit?: number): Promise<TrendingWord[]> {
    throw new LocalPrismNotImplementedError(
      'LocalPrismClient.getTrending() is not implemented yet. ' +
        'Please use HttpPrismClient for now.'
    );
  }
}

/**
 * Error thrown when LocalPrismClient methods are called before Phase 1 implementation
 */
export class LocalPrismNotImplementedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LocalPrismNotImplementedError';
  }
}

/**
 * Check if the browser supports local Prism (OPFS + SharedArrayBuffer)
 *
 * Phase 1 will use this to determine if LocalPrismClient can be used.
 */
export function canUseLocalPrism(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  // OPFS check (required for persistent SQLite storage)
  if (!('storage' in navigator)) return false;
  if (!('getDirectory' in navigator.storage)) return false;

  // SharedArrayBuffer check (required for wa-sqlite performance)
  if (typeof SharedArrayBuffer === 'undefined') return false;

  // Cross-origin isolation check (required for SharedArrayBuffer)
  if (!crossOriginIsolated) return false;

  return true;
}


