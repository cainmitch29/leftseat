/**
 * utils/gaNews.ts
 *
 * Fetches GA news from public RSS feeds and normalizes items into a
 * consistent shape that the Events screen can render.
 *
 * No external packages required — uses a lightweight regex-based XML parser
 * that handles standard RSS 2.0 and Atom-compatible feeds.
 *
 * ─── Adding more feeds ───────────────────────────────────────────────────────
 * Just append an entry to RSS_FEEDS. Each feed needs:
 *   url      – publicly accessible RSS/Atom endpoint
 *   source   – display name shown on cards
 *   category – one of: FAA | Airshow | Avionics | Safety | Airport | General
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export interface GaNewsItem {
  id: string;
  headline: string;
  source: string;
  time: string;       // human-readable relative time ("2h ago")
  pubDate: string;    // raw date string from feed (for sorting)
  category: string;
  url: string;
  summary: string;
  image: string | null;
}

// ─── Feed sources (add more here anytime) ────────────────────────────────────

export const RSS_FEEDS: Array<{ url: string; source: string; category: string }> = [
  // General aviation news
  { url: 'https://www.aopa.org/news-and-media/all-news.rss',  source: 'AOPA',                 category: 'FAA'      },
  { url: 'https://www.avweb.com/feed/',                       source: 'AVweb',                category: 'Avionics' },
  { url: 'https://generalaviationnews.com/feed/',             source: 'General Aviation News', category: 'Airport'  },
  // Flying Magazine removed — branding images polluted the feed
  { url: 'https://www.planeandpilotmag.com/feed/',            source: 'Plane & Pilot',         category: 'General'  },
  { url: 'https://www.kitplanes.com/feed/',                   source: 'Kitplanes',            category: 'General'  },
  // Airshow / homebuilder community
  { url: 'https://www.eaa.org/rss/news',                      source: 'EAA',                  category: 'Airshow'  },
  // FAA / regulatory — press releases closest to Safety Briefing content
  { url: 'https://www.faa.gov/newsroom/rss',                  source: 'FAA',                  category: 'FAA'      },
];

// ─── Fallback data (shown instantly while RSS loads, or if feeds fail) ────────

export const FALLBACK_NEWS: GaNewsItem[] = [
  { id: 'f1', headline: 'FAA Proposes Updated VFR Weather Minimums for Class E Airspace', source: 'AOPA', time: '2h ago', pubDate: '', category: 'FAA', url: 'https://www.aopa.org/news-and-media', summary: 'The FAA is reviewing current VFR weather minimums in Class E airspace below 10,000 feet. The proposal would increase cloud clearance requirements and visibility floors to reduce the risk of inadvertent flight into IMC for VFR pilots. Public comment is open through the end of the quarter.', image: null },
  { id: 'f2', headline: 'EAA AirVenture 2026 Registration Opens with Record Early Entries', source: 'EAA', time: '5h ago', pubDate: '', category: 'Airshow', url: 'https://www.eaa.org/airventure', summary: 'EAA AirVenture Oshkosh 2026 has opened registration and is already tracking record numbers of early aircraft arrivals and camper reservations. New attractions this year include a dedicated formation flying demonstration area and an expanded ultralight flightline.', image: null },
  { id: 'f3', headline: 'Garmin Announces G3X Touch Major Software Update for Experimental Aircraft', source: 'AVweb', time: '1d ago', pubDate: '', category: 'Avionics', url: 'https://www.avweb.com', summary: "Garmin's latest G3X Touch software update brings SafeTaxi diagrams to over 1,400 additional airports, adds Visual Approach guidance, and improves autopilot roll steering compatibility. The update is available now via Garmin Pilot or direct USB.", image: null },
  { id: 'f4', headline: 'NTSB Safety Alert: VFR into IMC Remains Leading Accident Cause', source: 'NTSB', time: '2d ago', pubDate: '', category: 'Safety', url: 'https://www.ntsb.gov/safety', summary: 'The NTSB has released updated accident data showing that VFR flight into IMC conditions continues to account for a disproportionate share of fatal GA accidents. The board urges pilots to obtain instrument ratings, file flight plans, and always have a defined turn-back plan when weather is marginal.', image: null },
  { id: 'f5', headline: 'Infrastructure Funding to Improve 200+ GA Airports Across the US', source: 'General Aviation News', time: '3d ago', pubDate: '', category: 'Airport', url: 'https://generalaviationnews.com', summary: 'More than 200 general aviation airports will receive infrastructure improvement grants from the latest federal aviation funding package. Projects include runway resurfacing, lighting upgrades, and fuel farm modernization at rural airports that serve as critical community links.', image: null },
];

// ─── Lightweight XML helpers ──────────────────────────────────────────────────

/** Strip CDATA wrappers */
function stripCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
}

/** Extract text content of the first matching tag (handles self-closing & CDATA) */
function tagContent(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = xml.match(re);
  return m ? stripCdata(m[1]).trim() : '';
}

/** Extract attribute value from the first matching tag */
function attrValue(xml: string, tag: string, attr: string): string {
  const re = new RegExp(`<${tag}[^>]*\\s${attr}="([^"]*)"`, 'i');
  const m = xml.match(re);
  return m ? m[1] : '';
}

/** Split RSS/Atom XML into individual <item> or <entry> blocks */
function extractItems(xml: string): string[] {
  const items: string[] = [];
  // RSS 2.0 uses <item>, Atom uses <entry>
  const re = /<(?:item|entry)>([\s\S]*?)<\/(?:item|entry)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) items.push(m[1]);
  return items;
}

/**
 * Return true if a URL looks like a site logo, masthead, or branding asset
 * rather than a per-article hero photo.
 */
function isBrandingUrl(url: string): boolean {
  return /logo|masthead|brand|site-icon|favicon|apple-touch|flying-finance|flyingfinance|flying_finance|banner|placeholder|default-image|no-image/i.test(url);
}

/**
 * Collect every image candidate from an RSS item, then return the best one.
 *
 * Priority (highest → lowest):
 *   1. <img> tags inside content:encoded / description HTML  ← most likely article hero
 *   2. <media:content url="…"> — ALL occurrences, not just first
 *   3. <media:thumbnail url="…">
 *   4. <enclosure url="…">     ← last: often a site-wide logo on WP feeds
 *
 * Within each tier, branding-looking URLs are moved to the back so a real
 * article photo is always preferred.
 */
function extractImage(itemXml: string): string | null {
  const candidates: string[] = [];

  // Tier 1 — <img> tags found inside the HTML content of the item
  const imgRe = /<img[^>]+src="(https?:\/\/[^"]+\.(jpe?g|png|webp))[^"]*"/gi;
  let imgMatch: RegExpExecArray | null;
  while ((imgMatch = imgRe.exec(itemXml)) !== null) candidates.push(imgMatch[1]);

  // Tier 2 — ALL <media:content> tags (WP feeds often have logo first, hero second)
  const mcRe = /<media:content[^>]*\surl="([^"]+)"[^>]*/gi;
  let mcMatch: RegExpExecArray | null;
  while ((mcMatch = mcRe.exec(itemXml)) !== null) candidates.push(mcMatch[1]);

  // Tier 3 — <media:thumbnail>
  const mt = attrValue(itemXml, 'media:thumbnail', 'url');
  if (mt) candidates.push(mt);

  // Tier 4 — <enclosure> (lowest priority: often the publication logo on WP feeds)
  const enc = attrValue(itemXml, 'enclosure', 'url');
  if (enc && /\.(jpe?g|png|webp|gif)/i.test(enc)) candidates.push(enc);

  if (candidates.length === 0) return null;

  // Only use images that pass the branding filter — never fall back to a rejected logo/banner
  const validCandidates = candidates.filter(u => !isBrandingUrl(u));
  const chosen = validCandidates[0] ?? null;

  // ── Debug logging (remove after verifying correct images appear) ──
  if (__DEV__) {
    const rejected = candidates.filter(u => isBrandingUrl(u));
    console.log(`[gaNews] candidates: ${JSON.stringify(candidates)}`);
    if (rejected.length) console.log(`[gaNews] rejected: ${JSON.stringify(rejected)}`);
    console.log(`[gaNews] validCandidates: ${JSON.stringify(validCandidates)}`);
    console.log(`[gaNews] chosen: ${chosen ?? '(none — category icon fallback)'}`);
  }

  return chosen;
}

/** Extract the best link from an RSS item */
function extractLink(itemXml: string): string {
  // Standard <link>URL</link>
  const content = tagContent(itemXml, 'link');
  if (content?.startsWith('http')) return content;
  // Atom <link href="URL"/>
  const href = attrValue(itemXml, 'link', 'href');
  if (href) return href;
  // <guid> as permalink
  const guid = tagContent(itemXml, 'guid');
  if (guid?.startsWith('http')) return guid;
  return '';
}

/** Strip HTML tags and decode common entities */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-fA-F]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Convert a date string to a human-readable relative time */
function toRelativeTime(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  const diffMs = Date.now() - d.getTime();
  const diffH = Math.floor(diffMs / (1000 * 60 * 60));
  if (diffH < 1) return 'Just now';
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  if (diffD === 1) return '1d ago';
  if (diffD < 7) return `${diffD}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ─── og:image fallback (fetches article page when RSS has no valid image) ─────

/** Per-session cache so each article URL is only fetched once */
const ogImageCache = new Map<string, string | null>();

/**
 * Fetch the article page, read the og:image meta tag, and return the URL.
 * Returns null if the page is unreachable, has no og:image, or the URL
 * looks like a branding asset.
 *
 * Results are cached for the lifetime of the app session so pull-to-refresh
 * does not re-fetch pages we already resolved.
 */
async function fetchOgImage(articleUrl: string): Promise<string | null> {
  if (ogImageCache.has(articleUrl)) return ogImageCache.get(articleUrl)!;

  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 5000); // 5 s max per page
    const res = await fetch(articleUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': 'LeftSeat/1.0 (iOS; Aviation App)' },
    });
    clearTimeout(tid);
    if (!res.ok) { ogImageCache.set(articleUrl, null); return null; }

    const html = await res.text();

    // Find the <meta> tag that carries og:image (attribute order can vary)
    const metaTag = html.match(/<meta[^>]+og:image[^>]*>/i)?.[0] ?? '';
    const ogImage = metaTag.match(/content=["']([^"']+)["']/i)?.[1] ?? null;

    // Apply the same branding filter as the RSS candidates
    const result = ogImage && !isBrandingUrl(ogImage) ? ogImage : null;
    ogImageCache.set(articleUrl, result);
    return result;
  } catch {
    ogImageCache.set(articleUrl, null);
    return null;
  }
}

// ─── Fetch and parse one feed ─────────────────────────────────────────────────

async function fetchFeed(feed: typeof RSS_FEEDS[0]): Promise<GaNewsItem[]> {
  if (__DEV__) console.log(`[gaNews] fetching ${feed.source} → ${feed.url}`);
  try {
    const res = await fetch(feed.url, {
      headers: {
        'User-Agent': 'LeftSeat/1.0 (iOS; Aviation App)',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
      },
    });
    if (!res.ok) {
      if (__DEV__) console.log(`[gaNews] ${feed.source} failed — HTTP ${res.status}`);
      return [];
    }
    const xml = await res.text();
    const items = extractItems(xml).slice(0, 8); // max 8 per feed
    const parsed = await Promise.all(items.map(async (item, i) => {
      const headline = stripHtml(tagContent(item, 'title'));
      const url = extractLink(item);
      const pubDate = tagContent(item, 'pubDate') || tagContent(item, 'updated') || tagContent(item, 'dc:date');
      const rawDesc = tagContent(item, 'description') || tagContent(item, 'content:encoded') || tagContent(item, 'summary') || tagContent(item, 'content');
      const summary = stripHtml(rawDesc).slice(0, 400).trim();

      // Try RSS-embedded image first; fall back to og:image from the article page
      let image = extractImage(item);
      if (!image && url) {
        if (__DEV__) console.log(`[gaNews] no RSS image for "${headline}" — fetching og:image`);
        image = await fetchOgImage(url);
        if (__DEV__) console.log(`[gaNews] og:image result: ${image ?? '(none)'}`);
      }

      return {
        id: `${feed.source}-${i}`,
        headline: headline || '',
        source: feed.source,
        time: pubDate ? toRelativeTime(pubDate) : '',
        pubDate,
        category: feed.category,
        url,
        summary: summary || '',
        image,
      };
    }));
    const out = parsed.filter(item => item.headline && item.url); // skip items with no title or link
    if (__DEV__) console.log(`[gaNews] ${feed.source}: ${out.length} items parsed`);
    return out;
  } catch (e) {
    if (__DEV__) console.log(`[gaNews] ${feed.source} error: ${e}`);
    return [];
  }
}

// ─── AsyncStorage cache ───────────────────────────────────────────────────────

// Bump the version suffix whenever the feed list changes — forces old cached items to be discarded
const NEWS_CACHE_KEY = '@leftseat/ga-news-cache-v3';

interface NewsCache { items: GaNewsItem[]; fetchedAt: number; }

const NEWS_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Load the most recently saved news from AsyncStorage.
 * Returns null if nothing is cached yet or the cache is older than 30 minutes.
 */
export async function loadCachedNews(): Promise<GaNewsItem[] | null> {
  try {
    const raw = await AsyncStorage.getItem(NEWS_CACHE_KEY);
    if (!raw) return null;
    const cache: NewsCache = JSON.parse(raw);
    if (!cache.items?.length) return null;
    if (Date.now() - cache.fetchedAt > NEWS_TTL_MS) return null; // expired
    return cache.items;
  } catch {
    return null;
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Fetch news from all RSS_FEEDS in parallel.
 * Deduplicates by URL (cross-feed), sorts newest first, and persists to cache.
 * Returns FALLBACK_NEWS if all feeds fail (network off, etc).
 */
export async function fetchGaNews(): Promise<GaNewsItem[]> {
  try {
    const results = await Promise.all(RSS_FEEDS.map(fetchFeed));

    if (__DEV__) {
      RSS_FEEDS.forEach((feed, i) => {
        console.log(`[gaNews] ${feed.source} returned ${results[i].length} items`);
      });
    }

    const all = results.flat();
    if (__DEV__) console.log(`[gaNews] total before dedupe: ${all.length}`);
    if (all.length === 0) return FALLBACK_NEWS;

    // Deduplicate — first by URL, then by normalized headline (catches same story from two feeds)
    const seenUrls = new Set<string>();
    const seenTitles = new Set<string>();
    const unique = all.filter(item => {
      if (item.url && seenUrls.has(item.url)) return false;
      const titleKey = item.headline.toLowerCase().replace(/\s+/g, ' ').trim();
      if (seenTitles.has(titleKey)) return false;
      if (item.url) seenUrls.add(item.url);
      seenTitles.add(titleKey);
      return true;
    });

    if (__DEV__) console.log(`[gaNews] total after dedupe: ${unique.length}`);

    // Sort newest first
    unique.sort((a, b) => {
      const da = a.pubDate ? new Date(a.pubDate).getTime() : 0;
      const db = b.pubDate ? new Date(b.pubDate).getTime() : 0;
      return db - da;
    });

    if (__DEV__) {
      const sourceCounts: Record<string, number> = {};
      unique.forEach(item => { sourceCounts[item.source] = (sourceCounts[item.source] ?? 0) + 1; });
      console.log(`[gaNews] sources in final feed: ${JSON.stringify(sourceCounts)}`);
    }

    // Persist to cache (fire-and-forget — never blocks the return)
    AsyncStorage.setItem(NEWS_CACHE_KEY, JSON.stringify({ items: unique, fetchedAt: Date.now() } satisfies NewsCache)).catch(() => {});

    return unique;
  } catch {
    return FALLBACK_NEWS;
  }
}
