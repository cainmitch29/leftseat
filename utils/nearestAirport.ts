/**
 * utils/nearestAirport.ts
 *
 * Finds the nearest ICAO-identified public-use airport from the local airports
 * dataset given a pair of coordinates.  Used to validate event-to-airport
 * assignments and to auto-compute nearest_airport for new events.
 *
 * ─── Usage ───────────────────────────────────────────────────────────────────
 *
 *  // Find nearest airport to an event
 *  const match = findNearestAirport(38.708, -91.440);
 *  // → { icao: 'K3H4', distanceNm: 1.2, verified: true, ... }
 *
 *  // Audit all curated events in __DEV__
 *  import { auditEventAirports } from './nearestAirport';
 *  import { CURATED_EVENTS } from './gaEvents';
 *  auditEventAirports(CURATED_EVENTS);
 */

import allAirports from '../assets/images/airports.json';

/**
 * Events whose nearest airport is beyond this threshold (nm) are flagged as
 * needing manual review.  35 nm is roughly a 20-minute flight — if the closest
 * airport is further than that, the assignment is likely wrong or there is a
 * closer private/unlisted field worth investigating.
 */
export const VERIFIED_THRESHOLD_NM = 35;

export interface AirportMatch {
  icao: string;
  name: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  distanceNm: number;
  /** true when distanceNm < VERIFIED_THRESHOLD_NM — safe to auto-assign */
  verified: boolean;
}

function haversineNm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3440.065;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Returns the nearest ICAO-identified airport to the given coordinates.
 * Only airports with an ICAO code are considered (public-use airports).
 */
export function findNearestAirport(eventLat: number, eventLng: number): AirportMatch | null {
  const airports = (allAirports as any[]).filter(
    a => a.icao && a.lat != null && a.lng != null
  );

  let best: any = null;
  let bestDist = Infinity;

  for (const a of airports) {
    const d = haversineNm(eventLat, eventLng, a.lat, a.lng);
    if (d < bestDist) {
      bestDist = d;
      best = a;
    }
  }

  if (!best) return null;

  return {
    icao: best.icao,
    name: best.name || '',
    city: best.city || '',
    state: best.state || '',
    lat: best.lat,
    lng: best.lng,
    distanceNm: Math.round(bestDist * 10) / 10,
    verified: bestDist < VERIFIED_THRESHOLD_NM,
  };
}

/**
 * Audit helper — call in __DEV__ to surface any curated event whose stored
 * nearest_airport does not match the computed nearest airport, or whose
 * computed nearest airport is beyond VERIFIED_THRESHOLD_NM.
 *
 * Logs each issue to the console with a ⚠ marker.
 * Returns the list of issue strings (empty = all clear).
 *
 * Example:
 *   import { CURATED_EVENTS } from './gaEvents';
 *   import { auditEventAirports } from './nearestAirport';
 *   auditEventAirports(CURATED_EVENTS);   // run once in a useEffect in DEV
 */
export function auditEventAirports(
  events: Array<{
    id: string;
    event_name: string;
    event_lat: number;
    event_lng: number;
    nearest_airport: string;
    airport_verified: boolean;
  }>
): string[] {
  const issues: string[] = [];

  for (const e of events) {
    const match = findNearestAirport(e.event_lat, e.event_lng);
    if (!match) {
      issues.push(`${e.id}: no airport found in dataset`);
      continue;
    }

    const icaoMismatch = match.icao !== e.nearest_airport;
    const tooFar = match.distanceNm >= VERIFIED_THRESHOLD_NM;
    const unverified = !e.airport_verified;

    if (icaoMismatch || tooFar || unverified) {
      issues.push(
        `${e.id} "${e.event_name}":` +
        ` stored=${e.nearest_airport}` +
        ` nearest=${match.icao} (${match.distanceNm} nm)` +
        (icaoMismatch ? ' ⚠ MISMATCH' : '') +
        (tooFar       ? ' ⚠ TOO FAR'  : '') +
        (unverified   ? ' ⚠ UNVERIFIED' : '')
      );
    }
  }

  if (issues.length === 0) {
    console.log('[AirportAudit] All curated events look good ✓');
  } else {
    console.warn(`[AirportAudit] ${issues.length} issue(s) found:`);
    issues.forEach(i => console.warn('  •', i));
  }

  return issues;
}
