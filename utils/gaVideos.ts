/**
 * utils/gaVideos.ts
 *
 * Fetches recent GA videos using two strategies, tried in order:
 *
 *   1. YouTube Data API v3 search — searches "general aviation pilot" for videos
 *      published in the past 3 months. Uses the existing GOOGLE_KEY.
 *      Returns up to 40 genuinely fresh, varied results.
 *
 *   2. Channel RSS fallback — fetches the 4 curated GA channels via YouTube's
 *      public Atom feeds (no API key required), filtered to 90 days.
 *
 * Results are cached in AsyncStorage for 24 hours.
 * Pull-to-refresh bypasses the cache via refreshGaVideos().
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { GOOGLE_KEY } from './config';

export interface GaVideoItem {
  id: string;
  title: string;
  channel: string;
  publishedAt: string;  // ISO date string
  duration: string;
  videoId: string;
  thumbnail: string;
  embedUrl: string;
  category: string;
}

// ─── Cache ────────────────────────────────────────────────────────────────────

const VIDEO_CACHE_KEY = '@leftseat/ga-videos-v4';
const VIDEO_TTL_MS    = 24 * 60 * 60 * 1000; // 24 hours

interface VideoCache { items: GaVideoItem[]; fetchedAt: number; }

async function loadVideoCache(): Promise<GaVideoItem[] | null> {
  try {
    const raw = await AsyncStorage.getItem(VIDEO_CACHE_KEY);
    if (!raw) return null;
    const cache: VideoCache = JSON.parse(raw);
    if (!cache.items?.length) return null;
    if (Date.now() - cache.fetchedAt > VIDEO_TTL_MS) return null;
    return cache.items;
  } catch { return null; }
}

function saveVideoCache(items: GaVideoItem[]): void {
  AsyncStorage.setItem(
    VIDEO_CACHE_KEY,
    JSON.stringify({ items, fetchedAt: Date.now() } satisfies VideoCache),
  ).catch(() => {});
}

// ─── Strategy 1: YouTube Data API v3 ─────────────────────────────────────────

// Search terms rotated across queries to pull variety from different GA niches
const YT_QUERIES = [
  'general aviation pilot',
  'private pilot flying',
  'Cessna Piper aircraft flying',
  'GA pilot vlog airport',
  'IFR VFR pilot training',
];

const YT_CATEGORY_MAP: Record<string, string> = {
  'general aviation pilot':       'General',
  'private pilot flying':         'Training',
  'Cessna Piper aircraft flying': 'General',
  'GA pilot vlog airport':        'General',
  'IFR VFR pilot training':       'Training',
};

async function fetchViaApi(): Promise<GaVideoItem[]> {
  if (!GOOGLE_KEY) return [];

  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  if (__DEV__) console.log('[gaVideos] trying YouTube Data API v3, cutoff:', cutoff);

  const results = await Promise.all(
    YT_QUERIES.map(async (q): Promise<GaVideoItem[]> => {
      const url =
        `https://www.googleapis.com/youtube/v3/search` +
        `?part=snippet&type=video&q=${encodeURIComponent(q)}` +
        `&publishedAfter=${cutoff}&maxResults=10&order=date&key=${GOOGLE_KEY}`;
      try {
        const res = await fetch(url);
        if (!res.ok) {
          if (__DEV__) console.warn(`[gaVideos] API search "${q}" — HTTP ${res.status}`);
          return [];
        }
        const data = await res.json();
        if (data.error) {
          if (__DEV__) console.warn(`[gaVideos] API error for "${q}":`, data.error.message);
          return [];
        }
        const items: GaVideoItem[] = (data.items ?? []).map((item: any, i: number) => {
          const videoId = item.id?.videoId ?? '';
          return {
            id:          `api-${q}-${i}`,
            title:       item.snippet?.title ?? '',
            channel:     item.snippet?.channelTitle ?? '',
            publishedAt: item.snippet?.publishedAt ?? '',
            duration:    '',
            videoId,
            thumbnail:   item.snippet?.thumbnails?.high?.url
                      ?? item.snippet?.thumbnails?.medium?.url
                      ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
            embedUrl:    `https://www.youtube.com/embed/${videoId}?rel=0&playsinline=1`,
            category:    YT_CATEGORY_MAP[q] ?? 'General',
          };
        }).filter((v: GaVideoItem) => v.videoId && v.title);
        if (__DEV__) console.log(`[gaVideos] API "${q}": ${items.length} videos`);
        return items;
      } catch (e) {
        if (__DEV__) console.warn(`[gaVideos] API fetch error for "${q}":`, e);
        return [];
      }
    }),
  );

  return results.flat();
}

// ─── Strategy 2: Channel RSS fallback ────────────────────────────────────────

const YT_CHANNELS: Array<{ id: string; name: string; category: string }> = [
  { id: 'UCE1iYTfGLjpCMLLzZfDaXbg', name: 'EAA',                  category: 'Events'   },
  { id: 'UCCWbc38ZLnbvdFiFJKDawCQ', name: 'Fly8MA Flight Training', category: 'Training' },
  { id: 'UClQuD8W4UNatz7huHPx2frg', name: 'MzeroA Flight Training', category: 'Training' },
  { id: 'UCBeZYVlqOeSSlrBSXl4aTig', name: 'Pilot Debrief',          category: 'Safety'   },
];

function tagContent(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = xml.match(re);
  return m ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim() : '';
}
function attrValue(xml: string, tag: string, attr: string): string {
  const re = new RegExp(`<${tag}[^>]*\\s${attr}="([^"]*)"`, 'i');
  const m = xml.match(re);
  return m ? m[1] : '';
}
function extractEntries(xml: string): string[] {
  const entries: string[] = [];
  const re = /<entry>([\s\S]*?)<\/entry>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) entries.push(m[1]);
  return entries;
}

async function fetchChannel(ch: typeof YT_CHANNELS[0]): Promise<GaVideoItem[]> {
  const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${ch.id}`;
  try {
    const res = await fetch(url, { headers: { 'Cache-Control': 'no-cache' } });
    if (!res.ok) return [];
    const xml = await res.text();
    return extractEntries(xml).map((entry, i) => {
      const videoId     = tagContent(entry, 'yt:videoId');
      const title       = tagContent(entry, 'title');
      const publishedAt = tagContent(entry, 'published');
      const thumbnail   = attrValue(entry, 'media:thumbnail', 'url')
                       || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
      return {
        id: `${ch.id}-${i}`, title, channel: ch.name, publishedAt,
        duration: '', videoId, thumbnail,
        embedUrl: `https://www.youtube.com/embed/${videoId}?rel=0&playsinline=1`,
        category: ch.category,
      };
    }).filter(v => v.videoId && v.title);
  } catch { return []; }
}

async function fetchViaRss(): Promise<GaVideoItem[]> {
  if (__DEV__) console.log('[gaVideos] falling back to RSS channels');
  const results = await Promise.all(YT_CHANNELS.map(fetchChannel));
  return results.flat();
}

// ─── Shared post-processing ───────────────────────────────────────────────────

function processVideos(all: GaVideoItem[]): GaVideoItem[] {
  // Deduplicate by videoId
  const seen = new Set<string>();
  const unique = all.filter(v => {
    if (seen.has(v.videoId)) return false;
    seen.add(v.videoId);
    return true;
  });

  // Filter to past 90 days
  const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
  const recent = unique.filter(v => v.publishedAt && new Date(v.publishedAt).getTime() >= cutoff);

  // If nothing survives the date filter, keep unfiltered so the tab isn't empty
  const final = recent.length > 0 ? recent : unique;

  // Sort newest first
  final.sort((a, b) =>
    (b.publishedAt ? new Date(b.publishedAt).getTime() : 0) -
    (a.publishedAt ? new Date(a.publishedAt).getTime() : 0),
  );

  if (__DEV__) console.log(`[gaVideos] ${unique.length} unique → ${final.length} within 90 days`);
  return final;
}

// ─── Main exports ─────────────────────────────────────────────────────────────

export async function fetchGaVideos(): Promise<GaVideoItem[]> {
  const cached = await loadVideoCache();
  if (cached) {
    if (__DEV__) console.log(`[gaVideos] cache hit — ${cached.length} videos`);
    return cached;
  }

  // Try YouTube Data API first, fall back to RSS
  let raw = await fetchViaApi();
  if (raw.length === 0) raw = await fetchViaRss();
  if (raw.length === 0) return FALLBACK_VIDEOS;

  const final = processVideos(raw);
  saveVideoCache(final);
  return final;
}

/** Clears cache and re-fetches — call on pull-to-refresh. */
export async function refreshGaVideos(): Promise<GaVideoItem[]> {
  await AsyncStorage.removeItem(VIDEO_CACHE_KEY).catch(() => {});
  return fetchGaVideos();
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function videoAgeLabel(isoDate: string): string {
  const d = new Date(isoDate);
  if (isNaN(d.getTime())) return '';
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days < 1)   return 'Today';
  if (days < 7)   return `${days}d ago`;
  if (days < 30)  return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

// ─── Fallback ─────────────────────────────────────────────────────────────────

export const FALLBACK_VIDEOS: GaVideoItem[] = [];
