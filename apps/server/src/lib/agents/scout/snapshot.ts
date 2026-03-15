import { Readability } from '@mozilla/readability';
import { log, logError, logWarn } from '../../logger.js';
import DOMPurify from 'dompurify';
import { parseHTML } from 'linkedom';
import chardet from 'chardet';
import iconv from 'iconv-lite';

// =============================================================================
// TYPES
// =============================================================================

export interface SnapshotResult {
  url: string;
  title: string;
  content: string;  // HTML content
  textContent: string; // Plain text
  excerpt: string;
  byline: string;
  siteName: string;
  lang: string;
  capturedAt: string;
}

// =============================================================================
// HELPER: DECODE CHARS
// =============================================================================

/**
 * Decodes the response body, handling charset detection
 */
async function decodeResponseBody(res: Response): Promise<string> {
  const buffer = await res.arrayBuffer();
  const bufferObj = Buffer.from(buffer);

  // 1. Get charset from Content-Type
  const contentType = res.headers.get('content-type');
  let charset = contentType?.match(/charset=([\w-]+)/i)?.[1];

  // 2. Fallback to chardet
  if (!charset) {
    const detected = chardet.detect(bufferObj);
    if (detected) charset = detected.toString();
  }

  // 3. Default to utf-8
  if (!charset) charset = 'utf-8';

  // 4. Decode
  if (charset.toLowerCase() === 'utf-8') {
    return new TextDecoder('utf-8').decode(buffer);
  }

  // Use iconv-lite for other charsets
  return iconv.decode(bufferObj, charset);
}

// =============================================================================
// HELPER: SANITIZE
// =============================================================================

function sanitizeHTML(dirtyHtml: string): string {
  // DOMPurify requires a window environment
  const { window } = parseHTML(dirtyHtml) as any;
  // @ts-ignore - DOMPurify types might not perfectly match linkedom window
  const purify = DOMPurify(window);
  return purify.sanitize(dirtyHtml, {
    WHOLE_DOCUMENT: true,
    ADD_TAGS: ['head', 'meta', 'title', 'link'], // Keep metadata tags
  });
}

function resolveRelativeUrls(html: string, baseUrl: string): string {
  const { document } = parseHTML(html) as any;
  const base = new URL(baseUrl);

  document.querySelectorAll('a').forEach((el: any) => {
    try {
      if (el.href) el.href = new URL(el.href, baseUrl).href;
    } catch (e) { /* ignore invalid urls */ }
  });

  document.querySelectorAll('img, video, audio, source').forEach((el: any) => {
    try {
      if (el.src) el.src = new URL(el.src, baseUrl).href;
    } catch (e) { /* ignore */ }
  });

  return document.toString();
}

// =============================================================================
// MAIN: SNAPSHOT
// =============================================================================

export async function snapshotUrl(url: string): Promise<SnapshotResult | null> {
  try {
    const response = await fetch(url, {
      headers: {
        // Use a more realistic browser User-Agent to avoid 403s
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1'
      },
    });

    if (!response.ok) {
      logWarn(`[Snapshot] Failed to fetch ${url}: ${response.status} ${response.statusText}`);
      return null;
    }

    // 1. Decode
    const rawHtml = await decodeResponseBody(response);

    // 2. Sanitize & Resolve URLs
    const sanitizedHtml = sanitizeHTML(rawHtml);
    const resolvedHtml = resolveRelativeUrls(sanitizedHtml, url);

    // 3. Readability Parse
    const { document } = parseHTML(resolvedHtml) as any;
    const reader = new Readability(document as any, {
      debug: false,
      keepClasses: true,
    });

    const parsed = reader.parse();

    if (!parsed) return null;

    return {
      url,
      title: parsed.title || '',
      content: parsed.content || '',
      textContent: parsed.textContent || '',
      excerpt: parsed.excerpt || '',
      byline: parsed.byline || '',
      siteName: parsed.siteName || new URL(url).hostname,
      lang: parsed.lang || 'en',
      capturedAt: new Date().toISOString(),
    };

  } catch (error) {
    log(`[Snapshot] Error fetching ${url}:`, error);
    return null;
  }
}
