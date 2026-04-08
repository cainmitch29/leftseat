/**
 * utils/flyThisWeekend.ts
 *
 * "Fly This Weekend" AI Planner — powered by Claude.
 *
 * Gathers the user's home airport, cruise speed, current weather,
 * upcoming weekend events, and notable airports within range, then
 * asks Claude to recommend 2–3 destinations for the weekend.
 *
 * The Anthropic API key is stored in EXPO_PUBLIC_ANTHROPIC_KEY.
 * NOTE: For production this should be proxied through a server-side
 * function (Supabase Edge Function) to keep the key out of the bundle.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import airportsData from '../assets/images/airports.json';
import { fetchCuratedEvents } from './gaEvents';

const ANTHROPIC_KEY = process.env.EXPO_PUBLIC_ANTHROPIC_KEY ?? '';

const airports: any[] = (airportsData as any[]).filter(
  a => a.lat != null && a.lng != null && (a.icao || a.faa || a.id)
);

function ident(a: any): string {
  return (a.icao || a.faa || a.id || '').toUpperCase();
}

function distNm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3440.065;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function fetchMetar(icao: string): Promise<string> {
  try {
    const res = await fetch(
      `https://tgftp.nws.noaa.gov/data/observations/metar/stations/${icao.toUpperCase()}.TXT`,
      { signal: AbortSignal.timeout(4000) }
    );
    const text = await res.text();
    const lines = text.trim().split('\n');
    return lines[1] ?? '';
  } catch {
    return '';
  }
}

function flightCat(metar: string): string {
  if (!metar) return 'Unknown';
  const m = metar.toUpperCase();
  const ceilMatch = [...m.matchAll(/(OVC|BKN)(\d{3})/g)];
  const ceiling = ceilMatch.length
    ? Math.min(...ceilMatch.map(c => Number(c[2]) * 100))
    : Infinity;
  const visMatch = m.match(/(P?\d+(?:\/\d+)?)SM/);
  let vis = Infinity;
  if (visMatch) {
    const tok = visMatch[1];
    if (tok.startsWith('P')) vis = 10;
    else if (tok.includes('/')) { const [n, d] = tok.split('/').map(Number); vis = n / d; }
    else vis = Number(tok) || Infinity;
  }
  if (ceiling < 500 || vis < 1) return 'LIFR';
  if (ceiling < 1000 || vis < 3) return 'IFR';
  if (ceiling <= 3000 || vis <= 5) return 'MVFR';
  return 'VFR';
}

function getWeekendDates(): { satStr: string; sunStr: string } {
  const today = new Date();
  const day = today.getDay(); // 0=Sun, 6=Sat
  const daysToSat = day === 6 ? 0 : (6 - day);
  const sat = new Date(today);
  sat.setDate(today.getDate() + daysToSat);
  const sun = new Date(sat);
  sun.setDate(sat.getDate() + 1);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { satStr: fmt(sat), sunStr: fmt(sun) };
}

export interface WeekendDestination {
  icao: string;
  name: string;
  city: string;
  state: string;
  distance_nm: number;
  why: string;
  highlight: string;
}

export interface FlyThisWeekendResult {
  destinations: WeekendDestination[];
  homeIcao: string;
  homeName: string;
  generatedAt: string;
}

export async function generateWeekendPlan(userId: string | undefined): Promise<FlyThisWeekendResult> {
  if (!ANTHROPIC_KEY) throw new Error('Anthropic API key not configured. Add EXPO_PUBLIC_ANTHROPIC_KEY to your .env file.');

  // ── 1. Load user profile ──────────────────────────────────────────────────
  let homeIcao = '';
  let cruiseKts = 120;
  try {
    const raw = await AsyncStorage.getItem(`userProfile:${userId ?? 'guest'}`);
    if (raw) {
      const p = JSON.parse(raw);
      if (p.home_airport) homeIcao = p.home_airport.toUpperCase();
      if (p.cruise_speed) cruiseKts = Math.max(60, Number(p.cruise_speed));
    }
  } catch {}

  // ── 2. Resolve home airport coords ───────────────────────────────────────
  const homeApt = airports.find(a => ident(a) === homeIcao);
  if (!homeApt) throw new Error('Set a home airport in your profile first.');

  const { lat: homeLat, lng: homeLng, name: homeName, city: homeCity, state: homeState } = homeApt;

  // ── 3. Current weather at home ────────────────────────────────────────────
  const metar = await fetchMetar(homeIcao);
  const cat = flightCat(metar);

  // ── 4. Compute comfortable range (2.5 hr cruise) ─────────────────────────
  const rangeNm = Math.round(cruiseKts * 2.5);

  // ── 5. Weekend events within range ────────────────────────────────────────
  const { satStr, sunStr } = getWeekendDates();
  const allEvents = fetchCuratedEvents();
  const weekendEvents = allEvents
    .filter(e => e.start_date >= satStr && e.start_date <= sunStr)
    .map(e => ({ ...e, _nm: distNm(homeLat, homeLng, e.lat ?? homeLat, e.lng ?? homeLng) }))
    .filter(e => e._nm <= rangeNm)
    .sort((a, b) => a._nm - b._nm)
    .slice(0, 8);

  // ── 6. Notable airports within range ─────────────────────────────────────
  const nearbyApts = airports
    .map(a => ({ ...a, _nm: distNm(homeLat, homeLng, a.lat, a.lng) }))
    .filter(a => a._nm >= 30 && a._nm <= rangeNm && ident(a) !== homeIcao)
    .sort((a, b) => a._nm - b._nm)
    .slice(0, 40);

  // Pick the most interesting ones (fuel + tower, or known names)
  const interestingApts = nearbyApts
    .filter(a => a.has_fuel || a.has_tower?.startsWith('ATCT') || a.heroImage)
    .slice(0, 20);

  // ── 7. Build Claude prompt ────────────────────────────────────────────────
  const eventBlock = weekendEvents.length > 0
    ? weekendEvents.map(e =>
        `- ${e.event_name} at ${e.nearest_airport} (${e.city}, ${e.state}) — ${Math.round(e._nm)} nm — ${e.category}`
      ).join('\n')
    : 'No fly-ins or events found within range this weekend.';

  const aptBlock = interestingApts
    .map(a => {
      const tags = [
        a.has_fuel ? 'fuel' : '',
        a.has_tower?.startsWith('ATCT') ? 'tower' : '',
        a.heroImage ? 'scenic' : '',
      ].filter(Boolean).join(', ');
      return `- ${ident(a)} · ${a.name} · ${a.city}, ${a.state} · ${Math.round(a._nm)} nm${tags ? ` (${tags})` : ''}`;
    })
    .join('\n');

  const prompt = `You are a GA pilot trip planner for the LeftSeat aviation app. Your job is to recommend 2–3 great weekend flying destinations based on the data below.

HOME AIRPORT: ${homeIcao} — ${homeName}, ${homeCity}, ${homeState}
CURRENT WEATHER AT HOME: ${cat}${metar ? ` (${metar.slice(0, 60)}...)` : ''}
PILOT CRUISE SPEED: ${cruiseKts} kts
COMFORTABLE RANGE: ${rangeNm} nm each way
WEEKEND: ${satStr} – ${sunStr}

WEEKEND EVENTS WITHIN RANGE:
${eventBlock}

NOTABLE AIRPORTS WITHIN RANGE (icao · name · city · distance):
${aptBlock}

INSTRUCTIONS:
- Recommend 2–3 destinations. Prioritize: weekend events first, then scenic or fuel stops if no events.
- If weather at home is IFR or LIFR, acknowledge the conditions and suggest destinations that are worth the wait or a short drive instead.
- Each "why" should be 1–2 punchy sentences a pilot would love — mention the event, food, scenery, or fun factor.
- Keep "highlight" to 3–5 words (e.g. "Pancake Breakfast Fly-In", "Scenic Mountain Strip", "Waterfront FBO").
- Only recommend airports from the data above. Use exact ICAO codes.

Respond with ONLY valid JSON — no markdown, no explanation:
{
  "destinations": [
    {
      "icao": "KABC",
      "name": "Full Airport Name",
      "city": "City",
      "state": "ST",
      "distance_nm": 85,
      "why": "One to two sentence reason why this is a great pick this weekend.",
      "highlight": "Short tagline"
    }
  ]
}`;

  // ── 8. Call Claude ────────────────────────────────────────────────────────
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) throw new Error(`Claude API error: ${res.status}`);
  const json = await res.json();
  const text: string = json.content?.[0]?.text ?? '';

  // ── 9. Parse response ─────────────────────────────────────────────────────
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Could not parse Claude response');
  const parsed = JSON.parse(jsonMatch[0]);
  if (!Array.isArray(parsed.destinations)) throw new Error('Unexpected response shape');

  return {
    destinations: parsed.destinations.slice(0, 3),
    homeIcao,
    homeName: homeName || homeIcao,
    generatedAt: new Date().toISOString(),
  };
}
