/**
 * HTTP-based Prism Client
 *
 * Phase 0.5 implementation: communicates with remote prism-server via HTTP API
 */

import type { IPrismClient } from './interface';
import type { ExploreResult, ExploreLog, TrendingWord } from './types';

export interface HttpPrismClientOptions {
  /** Base URL for the Prism API */
  baseUrl: string;

  /** Credentials mode for fetch requests (default: 'include' for cookies) */
  credentials?: RequestCredentials;

  /** Custom fetch function (useful for testing) */
  fetch?: typeof fetch;
}

export class HttpPrismClient implements IPrismClient {
  private baseUrl: string;
  private credentials: RequestCredentials;
  private fetchFn: typeof fetch;

  constructor(options: HttpPrismClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.credentials = options.credentials ?? 'include';
    // Bind fetch to globalThis to avoid "Illegal invocation" error
    this.fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async explore(word: string, guestId?: string): Promise<ExploreResult> {
    const res = await this.fetchFn(`${this.baseUrl}/explore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        word: word.trim(),
        guest_id: guestId,
      }),
      credentials: this.credentials,
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => 'Unknown error');
      throw new PrismClientError(`Explore failed: ${res.status}`, res.status, errorText);
    }

    return res.json();
  }

  async getExploreHistory(limit = 50): Promise<ExploreLog[]> {
    const res = await this.fetchFn(`${this.baseUrl}/explore/history?limit=${limit}`, {
      method: 'GET',
      credentials: this.credentials,
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => 'Unknown error');
      throw new PrismClientError(`Get history failed: ${res.status}`, res.status, errorText);
    }

    return res.json();
  }

  async getTrending(limit = 10): Promise<TrendingWord[]> {
    const res = await this.fetchFn(`${this.baseUrl}/explore/trending?limit=${limit}`, {
      method: 'GET',
      credentials: this.credentials,
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => 'Unknown error');
      throw new PrismClientError(`Get trending failed: ${res.status}`, res.status, errorText);
    }

    return res.json();
  }
}

/**
 * Custom error class for Prism client errors
 */
export class PrismClientError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public responseBody: string
  ) {
    super(message);
    this.name = 'PrismClientError';
  }
}

