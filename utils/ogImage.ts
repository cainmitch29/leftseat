/**
 * utils/ogImage.ts
 *
 * Fetches the og:image meta tag from an event/festival website and caches
 * the result in AsyncStorage for 7 days.
 *
 * Works on native iOS/Android — no CORS restrictions apply.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

const PREFIX  = 'ogImage:';
const TTL_MS  = 7 * 24 * 60 * 60 * 1000; // 7 days
const TIMEOUT = 8_000; // ms per fetch

/** Resolve a potentially relative og:image URL against the page origin. */
function resolveUrl(src: string, pageUrl: string): string {
  if (/^https?:\/\//i.test(src)) return src;
  try {
    return new URL(src, pageUrl).href;
  } catch {
    return src;
  }
}

/** Parse og:image content from raw HTML. */
function parseOgImage(html: string, pageUrl: string): string | null {
  // Handles both attribute orderings
  const patterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return resolveUrl(m[1], pageUrl);
  }
  return null;
}

/**
 * Fetch og:image for a URL, using a 7-day AsyncStorage cache.
 * Returns null if the site has no og:image or the fetch fails.
 */
export async function fetchOgImage(url: string): Promise<string | null> {
  const key = PREFIX + url;

  // 1 — Cache hit (skip stale or previously-cached null entries)
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw) {
      const { imageUrl, ts } = JSON.parse(raw) as { imageUrl: string | null; ts: number };
      if (imageUrl && Date.now() - ts < TTL_MS) return imageUrl;
    }
  } catch {}

  // 2 — Fetch
  let imageUrl: string | null = null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
        Accept: 'text/html',
      },
    });
    clearTimeout(timer);
    if (res.ok) {
      const html = await res.text();
      imageUrl = parseOgImage(html, url);
      // Upgrade http:// → https:// so iOS ATS doesn't block the image load
      if (imageUrl?.startsWith('http://')) {
        imageUrl = 'https://' + imageUrl.slice(7);
      }
    }
  } catch {}

  // 3 — Only cache successful results; failed/null fetches will retry next time
  if (imageUrl !== null) {
    try {
      await AsyncStorage.setItem(key, JSON.stringify({ imageUrl, ts: Date.now() }));
    } catch {}
  }

  return imageUrl;
}

/**
 * React hook — fetches og:image for the given URL.
 * Returns null while loading or if no image is found.
 */
export function useOgImage(url: string | null | undefined): string | null {
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    fetchOgImage(url).then(img => { if (!cancelled) setImageUrl(img); });
    return () => { cancelled = true; };
  }, [url]);

  return imageUrl;
}
