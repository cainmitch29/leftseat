/**
 * Supabase-backed cache for Google Places nearbysearch results.
 *
 * Each airport × category gets its own row, keyed by (airport_icao, category).
 * Categories: 'restaurants' | 'hotels' | 'golf' | 'things'
 * Results are fresh for CACHE_TTL_DAYS days.
 *
 * Required Supabase table — run the SQL in docs/supabase_places_cache.sql.
 */

import { supabase } from '../lib/supabase';

const CACHE_TTL_DAYS = 7; // 7-day cache — restaurant/hotel/golf data doesn't change daily

// ── Session block flag ────────────────────────────────────────────────────────
// Set when any live Places request returns a billing/auth denial.
// Resets on app reload — never persisted. This prevents hammering a suspended account.
let _placesApiBlocked = false;

export function isPlacesApiBlocked(): boolean {
  return _placesApiBlocked;
}

export function setPlacesApiBlocked(): void {
  if (!_placesApiBlocked) {
    _placesApiBlocked = true;
    console.warn(
      '\n[Places] 🚫 SESSION BLOCKED ─────────────────────────────────\n' +
      '[Places] A REQUEST_DENIED or billing error was received from Google.\n' +
      '[Places] All further live Places requests are disabled this session.\n' +
      '[Places] Cached data will be used where available; empty otherwise.\n' +
      '[Places] To re-enable: fix billing in Google Cloud Console, then reload the app.\n' +
      '[Places] ─────────────────────────────────────────────────────────'
    );
  }
}

// Statuses that indicate a billing/account suspension (not a quota/rate limit)
const DENIAL_STATUSES = new Set(['REQUEST_DENIED', 'OVER_DAILY_LIMIT']);
export function isDenialStatus(status: string | undefined): boolean {
  return Boolean(status && DENIAL_STATUSES.has(status));
}

export type PlacesCategory = 'restaurants' | 'hotels' | 'golf' | 'things';

export interface PlacesResult {
  restaurants: any[];
  hotels: any[];
  golf: any[];
  things: any[];
}

/** Mock data returned when USE_PLACES_TEST_MODE is true. */
export const MOCK_PLACES: PlacesResult = {
  restaurants: [
    { name: '[TEST] Airport Diner', type: 'restaurant', rating: '4.2 ⭐ (120)', distance: 'On airport', distanceMiles: 0.2, open: true, lat: 0, lng: 0, placeId: 'test_rest_1', photoRef: null },
    { name: '[TEST] Runway Café', type: 'cafe', rating: '4.5 ⭐ (88)', distance: '0.5 mi', distanceMiles: 0.5, open: true, lat: 0, lng: 0, placeId: 'test_rest_2', photoRef: null },
  ],
  hotels: [
    { name: '[TEST] Airfield Inn & Suites', type: 'lodging', rating: '4.0 ⭐ (200)', distance: '1.2 mi', distanceMiles: 1.2, open: true, lat: 0, lng: 0, placeId: 'test_hotel_1', photoRef: null },
  ],
  golf: [
    { name: '[TEST] Fairway Golf Club', type: 'golf_course', rating: '4.5 ⭐ (310)', distance: '3.1 mi', distanceMiles: 3.1, open: true, lat: 0, lng: 0, placeId: 'test_golf_1', photoRef: null },
  ],
  things: [
    { name: '[TEST] Aviation Heritage Museum', type: 'point_of_interest', rating: '4.8 ⭐ (500)', distance: '0.4 mi', distanceMiles: 0.4, open: true, lat: 0, lng: 0, placeId: 'test_thing_1', photoRef: null },
    { name: '[TEST] Scenic Overlook Park', type: 'park', rating: '4.3 ⭐ (90)', distance: '2.0 mi', distanceMiles: 2.0, open: true, lat: 0, lng: 0, placeId: 'test_thing_2', photoRef: null },
  ],
};

/**
 * Returns cached items for one category, or null if missing/expired.
 * Errors from a missing table are caught and logged — never throws.
 */
export async function getCachedCategory(icao: string, category: PlacesCategory): Promise<any[] | null> {
  try {
    const { data, error } = await supabase
      .from('airport_places_cache')
      .select('data, expires_at')
      .eq('airport_icao', icao.toUpperCase())
      .eq('category', category)
      .single();

    if (error) {
      // PGRST116 = no rows found (normal on first visit)
      // PGRST205 = table not in schema cache (table doesn't exist yet — create it via SQL below)
      const silentCodes = new Set(['PGRST116', 'PGRST205']);
      if (!silentCodes.has(error.code)) {
        console.warn(`[PlacesCache] ${icao}/${category} query error (${error.code}): ${error.message}`);
      }
      return null;
    }

    if (!data) return null;

    if (new Date(data.expires_at) < new Date()) {
      console.log(`[PlacesCache] ${icao}/${category} EXPIRED — will refetch`);
      return null;
    }

    const items: any[] = data.data ?? [];
    console.log(`[PlacesCache] ${icao}/${category} HIT (${items.length} items)`);
    return items;
  } catch (err) {
    console.warn(`[PlacesCache] getCachedCategory(${icao}, ${category}) threw:`, err);
    return null;
  }
}

/**
 * Writes one category to the cache. Uses upsert so it's safe to call every fetch.
 * Fire-and-forget — never throws.
 */
export async function setCachedCategory(icao: string, category: PlacesCategory, items: any[]): Promise<void> {
  try {
    const now = new Date();
    const expiresAt = new Date(now);
    expiresAt.setDate(expiresAt.getDate() + CACHE_TTL_DAYS);

    const { error } = await supabase
      .from('airport_places_cache')
      .upsert(
        {
          airport_icao: icao.toUpperCase(),
          category,
          data: items,
          fetched_at: now.toISOString(),
          expires_at: expiresAt.toISOString(),
        },
        { onConflict: 'airport_icao,category' },
      );

    if (error) {
      if (error.code === 'PGRST205') {
        if (__DEV__) console.warn(`[PlacesCache] ${icao}/${category} write skipped — table not found. Run the SQL in docs/supabase_places_cache.sql to enable caching.`);
      } else {
        console.warn(`[PlacesCache] ${icao}/${category} write error (${error.code}): ${error.message}`);
      }
    } else {
      if (__DEV__) console.log(`[PlacesCache] ${icao}/${category} STORED (${items.length} items, expires ${expiresAt.toDateString()})`);
    }
  } catch (err) {
    console.warn(`[PlacesCache] setCachedCategory(${icao}, ${category}) threw:`, err);
  }
}
