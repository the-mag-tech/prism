/**
 * Prism Client Interface
 *
 * This interface is the key to smooth evolution:
 * - Phase 0.5: HttpPrismClient implementation
 * - Phase 1:   LocalPrismClient implementation (wa-sqlite)
 * - UI code only depends on this interface, switching implementation requires zero changes
 */

import type { ExploreResult, ExploreLog, TrendingWord } from './types';

export interface IPrismClient {
  // ============ Exploration ============

  /**
   * Adversarial exploration: multi-direction exploration + competitive scoring
   * @param word - The word/topic to explore
   * @param guestId - Optional guest ID for tracking
   */
  explore(word: string, guestId?: string): Promise<ExploreResult>;

  /**
   * Get the current user's exploration history
   * @param limit - Maximum number of entries to return (default: 50)
   */
  getExploreHistory(limit?: number): Promise<ExploreLog[]>;

  /**
   * Get trending exploration words
   * @param limit - Maximum number of entries to return (default: 10)
   */
  getTrending(limit?: number): Promise<TrendingWord[]>;

  // ============ Future: Entity ============
  // getEntity(id: string): Promise<Entity | null>;
  // searchEntities(query: string): Promise<Entity[]>;

  // ============ Future: Sync ============
  // sync(): Promise<SyncResult>;
  // exportData(): Promise<ExportPackage>;
  // importData(pkg: ExportPackage): Promise<void>;
}


