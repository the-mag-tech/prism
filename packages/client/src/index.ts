/**
 * @prism/client
 *
 * Client abstraction layer for Prism Server.
 *
 * Evolution strategy:
 * - Phase 0.5: Always returns HttpPrismClient
 * - Phase 1:   Detects browser capabilities, prefers LocalPrismClient
 *
 * Usage:
 * ```typescript
 * import { createPrismClient } from '@prism/client';
 *
 * const prism = createPrismClient({
 *   baseUrl: process.env.NEXT_PUBLIC_PRISM_API_URL,
 * });
 *
 * const result = await prism.explore('chaos monkey');
 * ```
 */

// Types
export type {
  ExploreResult,
  ExploreLog,
  TrendingWord,
  IronyLayer,
  Contender,
  CreatePrismClientOptions,
} from './types';

// Interface
export type { IPrismClient } from './interface';

// Implementations
export { HttpPrismClient, PrismClientError } from './http';
export type { HttpPrismClientOptions } from './http';

export { LocalPrismClient, LocalPrismNotImplementedError, canUseLocalPrism } from './local';

// Factory
import type { IPrismClient } from './interface';
import type { CreatePrismClientOptions } from './types';
import { HttpPrismClient } from './http';
// import { LocalPrismClient, canUseLocalPrism } from './local';

/**
 * Factory function to create appropriate Prism client
 *
 * Evolution strategy:
 * - Phase 0.5: Always returns HttpPrismClient
 * - Phase 1:   Checks browser capabilities, prefers LocalPrismClient if available
 *
 * @param options - Configuration options
 * @returns IPrismClient instance
 */
export function createPrismClient(options?: CreatePrismClientOptions): IPrismClient {
  const baseUrl = options?.baseUrl ?? process.env.NEXT_PUBLIC_PRISM_API_URL;

  if (!baseUrl) {
    throw new Error(
      'Prism API URL is required. ' +
        'Set NEXT_PUBLIC_PRISM_API_URL environment variable or pass baseUrl option.'
    );
  }

  // Phase 0.5: Always use HTTP
  //
  // Phase 1 TODO: Add browser capability detection here
  //
  // if (!options?.forceHttp && typeof window !== 'undefined') {
  //   if (canUseLocalPrism()) {
  //     return new LocalPrismClient();
  //   }
  // }

  return new HttpPrismClient({
    baseUrl,
    credentials: options?.credentials ?? 'include',
  });
}

/**
 * Re-export for convenience
 */
export default createPrismClient;


