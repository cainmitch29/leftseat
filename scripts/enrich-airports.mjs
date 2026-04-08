/**
 * enrich-airports.mjs
 *
 * Adds nearestFoodNm, nearestHotelNm, nearestGolfNm, nearestAttractionNm
 * to every airport in airports.json via Google Places Nearby Search.
 *
 * Usage:
 *   node scripts/enrich-airports.mjs            # enrich only missing fields
 *   node scripts/enrich-airports.mjs --regolf   # clear + re-enrich nearestGolfNm
 *                                               # with the strict golf_course filter
 *
 * Resumes automatically if interrupted — already-enriched fields are skipped.
 * Progress is printed every 50 airports.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const AIRPORTS_PATH = path.join(__dirname, '../assets/images/airports.json');
const API_KEY       = process.env.EXPO_PUBLIC_GOOGLE_API_KEY;
const CONCURRENCY   = 5;
const DELAY_MS      = 120;

// ── Golf filter — must match isRealOperatingGolf in airport.tsx ───────────────
const MINI_GOLF_TERMS    = ['mini golf', 'miniature golf', 'mini-golf', 'putt putt', 'putt-putt', 'adventure golf'];
const NON_GOLF_TYPES     = new Set([
  'bowling_alley', 'mini_golf', 'sports_complex', 'gym', 'fitness_center',
  'park', 'amusement_center', 'amusement_park', 'store', 'school', 'event_venue',
]);
const GOLF_SKIP_NAMES    = ['golf cart', 'cart rental', 'cart sales', 'golf simulator',
  'golf supply', 'golf shop', 'golf academy', 'golf school', 'driving range only'];
// 'course' and 'club' alone are too broad (matches "training course", "nightclub", etc.)
const GOLF_NAME_KEYWORDS = ['golf', 'country club', 'links', 'fairway', 'greens'];

function isRealGolf(place) {
  const name   = (place.name || '').toLowerCase();
  const types  = place.types || [];
  const status = place.business_status || '';

  if (status && status !== 'OPERATIONAL') return false;
  if (types.some(t => NON_GOLF_TYPES.has(t))) return false;
  if (MINI_GOLF_TERMS.some(t => name.includes(t))) return false;
  if (GOLF_SKIP_NAMES.some(t => name.includes(t))) return false;

  const hasGolfType = types.includes('golf_course');
  const hasGolfName = GOLF_NAME_KEYWORDS.some(t => name.includes(t));
  return hasGolfType || hasGolfName;
}

// ── Categories ────────────────────────────────────────────────────────────────
// Golf radius = 5 nm * 1852 m/nm ≈ 9260 m, matching the map filter threshold.
const CATEGORIES = [
  { field: 'nearestFoodNm',       param: 'type=restaurant',         radius: 6000  },
  { field: 'nearestHotelNm',      param: 'type=lodging',            radius: 10000 },
  { field: 'nearestGolfNm', param: 'keyword=golf+course', radius: 9260, filterFn: isRealGolf,
    nameField: 'nearestGolfName', miField: 'nearestGolfDistanceMi', placeIdField: 'nearestGolfPlaceId' },
  { field: 'nearestAttractionNm', param: 'type=tourist_attraction', radius: 10000 },
];

// ── Haversine ─────────────────────────────────────────────────────────────────
function distNm(lat1, lng1, lat2, lng2) {
  const R    = 3440.065;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a    = Math.sin(dLat / 2) ** 2
             + Math.cos(lat1 * Math.PI / 180)
             * Math.cos(lat2 * Math.PI / 180)
             * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const NM_TO_MI = 1.15078;  // 1 nm = 1.15078 statute miles

// Returns { nm, mi, name, placeId } for the nearest qualifying place, or null.
// Both nm and mi are derived from the same raw haversine value to avoid
// rounding discrepancies when the two units are displayed side-by-side.
async function nearestPlace(lat, lng, param, radius, filterFn) {
  const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json`
    + `?location=${lat},${lng}&radius=${radius}&${param}&key=${API_KEY}`;

  const res  = await fetch(url);
  const data = await res.json();

  if (!data.results?.length) return null;

  const candidates = filterFn ? data.results.filter(filterFn) : data.results;

  let minRaw = Infinity;
  let winner  = null;
  for (const place of candidates) {
    const d = distNm(lat, lng, place.geometry.location.lat, place.geometry.location.lng);
    if (d >= 0.1 && d < minRaw) { minRaw = d; winner = place; }
  }
  if (!winner) return null;

  return {
    nm:      Math.round(minRaw * 10) / 10,
    mi:      Math.round(minRaw * NM_TO_MI * 10) / 10,   // 1-decimal miles — matches Golf tab display
    name:    winner.name,
    placeId: winner.place_id || null,
  };
}

// Per-field enrichment — skips fields already present
async function enrichAirport(airport) {
  const { lat, lng } = airport;
  await Promise.all(CATEGORIES.map(async ({ field, param, radius, filterFn, nameField, miField, placeIdField }) => {
    if (airport[field] !== undefined) return;
    const result = await nearestPlace(lat, lng, param, radius, filterFn);
    airport[field] = result ? result.nm : null;
    if (nameField)    airport[nameField]    = result ? result.name    : null;
    if (miField)      airport[miField]      = result ? result.mi      : null;
    if (placeIdField) airport[placeIdField] = result ? result.placeId : null;
  }));
}

async function runBatch(airports, indices) {
  await Promise.all(indices.map(i => enrichAirport(airports[i])));
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  const reGolf = process.argv.includes('--regolf');

  console.log(`Loading airports from ${AIRPORTS_PATH}…`);
  const airports = JSON.parse(fs.readFileSync(AIRPORTS_PATH, 'utf8'));

  if (reGolf) {
    const cleared = airports.filter(a => a.nearestGolfNm !== undefined).length;
    airports.forEach(a => { delete a.nearestGolfNm; delete a.nearestGolfName; delete a.nearestGolfDistanceMi; delete a.nearestGolfPlaceId; });
    console.log(`--regolf: cleared nearestGolfNm/Name on ${cleared} airports`);
  }

  const todo = airports
    .map((a, i) => ({ a, i }))
    .filter(({ a }) =>
      a.nearestFoodNm       === undefined ||
      a.nearestHotelNm      === undefined ||
      a.nearestGolfNm       === undefined ||
      a.nearestAttractionNm === undefined
    );

  console.log(`${airports.length} total airports, ${todo.length} need enrichment, ${airports.length - todo.length} already done.`);

  if (todo.length === 0) {
    console.log('Nothing to do!');
    return;
  }

  let done = 0;
  const startTime = Date.now();

  for (let b = 0; b < todo.length; b += CONCURRENCY) {
    const batch   = todo.slice(b, b + CONCURRENCY);
    const indices = batch.map(({ i }) => i);

    await runBatch(airports, indices);

    done += batch.length;

    if (done % 50 === 0 || done === todo.length) {
      const elapsed   = (Date.now() - startTime) / 1000;
      const rate      = done / elapsed;
      const remaining = Math.round((todo.length - done) / rate);
      console.log(`[${done}/${todo.length}] ${rate.toFixed(1)}/s — ~${remaining}s remaining`);
      fs.writeFileSync(AIRPORTS_PATH, JSON.stringify(airports, null, 2));
    }

    if (b + CONCURRENCY < todo.length) await sleep(DELAY_MS);
  }

  fs.writeFileSync(AIRPORTS_PATH, JSON.stringify(airports, null, 2));
  console.log(`\nDone! airports.json updated.`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
