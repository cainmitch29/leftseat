/**
 * utils/overpassPlaces.ts
 *
 * Fetches nearby places from OpenStreetMap via the free Overpass API.
 * Returns data in the same shape that PlaceCard expects, so no UI changes needed.
 *
 * Categories → OSM tags queried:
 *   Eat   → amenity: restaurant | cafe | pub | bar
 *   Stay  → tourism: hotel | motel | hostel | guest_house  +  amenity: hotel
 *   Golf  → leisure: golf_course  (filters out mini golf)
 *   Do    → tourism: attraction | museum | viewpoint | art_gallery | theme_park
 *            historic: *
 *            amenity: theatre | cinema | arts_centre
 *
 * No API key required. Rate-limit-friendly: 4 parallel requests max.
 */

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const RADIUS_M = 8000; // 8 km ≈ 5 miles
const GOLF_RADIUS_M = 12000; // 12 km ≈ 7.5 miles (golf courses spread out more)
const MAX_RESULTS = 10;

// ─── Distance helper (haversine, statute miles) ──────────────────────────────

function distMiles(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
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

// ─── OSM element → place object ──────────────────────────────────────────────

function elCoords(el: any): { lat: number; lng: number } {
  return {
    lat: el.lat ?? el.center?.lat ?? 0,
    lng: el.lon ?? el.center?.lon ?? 0,
  };
}

function buildAddress(tags: Record<string, string>): string {
  return [tags['addr:housenumber'], tags['addr:street'], tags['addr:city']]
    .filter(Boolean)
    .join(' ')
    .trim();
}

function toPlace(el: any, airLat: number, airLng: number, typeLabel: string): any {
  const { lat, lng } = elCoords(el);
  const tags: Record<string, string> = el.tags ?? {};
  const dm = Math.round(distMiles(airLat, airLng, lat, lng) * 10) / 10;
  const address = buildAddress(tags);
  return {
    name: tags.name || 'Unnamed place',
    type: typeLabel,
    rating: '',                                         // OSM has no star ratings
    distance: address || `${dm} mi from field`,
    distanceMiles: dm,
    open: undefined,                                    // OSM hours parsing skipped
    lat,
    lng,
    placeId: null,                                      // no Google place_id
    photoRef: null,                                     // no Google photo ref
    phone: tags['contact:phone'] ?? tags.phone ?? null,
    website: tags.website ?? tags['contact:website'] ?? null,
    address,
  };
}

// ─── Overpass API call ───────────────────────────────────────────────────────

async function overpass(query: string): Promise<any[]> {
  try {
    const res = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
    });
    if (!res.ok) return [];
    const json = await res.json();
    // Only keep elements that have a name tag
    return (json.elements ?? []).filter((el: any) => el.tags?.name);
  } catch {
    return [];
  }
}

// ─── Sort by distance from airport ───────────────────────────────────────────

function sortByDist(els: any[], airLat: number, airLng: number): any[] {
  return [...els].sort((a, b) => {
    const ca = elCoords(a);
    const cb = elCoords(b);
    return distMiles(airLat, airLng, ca.lat, ca.lng) - distMiles(airLat, airLng, cb.lat, cb.lng);
  });
}

// ─── Known fast-food / casual-dining chains to filter from restaurant results ──

const FOOD_CHAIN_LOWER = [
  // Fast food
  'mcdonald', 'burger king', 'wendy', 'taco bell', 'kfc', 'arby', 'subway',
  'pizza hut', 'domino', 'papa john', 'dairy queen', 'sonic', 'chick-fil-a',
  'starbucks', 'dunkin', 'panera', 'chipotle', 'five guys', 'waffle house',
  'little caesar', 'panda express', 'popeye', 'jack in the box', 'white castle',
  'whataburger', 'checkers', 'del taco', 'shake shack', 'jersey mike',
  'jimmy john', 'wingstop', 'raising cane', 'zaxby', 'culver',
  // Casual dining chains
  'applebee', "chili's", 'chilis', 'buffalo wild wing', 'cracker barrel',
  'ihop', 'denny', 'olive garden', 'red lobster', 'longhorn steakhouse',
  'outback steakhouse', 'texas roadhouse', 'cheesecake factory', 'ruby tuesday',
  'bob evans', 'perkins', 'golden corral',
];

function isFoodChain(name: string): boolean {
  const lower = name.toLowerCase();
  return FOOD_CHAIN_LOWER.some(c => lower.includes(c));
}

// ─── Mini-golf terms (exclude from golf tab) ──────────────────────────────────

const MINI_GOLF_TERMS = ['mini golf', 'miniature golf', 'mini-golf', 'putt putt', 'putt-putt'];
function isMiniGolf(name: string): boolean {
  const lower = name.toLowerCase();
  return MINI_GOLF_TERMS.some(t => lower.includes(t));
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function fetchOverpassPlaces(
  airLat: number,
  airLng: number,
  icao = 'UNKN',
): Promise<{ restaurants: any[]; hotels: any[]; golf: any[]; things: any[] }> {
  const [rawFood, rawStay, rawGolf, rawDo] = await Promise.all([

    // ── Eat ──────────────────────────────────────────────────────────────────
    overpass(
      `[out:json][timeout:15];\n(\n` +
      `  node["amenity"~"^(restaurant|cafe|pub|bar)$"](around:${RADIUS_M},${airLat},${airLng});\n` +
      `  way["amenity"~"^(restaurant|cafe|pub|bar)$"](around:${RADIUS_M},${airLat},${airLng});\n` +
      `);\nout center ${MAX_RESULTS * 3};`
    ),

    // ── Stay ─────────────────────────────────────────────────────────────────
    overpass(
      `[out:json][timeout:15];\n(\n` +
      `  node["tourism"~"^(hotel|motel|hostel|guest_house)$"](around:${RADIUS_M},${airLat},${airLng});\n` +
      `  way["tourism"~"^(hotel|motel|hostel|guest_house)$"](around:${RADIUS_M},${airLat},${airLng});\n` +
      `  node["amenity"="hotel"](around:${RADIUS_M},${airLat},${airLng});\n` +
      `  way["amenity"="hotel"](around:${RADIUS_M},${airLat},${airLng});\n` +
      `);\nout center ${MAX_RESULTS * 2};`
    ),

    // ── Golf ─────────────────────────────────────────────────────────────────
    overpass(
      `[out:json][timeout:15];\n(\n` +
      `  node["leisure"="golf_course"](around:${GOLF_RADIUS_M},${airLat},${airLng});\n` +
      `  way["leisure"="golf_course"](around:${GOLF_RADIUS_M},${airLat},${airLng});\n` +
      `  relation["leisure"="golf_course"](around:${GOLF_RADIUS_M},${airLat},${airLng});\n` +
      `);\nout center 10;`
    ),

    // ── Do ───────────────────────────────────────────────────────────────────
    overpass(
      `[out:json][timeout:15];\n(\n` +
      `  node["tourism"~"^(attraction|museum|viewpoint|art_gallery|theme_park)$"](around:${RADIUS_M},${airLat},${airLng});\n` +
      `  way["tourism"~"^(attraction|museum|viewpoint|art_gallery|theme_park)$"](around:${RADIUS_M},${airLat},${airLng});\n` +
      `  node["historic"](around:${RADIUS_M},${airLat},${airLng});\n` +
      `  way["historic"](around:${RADIUS_M},${airLat},${airLng});\n` +
      `  node["amenity"~"^(theatre|cinema|arts_centre)$"](around:${RADIUS_M},${airLat},${airLng});\n` +
      `  way["amenity"~"^(theatre|cinema|arts_centre)$"](around:${RADIUS_M},${airLat},${airLng});\n` +
      `);\nout center ${MAX_RESULTS * 3};`
    ),
  ]);

  // Restaurants — filter chains, sort by distance, take top MAX_RESULTS
  const rawFoodNamed = rawFood;
  const foodChainCount = rawFoodNamed.filter(el => isFoodChain(el.tags?.name ?? '')).length;
  const restaurants = sortByDist(
    rawFoodNamed.filter(el => !isFoodChain(el.tags?.name ?? '')),
    airLat, airLng,
  ).slice(0, MAX_RESULTS).map(el => toPlace(el, airLat, airLng, 'restaurant'));
  if (__DEV__) console.log(`[Overpass ${icao}] restaurants: raw=${rawFoodNamed.length}, chains filtered=${foodChainCount}, local=${restaurants.length}`);

  // Hotels — sort by distance, deduplicate by name, take top MAX_RESULTS
  const hotelSeen = new Set<string>();
  const hotels = sortByDist(rawStay, airLat, airLng)
    .filter(el => {
      if (hotelSeen.has(el.tags?.name)) return false;
      hotelSeen.add(el.tags?.name);
      return true;
    })
    .slice(0, MAX_RESULTS)
    .map(el => toPlace(el, airLat, airLng, 'hotel'));
  if (__DEV__) console.log(`[Overpass ${icao}] hotels: raw=${rawStay.length}, local=${hotels.length}`);

  // Golf — filter mini golf, sort by distance, take top 5
  const golfMiniCount = rawGolf.filter(el => isMiniGolf(el.tags?.name ?? '')).length;
  const golf = sortByDist(
    rawGolf.filter(el => !isMiniGolf(el.tags?.name ?? '')),
    airLat, airLng,
  ).slice(0, 5).map(el => toPlace(el, airLat, airLng, 'golf course'));
  if (__DEV__) console.log(`[Overpass ${icao}] golf: raw=${rawGolf.length}, mini filtered=${golfMiniCount}, local=${golf.length}`);

  // Things — deduplicate by name, sort by distance, take top MAX_RESULTS
  const thingSeen = new Set<string>();
  const things = sortByDist(rawDo, airLat, airLng)
    .filter(el => {
      if (thingSeen.has(el.tags?.name)) return false;
      thingSeen.add(el.tags?.name);
      return true;
    })
    .slice(0, MAX_RESULTS)
    .map(el => toPlace(el, airLat, airLng, 'attraction'));
  if (__DEV__) console.log(`[Overpass ${icao}] things: raw=${rawDo.length}, local=${things.length}`);

  return { restaurants, hotels, golf, things };
}
