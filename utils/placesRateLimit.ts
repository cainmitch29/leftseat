/**
 * utils/placesRateLimit.ts
 *
 * Centralized rate limiter + observability for Google Places API calls.
 *
 * Limits:
 *   - 30 calls per session (hard cap)
 *   - 12 calls per rolling 60-second window
 *
 * Priority tiers:
 *   - 'high'   — always allowed up to hard cap (essential tab data)
 *   - 'medium' — allowed up to soft cap of 20 (hero photos, enrichment)
 *   - 'low'    — allowed up to soft cap of 20 (place details, optional)
 *
 * After the soft cap (20), only 'high' priority calls go through.
 * This reserves the last 10 calls for essential user-triggered actions.
 */

const SESSION_HARD_CAP = 60;
const SESSION_SOFT_CAP = 40;
const MINUTE_LIMIT = 15;
const MINUTE_MS = 60_000;

export type PlacesPriority = 'high' | 'medium' | 'low';
type Endpoint = 'textsearch' | 'nearbysearch' | 'details' | 'hero_photo';

interface CallRecord {
  ts: number;
  endpoint: Endpoint;
  source: string;
}

let sessionCount = 0;
let blockedCount = 0;
const callLog: CallRecord[] = [];
const sourceCounts: Record<string, number> = {};
const blockedSources: Record<string, number> = {};

/**
 * Check whether a Places API call is allowed.
 * @param priority - 'high' uses hard cap, 'medium'/'low' use soft cap
 */
export function canCallPlaces(endpoint: Endpoint, source: string, priority: PlacesPriority = 'medium'): boolean {
  // Global kill switch — set EXPO_PUBLIC_PLACES_TEST_MODE=true to block ALL live calls
  if (process.env.EXPO_PUBLIC_PLACES_TEST_MODE === 'true') {
    if (__DEV__) console.warn(`[Places:KILLED] ${endpoint} from ${source} — TEST_MODE is ON, all live calls blocked`);
    return false;
  }

  const now = Date.now();
  const recentCount = callLog.filter(r => r.ts >= now - MINUTE_MS).length;

  // Hard cap — blocks everything
  if (sessionCount >= SESSION_HARD_CAP) {
    blockedCount++;
    blockedSources[source] = (blockedSources[source] ?? 0) + 1;
    if (__DEV__) console.warn(`[Places:BLOCKED] ${endpoint} from ${source} — hard session cap (${sessionCount}/${SESSION_HARD_CAP})`);
    return false;
  }

  // Minute cap — blocks everything
  if (recentCount >= MINUTE_LIMIT) {
    blockedCount++;
    blockedSources[source] = (blockedSources[source] ?? 0) + 1;
    if (__DEV__) console.warn(`[Places:BLOCKED] ${endpoint} from ${source} — minute cap (${recentCount}/${MINUTE_LIMIT}/min)`);
    return false;
  }

  // Soft cap — blocks medium/low priority, reserves remaining budget for high priority
  if (sessionCount >= SESSION_SOFT_CAP && priority !== 'high') {
    blockedCount++;
    blockedSources[source] = (blockedSources[source] ?? 0) + 1;
    if (__DEV__) console.warn(`[Places:BLOCKED] ${endpoint} from ${source} — soft cap (${sessionCount}/${SESSION_SOFT_CAP}, priority=${priority}, only 'high' allowed)`);
    return false;
  }

  return true;
}

/** Record that a Places API call was made. */
export function recordPlacesCall(endpoint: Endpoint, source: string) {
  sessionCount++;
  callLog.push({ ts: Date.now(), endpoint, source });
  sourceCounts[source] = (sourceCounts[source] ?? 0) + 1;

  if (__DEV__) {
    const remaining = SESSION_HARD_CAP - sessionCount;
    const softRemaining = SESSION_SOFT_CAP - sessionCount;
    if (remaining <= 5) {
      console.warn(`[Places:${endpoint}] ${source} — call #${sessionCount}/${SESSION_HARD_CAP} (${remaining} left!)`);
    } else if (softRemaining <= 3 && softRemaining > 0) {
      console.warn(`[Places:${endpoint}] ${source} — call #${sessionCount}/${SESSION_HARD_CAP} (soft cap in ${softRemaining})`);
    } else {
      console.log(`[Places:${endpoint}] ${source} — call #${sessionCount}/${SESSION_HARD_CAP}`);
    }
  }
}

/** Print full usage summary (__DEV__ only). */
export function printPlacesUsageSummary() {
  if (!__DEV__) return;
  const now = Date.now();
  const recentCount = callLog.filter(r => r.ts >= now - MINUTE_MS).length;

  console.log('\n══════════════════════════════════════');
  console.log('  GOOGLE PLACES API USAGE SUMMARY');
  console.log('══════════════════════════════════════');
  console.log(`  Session calls:  ${sessionCount} / ${SESSION_HARD_CAP} (soft cap: ${SESSION_SOFT_CAP})`);
  console.log(`  Last 60s:       ${recentCount} / ${MINUTE_LIMIT}`);
  console.log(`  Blocked calls:  ${blockedCount}`);

  const sorted = Object.entries(sourceCounts).sort((a, b) => b[1] - a[1]);
  if (sorted.length > 0) {
    console.log('  CALLS BY SOURCE:');
    for (const [src, count] of sorted) console.log(`    ${count}x  ${src}`);
  }
  const blockedEntries = Object.entries(blockedSources).sort((a, b) => b[1] - a[1]);
  if (blockedEntries.length > 0) {
    console.log('  BLOCKED BY SOURCE:');
    for (const [src, count] of blockedEntries) console.log(`    ${count}x  ${src}`);
  }
  console.log('══════════════════════════════════════\n');
}

/** Get current usage stats. */
export function getPlacesUsage() {
  const now = Date.now();
  const recentCount = callLog.filter(r => r.ts >= now - MINUTE_MS).length;
  return {
    sessionCount, sessionHardCap: SESSION_HARD_CAP, sessionSoftCap: SESSION_SOFT_CAP,
    minuteCount: recentCount, minuteLimit: MINUTE_LIMIT,
    blockedCount, sourceCounts: { ...sourceCounts },
  };
}
