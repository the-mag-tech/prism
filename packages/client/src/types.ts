/**
 * Prism Client Types
 *
 * Shared types for all IPrismClient implementations.
 */

/**
 * Single layer in the irony pyramid
 */
export interface IronyLayer {
  level: number;
  description: string;
}

/**
 * A contender in the adversarial exploration
 */
export interface Contender {
  name: string;
  rank: number;
}

/**
 * Result of adversarial exploration
 */
export interface ExploreResult {
  word: string;
  winner: {
    name: string;
    score: number;
    ironyPyramid: IronyLayer[];
  };
  contenders: Contender[];
  explosivePoint: string;
  oneLiner: string;
  explorationId?: number;
}

/**
 * Historical exploration log entry
 */
export interface ExploreLog {
  id: number;
  word: string;
  winnerDirection: string;
  winnerScore: number;
  explosivePoint: string;
  oneLiner: string;
  createdAt: string;
}

/**
 * Trending exploration word
 */
export interface TrendingWord {
  word: string;
  count: number;
  lastExplored: string;
}

/**
 * Options for creating a Prism client
 */
export interface CreatePrismClientOptions {
  /** Base URL for HTTP client */
  baseUrl?: string;

  /** Force HTTP mode even if local is available */
  forceHttp?: boolean;

  /** Credentials mode for fetch requests */
  credentials?: RequestCredentials;

  /** Guest ID for tracking (optional, can use cookies) */
  guestId?: string;
}


