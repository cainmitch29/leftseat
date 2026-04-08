/**
 * utils/googlePlaces.ts
 *
 * Fetches one tab's worth of nearby places from the Google Places nearbysearch API.
 * Results are filtered and scored client-side before being returned.
 *
 * Caching (24-hour, Supabase) is handled by the caller (airport.tsx / placesCache.ts).
 *
 * In-flight guard: a module-level Set tracks active "ICAO:tab" requests.
 * If a request for the same airport+tab is already running, returns null immediately
 * so the caller can skip the duplicate call.
 *
 * Tab → Places type mapping:
 *   eat  → restaurant  (8 km radius)
 *   stay → lodging     (8 km radius)
 *   golf → golf_course (12 km radius — courses spread out more)
 *   do   → tourist_attraction (8 km radius)
 */

import { GOOGLE_KEY } from './config';
import { canCallPlaces, recordPlacesCall, PlacesPriority } from './placesRateLimit';

export type PlacesTab = 'eat' | 'stay' | 'golf' | 'do';


// ── Chain / junk filter (restaurants) ─────────────────────────────────────────

const FOOD_CHAINS_LOWER = [
  // Fast food
  'mcdonald', 'burger king', 'wendy', 'taco bell', 'kfc', 'arby', 'subway',
  'pizza hut', 'domino', 'papa john', 'dairy queen', 'sonic drive', 'chick-fil-a',
  'chick fil a', 'starbucks', 'dunkin', 'panera', 'chipotle', 'jersey mike',
  'jimmy john', 'five guys', 'waffle house', 'little caesar', 'panda express',
  'popeye', 'jack in the box', 'white castle', 'hardee', "carl's jr",
  'el pollo loco', 'wingstop', 'zaxby', 'raising cane', 'shake shack', 'culver',
  'whataburger', 'checkers', "rally's", 'del taco', 'qdoba', 'mcalister',
  // Casual dining chains
  'applebee', "chili's", 'chilis', 'buffalo wild wing', 'cracker barrel',
  'ihop', 'denny', 'olive garden', 'red lobster', 'longhorn steakhouse',
  'outback steakhouse', 'texas roadhouse', 'cheesecake factory', 'ruby tuesday',
  'bob evans', 'perkins', 'golden corral', 'steak n shake', "steak 'n shake",
  'freddy', 'culvers', 'cookout', 'krystal', 'bojangle', 'captain d',
  'long john silver', "moe's southwest", "fuzzy's taco", 'firehouse sub',
  'jason deli', 'potbelly', 'newk', 'which wich', 'schlotzsky',
  'noodles & company', 'noodles and company', 'zoe', "zoe's kitchen",
  'slim chicken', 'tropical smoothie', 'auntie anne', 'cinnabon', 'sbarro',
  'houlihan', "t.g.i. friday", 'tgi friday', 'red robin',
  // Convenience stores / gas stations — not food destinations
  'circle k', '7-eleven', '7 eleven', 'seven eleven',
  "casey's", 'caseys general',
  'kwik trip', 'kwik star', 'kwikstar',
  'sheetz', 'wawa',
  'pilot flying j', 'flying j', "love's travel", 'loves travel',
  'ta travel', 'ta petro', 'pilot travel center',
  'racetrac', "bucky's", 'kum & go', 'kum and go',
  'holiday stationstore', 'holiday station store', 'maverik',
  'ampm', 'am-pm',
  'speedway gas', 'sunoco', 'exxon',
];

export function isFoodChain(name: string): boolean {
  const lower = name.toLowerCase();
  return FOOD_CHAINS_LOWER.some(c => lower.includes(c));
}

// ── Lodging filter ─────────────────────────────────────────────────────────────

const NON_HOTEL_TYPES = new Set([
  'real_estate_agency', 'travel_agency', 'moving_company', 'storage',
  'apartment_complex', 'property_management_company', 'general_contractor',
]);

const NON_HOTEL_NAME_KEYWORDS = [
  'agency', 'vacations', 'real estate', 'realty', 'realtor', 'properties',
  'property', 'apartments', 'apartment', 'airbnb', 'corporate housing',
  'furnished', 'leasing', 'condos', 'townhome',
];

const HOTEL_NAME_ALLOWLIST = [
  'hotel', 'motel', 'inn', 'resort', 'suites', 'suite', 'lodge',
  'marriott', 'hilton', 'hyatt', 'sheraton', 'westin', 'doubletree',
  'hampton', 'courtyard', 'fairfield', 'aloft', 'embassy', 'residence inn',
  'home2', 'homewood', 'element', 'four seasons', 'ritz', 'intercontinental',
  'holiday inn', 'crowne plaza', 'candlewood', 'staybridge', 'best western',
  'quality inn', 'comfort inn', 'sleep inn', 'days inn', 'super 8',
  'la quinta', 'motel 6', 'red roof', 'microtel',
];

function isRealLodging(p: any): boolean {
  const lower = (p.name || '').toLowerCase();
  const types: string[] = p.types || [];
  if (types.some((t: string) => NON_HOTEL_TYPES.has(t))) return false;
  if (NON_HOTEL_NAME_KEYWORDS.some(k => lower.includes(k))) return false;
  if (!p.rating || (p.user_ratings_total ?? 0) < 5) return false;
  return HOTEL_NAME_ALLOWLIST.some(k => lower.includes(k));
}

// ── Food type filter (Eat tab) ─────────────────────────────────────────────────
// Applied to ALL eat tab results (both textsearch and nearbysearch).
// nearbysearch with type=restaurant usually returns real food, but textsearch
// is keyword-based and can return airports, air shows, museums, etc.

// Types that confirm a place is actual food.
const FOOD_TYPES = new Set([
  'restaurant', 'cafe', 'bakery', 'meal_takeaway', 'meal_delivery', 'bar',
]);

// Types that ALWAYS disqualify a place — not food destinations even if also tagged
// as restaurant or meal_takeaway. A Circle K with meal_takeaway is still not a
// food destination worth flying to.
const HARD_BAD_TYPES = new Set([
  'gas_station', 'convenience_store', 'grocery_or_supermarket', 'supermarket',
  'liquor_store', 'car_wash', 'fuel',
]);

// Types that disqualify only when no food type is also present.
const SOFT_BAD_TYPES = new Set([
  'airport', 'park', 'tourist_attraction', 'shopping_mall', 'lodging', 'event_venue',
]);

// Name keywords that disqualify a place when no food type is present.
const NON_FOOD_NAME_KEYWORDS = [
  'airport', 'air show', 'airshow', 'museum', 'outlet', 'hotel', 'mall',
];

export function isRealFood(p: any): boolean {
  const types: string[] = p.types || [];
  const name = (p.name || '').toLowerCase();
  // Hard blockers — always reject, even if Google also tagged it as restaurant/meal_takeaway.
  // This catches gas stations / convenience stores that serve food (Circle K, etc.).
  if (types.some(t => HARD_BAD_TYPES.has(t))) return false;
  const hasFoodType     = types.some(t => FOOD_TYPES.has(t));
  const hasSoftBadType  = types.some(t => SOFT_BAD_TYPES.has(t));
  // Soft bad type → only blocks if no food type is present
  if (hasSoftBadType && !hasFoodType) return false;
  // Must have at least one food type
  if (!hasFoodType) return false;
  // Belt-and-suspenders name check
  if (NON_FOOD_NAME_KEYWORDS.some(k => name.includes(k)) && !hasFoodType) return false;
  return true;
}

/**
 * Stricter food filter for the Discover "Fly for Food" section.
 * Combines isRealFood (type-based) with isFoodChain (chain/convenience name check).
 * Dev logs show the place name, types, and pass/fail reason.
 */
export function isRealFoodDestination(p: any, icao?: string): boolean {
  const name: string = p.name ?? '';
  const types: string[] = p.types ?? [];
  if (!isRealFood(p)) {
    if (__DEV__ && icao) console.log(`[FoodFilter] ${icao} REJECT "${name}" types=[${types.join(',')}] — bad type`);
    return false;
  }
  if (isFoodChain(name)) {
    if (__DEV__ && icao) console.log(`[FoodFilter] ${icao} REJECT "${name}" types=[${types.join(',')}] — chain/convenience`);
    return false;
  }
  if (__DEV__ && icao) console.log(`[FoodFilter] ${icao} PASS "${name}" types=[${types.join(',')}]`);
  return true;
}

// ── Golf filter ────────────────────────────────────────────────────────────────
// NOTE: We query with type=golf_course so Google pre-filters to golf courses.
// The post-filter only needs to remove mini golf and non-playable venues.
// Do NOT re-verify types[] or require golf keywords — those checks drop real courses.
// 'park' was previously in a blocked-types list; Google often tags golf courses as
// parks, so that exclusion was silently removing legitimate results.

const MINI_GOLF_TERMS = ['mini golf', 'miniature golf', 'mini-golf', 'putt putt', 'putt-putt', 'adventure golf'];
const GOLF_SKIP_NAMES = [
  'golf cart', 'cart rental', 'golf simulator', 'golf supply',
  'golf shop', 'golf academy', 'golf school', 'driving range only',
];

function isRealGolf(p: any): boolean {
  const name = (p.name || '').toLowerCase();
  const types: string[] = p.types || [];
  // Primary gate: must be classified as golf_course by Google.
  // We query with type=golf_course, but Google occasionally returns nearby places
  // whose primary type differs (e.g. park, establishment). This drops them.
  if (!types.includes('golf_course')) return false;
  // Remove mini golf by name
  if (MINI_GOLF_TERMS.some(t => name.includes(t))) return false;
  // Remove non-playable venues (shops, simulators, etc.)
  if (GOLF_SKIP_NAMES.some(t => name.includes(t))) return false;
  return true;
}

// ── Distance + scoring ─────────────────────────────────────────────────────────

function distMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Primary sort: distance from airport (closer = better).
// Tie-break: rating × log(review count) — worth up to ~1.2 miles of advantage.
function score(p: any, airLat: number, airLng: number): number {
  const rating = p.rating || 0;
  const reviews = p.user_ratings_total || 0;
  const lat = p.geometry?.location?.lat ?? airLat;
  const lng = p.geometry?.location?.lng ?? airLng;
  const dist = distMiles(airLat, airLng, lat, lng);
  const qualityBonus = reviews >= 5 ? rating * Math.log(reviews + 1) : 0;
  return -dist * 10 + qualityBonus;
}

// ── Convert a Google Places result to the shape PlaceCard expects ──────────────

function toPlace(p: any, airLat: number, airLng: number, typeLabel: string): any {
  const lat = p.geometry?.location?.lat ?? 0;
  const lng = p.geometry?.location?.lng ?? 0;
  const dm = Math.round(distMiles(airLat, airLng, lat, lng) * 10) / 10;
  // nearbysearch returns `vicinity`; textsearch returns `formatted_address`
  const addr = p.vicinity || p.formatted_address || '';
  return {
    name: p.name || 'Unknown',
    type: typeLabel,
    rating: p.rating ? `${p.rating} ⭐ (${p.user_ratings_total ?? 0})` : '',
    distance: addr || `${dm} mi from field`,
    distanceMiles: dm,
    open: p.opening_hours?.open_now,
    lat,
    lng,
    placeId: p.place_id ?? null,
    photoRef: p.photos?.[0]?.photo_reference ?? null,
    phone: null,    // only available via place details — fetched on card tap
    website: null,
    address: addr,
  };
}

// ── Raw API calls ──────────────────────────────────────────────────────────────

// textsearch: finds places by keyword query, biased toward a location.
// Used for airport-specific queries like "KJEF restaurant".
// Note: `radius` here is a bias, not a hard filter — results outside it can appear.
async function textsearch(query: string, lat: number, lng: number, biasRadius: number, source = 'unknown', priority: PlacesPriority = 'high'): Promise<any[]> {
  if (!GOOGLE_KEY) throw new Error('No Google API key configured');
  if (!canCallPlaces('textsearch', source, priority)) return [];
  const url =
    `https://maps.googleapis.com/maps/api/place/textsearch/json` +
    `?query=${encodeURIComponent(query)}` +
    `&location=${lat},${lng}` +
    `&radius=${biasRadius}` +
    `&key=${GOOGLE_KEY}`;
  const res = await fetch(url);
  recordPlacesCall('textsearch', source);
  if (!res.ok) throw new Error(`textsearch HTTP ${res.status}`);
  const json = await res.json();
  if (json.status === 'REQUEST_DENIED' || json.status === 'OVER_DAILY_LIMIT') {
    throw new Error(`Places API denied: ${json.status} — check billing in Google Cloud Console`);
  }
  return json.results ?? [];
}

async function nearbysearch(lat: number, lng: number, type: string, radius: number, source = 'unknown', priority: PlacesPriority = 'high'): Promise<any[]> {
  if (!GOOGLE_KEY) throw new Error('No Google API key configured');
  if (!canCallPlaces('nearbysearch', source, priority)) return [];
  const url =
    `https://maps.googleapis.com/maps/api/place/nearbysearch/json` +
    `?location=${lat},${lng}` +
    `&radius=${radius}` +
    `&type=${type}` +
    `&key=${GOOGLE_KEY}`;
  const res = await fetch(url);
  recordPlacesCall('nearbysearch', source);
  if (!res.ok) throw new Error(`nearbysearch HTTP ${res.status}`);
  const json = await res.json();
  if (json.status === 'REQUEST_DENIED' || json.status === 'OVER_DAILY_LIMIT') {
    throw new Error(`Places API denied: ${json.status} — check billing in Google Cloud Console`);
  }
  return json.results ?? [];
}

// ── Main export ────────────────────────────────────────────────────────────────

/**
 * Fetches one tab's worth of Google Places results for an airport.
 *
 * Returns an array of place objects (same shape as PlaceCard expects), or null
 * if a request for this icao+tab is already in flight (caller should skip/retry).
 *
 * Throws on API error so the caller can fall back to cached data gracefully.
 */
export async function fetchGooglePlacesTab(
  airLat: number,
  airLng: number,
  tab: PlacesTab,
  icao: string,
  airportName = '',   // optional — used by eat tab for airport-specific textsearch
  source = 'unknown', // caller label for rate limit logging
): Promise<any[]> {
  const key = `${icao.toUpperCase()}:${tab}`;

  let raw: any[] = [];

  if (tab === 'eat') {
    // Single nearbysearch — saves 2-3 textsearch calls per airport
    const nearbyRaw = await nearbysearch(airLat, airLng, 'restaurant', 8000, source);
    if (__DEV__) console.log(`[Places] ${key} raw results=${nearbyRaw.length}`);
    raw = nearbyRaw.filter(p => isRealFood(p) && !isFoodChain(p.name ?? ''));
    if (__DEV__) console.log(`[Places] ${key} after filter=${raw.length}`);

  } else if (tab === 'stay') {
    raw = await nearbysearch(airLat, airLng, 'lodging', 8000, source);
    const before = raw.length;
    raw = raw.filter(isRealLodging);
    if (__DEV__) console.log(`[GooglePlaces] ${key}: raw=${before}, after lodging filter=${raw.length}`);

  } else if (tab === 'golf') {
    const GOLF_RADIUS = 25000; // 25 km ≈ 15 miles
    if (__DEV__) console.log(`[GooglePlaces] ${key}: querying nearbysearch+textsearch, radius=${GOLF_RADIUS}m`);

    // Run both queries in parallel — nearbysearch may miss courses Google didn't tag
    // as golf_course type; textsearch finds them by keyword instead.
    const [nearbyRaw, textRaw] = await Promise.all([
      nearbysearch(airLat, airLng, 'golf_course', GOLF_RADIUS, source).catch(() => []),
      textsearch('golf course', airLat, airLng, GOLF_RADIUS, source).catch(() => []),
    ]);

    const nearbyGolf = nearbyRaw.filter(isRealGolf);
    const MAX_GOLF_MILES = 16; // matches ~25 km nearbysearch hard cap
    const textGolf = textRaw.filter((p: any) => {
      const name = (p.name || '').toLowerCase();
      if (MINI_GOLF_TERMS.some(t => name.includes(t))) return false;
      if (GOLF_SKIP_NAMES.some(t => name.includes(t))) return false;
      if (!((p.types ?? []).includes('golf_course') || name.includes('golf') || name.includes('country club'))) return false;
      // textsearch radius is bias-only — enforce a hard distance cap
      const pLat = p.geometry?.location?.lat ?? airLat;
      const pLng = p.geometry?.location?.lng ?? airLng;
      return distMiles(airLat, airLng, pLat, pLng) <= MAX_GOLF_MILES;
    });

    const golfSeen = new Set<string>();
    for (const p of [...nearbyGolf, ...textGolf]) {
      const id = p.place_id || p.name;
      if (golfSeen.has(id)) continue;
      golfSeen.add(id);
      raw.push(p);
    }
    if (__DEV__) {
      console.log(`[GooglePlaces] ${key}: nearby=${nearbyGolf.length} text=${textGolf.length} merged=${raw.length}`);
      console.log(`[GooglePlaces] ${key}: keeping=${JSON.stringify(raw.map((p: any) => p.name))}`);
    }

  } else if (tab === 'do') {
    raw = await nearbysearch(airLat, airLng, 'tourist_attraction', 8000, source);
    if (__DEV__) console.log(`[GooglePlaces] ${key}: raw=${raw.length}`);
  }

  const results = raw
    .map(p => ({ p, s: score(p, airLat, airLng) + (p._fromAirportSearch ? 30 : 0) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, 10)
    .map(({ p }) => toPlace(p, airLat, airLng, tab));

  if (__DEV__) console.log(`[GooglePlaces] ${key}: final=${results.length} results`);
  return results;
}


// ── Shared airport hero image resolver ────────────────────────────────────────
//
// Single source of truth for picking the hero photo on both the map preview
// card and the airport detail screen.  Priority order:
//   1. Dataset heroImage field (hand-curated)
//   2. Google Places textsearch → first result typed as "airport"
//   3. Google Static Maps satellite fallback
//
// Returns a URL string, or null if nothing could be resolved.

export async function fetchAirportHeroPhoto(opts: {
  icao: string;
  lat: number | null | undefined;
  lng: number | null | undefined;
  heroImage?: string | null;
}): Promise<string | null> {
  const { icao, lat, lng, heroImage } = opts;
  const tag = `[AirportHero:${icao}]`;

  // Priority 1: hand-curated image
  if (heroImage) {
    if (__DEV__) console.log(tag, 'using dataset heroImage');
    return heroImage;
  }

  if (!GOOGLE_KEY) {
    if (__DEV__) console.warn(tag, 'no API key — returning null');
    return null;
  }

  if (lat == null || lng == null) {
    if (__DEV__) console.warn(tag, 'no coordinates — returning null');
    return null;
  }

  // Priority 2: Google Places textsearch (only if budget allows)
  if (canCallPlaces('hero_photo', `hero_${icao}`, 'medium')) {
    try {
      const query = `${icao.toUpperCase()} airport`;
      const searchUrl =
        `https://maps.googleapis.com/maps/api/place/textsearch/json` +
        `?query=${encodeURIComponent(query)}` +
        `&location=${lat},${lng}` +
        `&radius=3000` +
        `&key=${GOOGLE_KEY}`;

      const res = await fetch(searchUrl);
      recordPlacesCall('hero_photo', `hero_${icao}`);
      const json = await res.json();
      const candidates = (json.results ?? []) as any[];

      if (__DEV__) {
        const names = candidates.map((r: any) => `"${r.name}" [${(r.types ?? []).join(',')}]`);
        console.log(tag, `textsearch candidates (${names.length}):`, names.join(' | '));
      }

      const airportPlace = candidates.find(
        (r: any) => (r.types ?? []).includes('airport') && r.photos?.length > 0
      );

      if (airportPlace) {
        const photoRef = airportPlace.photos[0].photo_reference;
        const photoUrl =
          `https://maps.googleapis.com/maps/api/place/photo` +
          `?maxwidth=1200&photoreference=${photoRef}&key=${GOOGLE_KEY}`;
        if (__DEV__) console.log(tag, `using Places photo from "${airportPlace.name}"`);
        return photoUrl;
      }

      if (__DEV__) console.log(tag, 'no airport-typed Place with photos — falling back to satellite');
    } catch (err) {
      if (__DEV__) console.warn(tag, 'Places fetch failed — falling back to satellite', err);
    }
  } else {
    if (__DEV__) console.log(tag, 'Places budget exhausted — using satellite fallback (no API cost)');
  }

  // Priority 3: satellite fallback — always available, not a Places call ($0.002 Static Maps)
  const satelliteUrl =
    `https://maps.googleapis.com/maps/api/staticmap` +
    `?center=${lat},${lng}` +
    `&zoom=15&size=1200x630&maptype=satellite` +
    `&key=${GOOGLE_KEY}`;
  return satelliteUrl;
}
