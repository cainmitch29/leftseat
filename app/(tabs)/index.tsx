/**
 * app/(tabs)/index.tsx  ·  Discover
 *
 * Activity-first destination discovery screen.
 * The core unit is a *place* (restaurant, golf course, park, hotel) with the
 * serving airport attached — not just an airport.
 *
 * Sections:
 *   🍽  Fly for Food
 *   ⛳  Golf Getaways
 *   🌲  Parks & Outdoors
 *   🏨  Weekend Escapes
 *   ✈️  Short Flights
 *   🎲  Surprise Me
 *
 * Dedicated components (do not import into Map tab):
 *   DiscoverSection, DiscoverDestinationCard, DiscoverCategoryChip
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  FlatList,
  Image,
  Keyboard,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import allAirports from '../../assets/images/airports.json';
import SurpriseMe from '../../components/SurpriseMe';
import FlyThisTrip from '../../components/FlyThisTrip';
import { GOOGLE_KEY } from '../../utils/config';
import { getCachedCategory, setCachedCategory } from '../../utils/placesCache';
import { canCallPlaces, recordPlacesCall } from '../../utils/placesRateLimit';
import { isFoodChain } from '../../utils/googlePlaces';
import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { GlassSearchBar } from '../../components/GlassSearchBar';
import { getFeatureDayKey } from '../../utils/featureDay';
import { fetchCuratedEvents, CuratedEvent } from '../../utils/gaEvents';
import { saveDestination, unsaveDestination, getSavedDestinations } from '../../utils/bucketListStorage';

// ── Design tokens ──────────────────────────────────────────────────────────────
import { ORANGE, SKY, BORDER, TEXT1, TEXT2, TEXT3 } from '../../constants/theme';
const BG       = '#050A12';   // deep space — bottom of screen gradient
const SURFACE  = 'rgba(12,18,32,0.88)';   // glass card — gradient bleeds through
const SURFACE2 = '#0D1628';

const { width: SW } = Dimensions.get('window');
const CARD_W  = 220;
const CARD_H  = 310;  // fixed height — all destination cards uniform
const IMG_H   = 156;  // hero image height
const CRUISE = 150; // kts
const PBASE  = 'https://maps.googleapis.com/maps/api/place';

// Bump this when FOOD_CHAINS_LOWER changes so cached snapshots with un-filtered
// chain restaurants are automatically discarded and rebuilt.
const CHAIN_FILTER_VERSION = 5; // bumped: limit live fetches per rebuild, cache-first approach

// ── Types ─────────────────────────────────────────────────────────────────────

type DestCat = 'food' | 'golf' | 'dog' | 'park' | 'hotel' | 'short';

// Category icons rendered as components (no emoji)
function CatIcon({ cat, size, color }: { cat: DestCat; size: number; color: string }) {
  if (cat === 'food')  return <MaterialCommunityIcons name="silverware-fork-knife" size={size} color={color} />;
  if (cat === 'golf')  return <MaterialCommunityIcons name="golf" size={size} color={color} />;
  if (cat === 'park')  return <MaterialCommunityIcons name="tree" size={size} color={color} />;
  if (cat === 'hotel') return <MaterialCommunityIcons name="bed" size={size} color={color} />;
  if (cat === 'short') return <MaterialCommunityIcons name="airplane" size={size} color={color} />;
  if (cat === 'dog')   return <MaterialCommunityIcons name="dog-side" size={size} color={color} />;
  return null;
}
const CAT_LABEL: Record<DestCat, string> = {
  food: 'Food', golf: 'Golf', dog: 'Dog Friendly', park: 'Outdoors', hotel: 'Stay', short: 'Short Hop',
};
const CAT_COLORS: Record<DestCat, [string, string]> = {
  food:  ['#0F0A04', '#1A0D06'],
  golf:  ['#040F08', '#081408'],
  dog:   ['#04100E', '#081410'],
  park:  ['#0D0A04', '#150F06'],
  hotel: ['#08060F', '#0F0A1A'],
  short: ['#04080F', '#070F1A'],
};

// Chip color per category — vivid accent on dark tint
const CAT_CHIP: Record<DestCat, { bg: string; border: string }> = {
  food:  { bg: 'rgba(255,98,0,0.85)',   border: 'rgba(255,98,0,0.4)' },
  golf:  { bg: 'rgba(5,150,105,0.85)',  border: 'rgba(5,150,105,0.4)' },
  dog:   { bg: 'rgba(13,148,136,0.85)', border: 'rgba(13,148,136,0.4)' },
  park:  { bg: 'rgba(180,83,9,0.85)',   border: 'rgba(180,83,9,0.4)' },
  hotel: { bg: 'rgba(124,58,237,0.85)', border: 'rgba(124,58,237,0.4)' },
  short: { bg: 'rgba(2,132,199,0.85)',  border: 'rgba(2,132,199,0.4)' },
};
// Airport detail tab to open when a card is tapped
const CAT_TAB: Partial<Record<DestCat, string>> = {
  food: 'eat', golf: 'golf', dog: 'info', park: 'do', hotel: 'stay',
};

interface Airport {
  id: string; icao?: string | null; faa?: string | null;
  name: string; city: string; state: string;
  lat: number; lng: number; fuel?: string | null; elevation?: number | null;
  runways?: any[];
  nearestFoodNm?: number | null; nearestHotelNm?: number | null;
  nearestGolfNm?: number | null; nearestGolfName?: string | null;
  nearestGolfDistanceMi?: number | null; nearestGolfPlaceId?: string | null;
  nearestAttractionNm?: number | null;
}

interface DestCard {
  key: string;
  placeName: string;
  cat: DestCat;
  distMi: number | null;    // ground distance from airport → place
  photoUri: string | null;
  apt: Airport;
  flightNm: number;
  flightFmt: string;
  amenityTags?: string[];
}

const airports = allAirports as unknown as Airport[];

// ── Helpers ───────────────────────────────────────────────────────────────────

function aptIdent(a: Airport): string {
  return (a.icao || a.faa || a.id).toUpperCase();
}

function distNm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3440.065;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function fmtFlight(nm: number, cruiseKts: number = CRUISE): string {
  const min = Math.round((nm / cruiseKts) * 60 + Math.min(nm * 0.15, 25));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

const SATELLITE_FALLBACK = (lat: number, lng: number) =>
  GOOGLE_KEY ? `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=12&size=800x400&maptype=hybrid&style=feature:poi|visibility:off&key=${GOOGLE_KEY}` : null;

/**
 * Get a photo for a Discover card. Checks Supabase cache first (free),
 * then makes ONE live nearbysearch if no cache exists (costs 1 API call,
 * result cached for 7 days so it never fires again for this airport).
 * Falls back to satellite tile if rate-limited or no results.
 */
// Track how many live fetches we've done this build cycle so we don't
// blow through the budget on a single Discover rebuild.
let _discoverLiveFetches = 0;
const DISCOVER_LIVE_FETCH_LIMIT = 8; // max live API calls per rebuild

async function getCardPhoto(
  icao: string, lat: number, lng: number,
  cacheCategory: 'restaurants' | 'hotels' | 'golf' | 'things',
  placeType: string, source: string,
): Promise<{ photoUri: string | null; placeName: string | null }> {
  // 1. Check cache — FREE, no API cost
  try {
    const cached = await getCachedCategory(icao, cacheCategory);
    if (cached && cached.length > 0) {
      const best = cacheCategory === 'restaurants'
        ? (cached.find((p: any) => !isFoodChain(p.name ?? '')) ?? cached[0])
        : cached[0];
      if (best?.photoRef) {
        if (__DEV__) console.log(`[CardPhoto] ${icao}/${cacheCategory} — cache HIT with photo`);
        return { photoUri: placPhotoUrl(best.photoRef), placeName: best.name ?? null };
      }
      if (best?.name) {
        if (__DEV__) console.log(`[CardPhoto] ${icao}/${cacheCategory} — cache HIT but no photo, name="${best.name}"`);
        return { photoUri: SATELLITE_FALLBACK(lat, lng), placeName: best.name };
      }
    }
  } catch {}

  // 2. One live fetch — limited per rebuild + rate-limited globally
  if (GOOGLE_KEY && _discoverLiveFetches < DISCOVER_LIVE_FETCH_LIMIT) {
    try {
      const allowed = canCallPlaces('nearbysearch', source, 'low');
      if (__DEV__) console.log(`[CardPhoto] ${icao}/${cacheCategory} — cache MISS, live fetch ${allowed ? 'ALLOWED' : 'BLOCKED'} (${_discoverLiveFetches}/${DISCOVER_LIVE_FETCH_LIMIT})`);
      if (allowed) {
        _discoverLiveFetches++;
        const res = await fetch(
          `${PBASE}/nearbysearch/json?location=${lat},${lng}&radius=5000&type=${placeType}&key=${GOOGLE_KEY}`
        );
        const d = await res.json();
        recordPlacesCall('nearbysearch', source);
        const results = d.results ?? [];
        if (__DEV__) console.log(`[CardPhoto] ${icao}/${cacheCategory} — got ${results.length} results, status=${d.status}`);

        if (results.length > 0) {
          const mapped = results.slice(0, 10).map((p: any) => ({
            name: p.name,
            photoRef: pickBestPhotoRef(p.photos),
            rating: p.rating,
            distanceMiles: null,
          }));
          setCachedCategory(icao, cacheCategory, mapped);
          const best = mapped[0];
          if (best?.photoRef) return { photoUri: placPhotoUrl(best.photoRef), placeName: best.name };
          return { photoUri: SATELLITE_FALLBACK(lat, lng), placeName: best?.name ?? null };
        }
      }
    } catch (e: any) {
      if (__DEV__) console.warn(`[CardPhoto] ${icao}/${cacheCategory} — error:`, e?.message);
    }
  }

  if (__DEV__) console.log(`[CardPhoto] ${icao}/${cacheCategory} — using satellite fallback`);
  return { photoUri: SATELLITE_FALLBACK(lat, lng), placeName: null };
}

function formatActivityTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

function placPhotoUrl(ref: string, maxwidth = 800): string {
  return `${PBASE}/photo?maxwidth=${maxwidth}&photoreference=${ref}&key=${GOOGLE_KEY}`;
}

/**
 * Pick the best photo reference from a Google Places photos array.
 *
 * Google Places returns width/height (original dimensions) per photo_reference.
 * We score by resolution and landscape orientation — landscape shots at higher
 * resolution make stronger hero images than dark, narrow, or tiny thumbnails.
 *
 * Heuristics (no pixel data available, metadata only):
 *  - Resolution: width × height in megapixels — larger = sharper hero
 *  - Landscape bonus: width/height ≥ 1.2 → 1.5×, ≥ 1.0 → 1.0×, portrait → 0.5×
 *  - Size penalty: < 0.3 MP → 0.3× (likely a logo or thumbnail)
 */
function pickBestPhotoRef(photos: any[] | undefined): string | null {
  if (!photos || photos.length === 0) return null;
  if (photos.length === 1) return photos[0].photo_reference ?? null;

  let bestRef: string | null = null;
  let bestScore = -1;

  for (const p of photos) {
    const ref = p.photo_reference;
    if (!ref) continue;
    const w: number = p.width ?? 0;
    const h: number = p.height ?? 0;

    const megapixels = (w * h) / 1_000_000;
    const aspect = h > 0 ? w / h : 1;
    const landscapeBonus = aspect >= 1.2 ? 1.5 : aspect >= 1.0 ? 1.0 : 0.5;
    const sizePenalty = megapixels < 0.3 ? 0.3 : 1.0;

    const score = megapixels * landscapeBonus * sizePenalty;
    if (score > bestScore) {
      bestScore = score;
      bestRef = ref;
    }
  }

  return bestRef;
}

function nmToMi(nm: number): number {
  return Math.round(nm * 1.15078 * 10) / 10;
}

// Deterministic social proof numbers — stable per ICAO, no backend needed
function socialProof(icao: string): { saved: number; flew: number } {
  let h = 0;
  for (let i = 0; i < icao.length; i++) h = (h * 31 + icao.charCodeAt(i)) >>> 0;
  return { saved: 12 + (h % 37), flew: 3 + ((h >> 4) % 16) };
}

// Experiential hook copy — uses real distMi when available for specificity
function featHook(cat: DestCat, distMi: number | null): string {
  if (cat === 'food') {
    if (distMi != null && distMi <= 0.2)  return 'Steps from the tiedown — tie down and walk straight to the table.';
    if (distMi != null && distMi <= 0.5)  return `${Math.round(distMi * 20)} min walk from the ramp. Real food, no ride needed.`;
    if (distMi != null && distMi <= 2.0)  return `${distMi.toFixed(1)} miles from the runway — grab the crew car and eat well.`;
    return 'Tie down, eat well, debrief the flight. This is why we fly.';
  }
  if (cat === 'golf') {
    if (distMi != null && distMi <= 0.5) return 'Tee boxes within walking distance of the ramp. Drop bags, tee off.';
    if (distMi != null)                  return `${distMi.toFixed(1)} miles from the runway. 18 holes worth the flight.`;
    return '18 holes you can only reach by flight plan.';
  }
  if (cat === 'park')  return 'Park the plane, lace up, go. Scenery that earns its place on your kneeboard.';
  if (cat === 'hotel') return 'File the flight plan. Let someone else carry the bags tonight.';
  if (cat === 'short') return "Pattern work ends here. Under an hour wheels-up to shutdown.";
  return '';
}

// Human-readable ground proximity label for food cards
function proximityLabel(distMi: number): string {
  if (distMi <= 0.15) return 'On the field';
  if (distMi <= 0.35) return 'Walkable';
  if (distMi <= 0.6)  return `${Math.round(distMi * 20)} min walk`;
  if (distMi <= 1.2)  return '~15 min walk';
  return `${distMi.toFixed(1)} mi away`;
}

// ── Distance buckets per section (nm from user) ────────────────────────────
// Each section targets a travel range that matches its intent.
const BUCKETS: Record<string, { min: number; max: number }> = {
  food:  { min: 25,  max: 120 },  // worth flying for a meal — at least 25 nm out
  golf:  { min: 30,  max: 150 },  // golf destination getaway
  dog:   { min: 0,   max: 2000 }, // dog-friendly — show all, these are rare
  park:  { min: 25,  max: 120 },  // scenic hop
  hotel: { min: 75,  max: 250 },  // weekend escape — far enough to need lodging
  short: { min: 20,  max: 75  },  // quick hop
};

/**
 * Score an airport as a destination.
 * Rewards airports with multiple reasons to fly there — food+golf, food+stay, etc.
 * Combo bonus ensures multi-amenity airports rank above single-amenity ones.
 */
function destinationScore(a: Airport, nm: number): number {
  let s = 0;
  const hasFood  = a.nearestFoodNm  != null;
  const hasGolf  = a.nearestGolfNm  != null;
  const hasHotel = a.nearestHotelNm != null;
  const hasDo    = a.nearestAttractionNm != null;
  if (hasFood)  s += 20;
  if (hasGolf)  s += 20;
  if (hasHotel) s += 20;
  if (hasDo)    s += 20;
  if (a.fuel)   s += 10;
  // Combo bonus: airports with 2+ amenities are far more destination-worthy
  const amenityCount = [hasFood, hasGolf, hasHotel, hasDo].filter(Boolean).length;
  if (amenityCount >= 3) s += 35;
  else if (amenityCount >= 2) s += 18;
  s -= nm * 0.04; // mild penalty so very distant airports don't dominate
  return s;
}

/**
 * Pick up to `n` airports with state-level geographic variety.
 * Input list should be sorted by destinationScore desc — best destinations first.
 * Skips airports already in `usedSet`; adds picked airports to `usedSet`.
 * Dev logs show which airports were picked, skipped, distance, and score.
 */
function sectionPick(
  list: (Airport & { _nm: number; _score: number })[],
  n: number,
  section: string,
  usedSet: Set<string>,
): (Airport & { _nm: number; _score: number })[] {
  const available = list.filter(a => {
    const id = aptIdent(a);
    if (usedSet.has(id)) {
      if (__DEV__) console.log(`[Discover] ${section}: SKIP ${id} (${Math.round(a._nm)} nm) — already used in another section`);
      return false;
    }
    return true;
  });
  // Group by state; each state's queue is already sorted by score desc
  const byState: Record<string, typeof available> = {};
  for (const a of available) {
    const st = a.state || 'ZZ';
    if (!byState[st]) byState[st] = [];
    byState[st].push(a);
  }
  const queues = Object.values(byState);
  const out: typeof available = [];
  for (let i = 0; out.length < n && i < 30; i++) {
    for (const q of queues) {
      if (q.length > 0 && out.length < n) out.push(q.shift()!);
    }
  }
  for (const a of out) {
    usedSet.add(aptIdent(a));
    if (__DEV__) console.log(
      `[Discover] ${section}: PICK ${aptIdent(a)} (${a.city}, ${a.state})` +
      ` — ${Math.round(a._nm)} nm, score=${Math.round(a._score)}`
    );
  }
  return out;
}

// ── Nearby Festivals ──────────────────────────────────────────────────────────

/** CuratedEvent enriched with computed flight distance from the user's location */
type FestivalEntry = CuratedEvent & { _nm: number };

/** Category → accent color only. Glass surface is the same for all festival cards. */
const FEST_ACCENTS: Record<string, string> = {
  'Fly-In':           ORANGE,
  'Food Festival':    '#F59E0B',
  'Festival':         '#9B77F5',
  'Airshow':          SKY,
  'Pancake Breakfast':'#10B981',
  'EAA Event':        '#EF4444',
  'AOPA Event':       ORANGE,
};
function festAccent(cat: string): string { return FEST_ACCENTS[cat] ?? TEXT3; }

// Aviation event categories — split from festival categories for separate section
const AVIATION_TYPES_SET = new Set(['Fly-In', 'Airshow', 'Pancake Breakfast', 'Poker Run', 'EAA Event', 'AOPA Event']);

function fmtEventDate(start: string, end: string): string {
  const s = new Date(start + 'T12:00:00');
  const e = new Date(end   + 'T12:00:00');
  const mo = (d: Date) => d.toLocaleString('en-US', { month: 'short' });
  const dy = (d: Date) => d.getDate();
  if (start === end) return `${mo(s)} ${dy(s)}`;
  if (mo(s) === mo(e)) return `${mo(s)} ${dy(s)}–${dy(e)}`;
  return `${mo(s)} ${dy(s)} – ${mo(e)} ${dy(e)}`;
}

/**
 * Returns events within 1000 nm that overlap the upcoming Friday–Sunday window,
 * sorted closest → soonest. Mirrors the "this weekend" filter on the Events tab.
 */
function computeNearbyFestivals(userLat: number, userLng: number): FestivalEntry[] {
  // Compute upcoming Friday–Sunday window (same logic as Events tab)
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dow = today.getDay(); // 0=Sun … 6=Sat
  const daysToFri = dow === 0 ? 0 : dow <= 5 ? 5 - dow : 6;
  const friday = new Date(today); friday.setDate(today.getDate() + daysToFri);
  const sunday = new Date(friday); sunday.setDate(friday.getDate() + 2);

  const upcoming = fetchCuratedEvents();   // already filtered to today+

  const entries: (FestivalEntry & { _days: number })[] = upcoming
    .filter(e => {
      if (!e.nearest_airport) return false;
      const start = new Date(e.start_date + 'T12:00:00');
      const end   = e.end_date ? new Date(e.end_date + 'T12:00:00') : start;
      return start <= sunday && end >= friday;
    })
    .map(e => {
      // Fall back to airport coordinates when event has placeholder 0,0 coords
      let eLat = e.lat;
      let eLng = e.lng;
      if (!eLat || !eLng) {
        const apt = (allAirports as Airport[]).find(
          a => aptIdent(a) === e.nearest_airport.toUpperCase()
        );
        if (apt) { eLat = apt.lat; eLng = apt.lng; }
      }
      const nm = distNm(userLat, userLng, eLat, eLng);
      const days = Math.max(0, Math.floor(
        (new Date(e.start_date + 'T12:00:00').getTime() - Date.now()) / 86400000
      ));
      return { ...e, lat: eLat, lng: eLng, _nm: nm, _days: days };
    })
    .filter(e => e._nm <= 1000);

  // Closest first; tie-break by soonest start date
  entries.sort((a, b) => {
    if (a._nm !== b._nm) return a._nm - b._nm;
    return a._days - b._days;
  });

  return entries;
}

// ── Card builders ─────────────────────────────────────────────────────────────

async function buildGolfCards(lat: number, lng: number, usedSet: Set<string>): Promise<DestCard[]> {
  if (!GOOGLE_KEY) return [];
  const { min, max } = BUCKETS.golf;
  const withDist = airports
    .filter(a => a.nearestGolfName && a.nearestGolfPlaceId && a.nearestGolfDistanceMi != null)
    .map(a => { const _nm = distNm(lat, lng, a.lat, a.lng); return { ...a, _nm, _score: destinationScore(a, _nm) }; });
  if (__DEV__) {
    const tooClose = withDist.filter(a => a._nm < min);
    if (tooClose.length > 0)
      console.log(`[Discover] golf: ${tooClose.length} airports too close (<${min} nm) — e.g. ${tooClose.slice(0, 3).map(a => `${aptIdent(a)} ${Math.round(a._nm)}nm`).join(', ')}`);
  }
  const candidates = withDist.filter(a => a._nm >= min && a._nm <= max).sort((a, b) => b._score - a._score);
  const picks = sectionPick(candidates, 8, 'golf', usedSet);

  return Promise.all(picks.map(async (a): Promise<DestCard> => {
    const { photoUri } = await getCardPhoto(aptIdent(a), a.lat, a.lng, 'golf', 'golf_course', 'discover_golf');
    return {
      key: `golf-${a.id}`,
      placeName: a.nearestGolfName!,
      cat: 'golf',
      distMi: a.nearestGolfDistanceMi!,
      photoUri,
      apt: a,
      flightNm: Math.round(a._nm),
      flightFmt: fmtFlight(a._nm),
    };
  }));
}

async function buildPlaceCards(
  cat: Exclude<DestCat, 'golf' | 'short'>,
  aptFilter: (a: Airport) => boolean,
  groundMiFn: (a: Airport) => number | null,
  lat: number,
  lng: number,
  usedSet: Set<string>,
  pickN = 8,
): Promise<DestCard[]> {
  // No live API calls — check Supabase cache for photos, fall back to satellite
  const { min, max } = BUCKETS[cat];
  const catToCacheKey: Record<string, string> = { hotel: 'hotels', park: 'things', food: 'restaurants', dog: 'things' };
  const withDist = airports
    .filter(aptFilter)
    .map(a => { const _nm = distNm(lat, lng, a.lat, a.lng); return { ...a, _nm, _score: destinationScore(a, _nm) }; });
  const candidates = withDist.filter(a => a._nm >= min && a._nm <= max).sort((a, b) => b._score - a._score);
  const picks = sectionPick(candidates, pickN, cat, usedSet);

  const catPrefix: Record<string, string> = { hotel: 'Stay near', park: 'Explore near', food: 'Dining near', dog: 'Fly to' };
  const catToPlaceType: Record<string, string> = { hotel: 'lodging', park: 'tourist_attraction', food: 'restaurant' };
  return Promise.all(picks.map(async (a): Promise<DestCard> => {
    const { photoUri, placeName: resolvedName } = await getCardPhoto(
      aptIdent(a), a.lat, a.lng,
      catToCacheKey[cat] as any, catToPlaceType[cat] ?? 'point_of_interest',
      `discover_${cat}`,
    );
    return {
      key: `${cat}-${a.id}`,
      placeName: resolvedName ?? `${catPrefix[cat] ?? ''} ${a.city}`.trim(),
      cat,
      distMi: groundMiFn(a),
      photoUri,
      apt: a,
      flightNm: Math.round(a._nm),
      flightFmt: fmtFlight(a._nm),
    };
  }));
}

/**
 * Fly for Food — curated using the same filtered data as each airport's Eat tab.
 *
 * Priority 1: Supabase cache (already ran through isRealFood by Eat tab pipeline).
 * Priority 2: Fresh nearbysearch with the same chain filter applied inline.
 * Chains are hidden unless they're the only food option at that airport (last resort).
 */
/**
 * Food cards — cache-only, NO live Places API calls.
 * Uses Supabase airport_places_cache (written by airport detail Eat tab).
 * Falls back to static airports.json nearestFoodNm data.
 */
async function buildFoodCards(lat: number, lng: number, usedSet: Set<string>): Promise<DestCard[]> {
  const { min, max } = BUCKETS.food;
  const withDist = airports
    .filter(a => a.nearestFoodNm != null && a.nearestFoodNm <= 1.5)
    .map(a => { const _nm = distNm(lat, lng, a.lat, a.lng); return { ...a, _nm, _score: destinationScore(a, _nm) }; });
  const candidates = withDist.filter(a => a._nm >= min && a._nm <= max).sort((a, b) => b._score - a._score);
  const picks = sectionPick(candidates, 12, 'food', usedSet);

  const cards: DestCard[] = [];
  for (const a of picks) {
    if (cards.length >= 8) break;
    const icao = aptIdent(a);

    const { photoUri, placeName: resolvedName } = await getCardPhoto(icao, a.lat, a.lng, 'restaurants', 'restaurant', 'discover_food');
    const distMi: number | null = a.nearestFoodNm != null ? nmToMi(a.nearestFoodNm) : null;

    cards.push({
      key: `food-${a.id}`,
      placeName: resolvedName ?? `Dining near ${a.city}`,
      cat: 'food',
      distMi,
      photoUri,
      apt: a,
      flightNm: Math.round(a._nm),
      flightFmt: fmtFlight(a._nm),
    });
  }
  return cards;
}

async function buildDogCards(lat: number, lng: number, usedSet: Set<string>): Promise<DestCard[]> {
  try {
    const { data: dogAirports, error } = await supabase
      .from('dog_friendly_airports')
      .select('airport_icao, dog_notes, dog_features');
    if (__DEV__) console.log('[Discover] dog: query result —', error ? `ERROR: ${error.message}` : `${dogAirports?.length ?? 0} airports`);
    if (error || !dogAirports || dogAirports.length === 0) return [];

    const dogIcaos = new Set(dogAirports.map(d => d.airport_icao.toUpperCase()));
    const { min, max } = BUCKETS.dog;
    const withDist = airports
      .filter(a => {
        const id = (a.icao || a.faa || a.id || '').toUpperCase();
        return dogIcaos.has(id) && !usedSet.has(id);
      })
      .map(a => {
        const _nm = distNm(lat, lng, a.lat, a.lng);
        return { ...a, _nm, _score: destinationScore(a, _nm) };
      })
      .filter(a => a._nm >= min && a._nm <= max)
      .sort((a, b) => b._score - a._score)
      .slice(0, 8);

    if (__DEV__) console.log('[Discover] dog: matched', withDist.length, 'airports from', dogIcaos.size, 'dog-friendly ICAOs');
    // No live API calls — use satellite tile for photos
    return withDist.map((a): DestCard => {
      const icao = aptIdent(a);
      usedSet.add(icao);
      const dogData = dogAirports.find(d => d.airport_icao.toUpperCase() === icao);
      return {
        key: `dog-${a.id}`,
        placeName: dogData?.dog_notes
          ? dogData.dog_notes.split('.')[0]
          : `Bring your dog to ${a.city}`,
        cat: 'dog' as DestCat,
        distMi: null,
        photoUri: GOOGLE_KEY ? `https://maps.googleapis.com/maps/api/staticmap?center=${a.lat},${a.lng}&zoom=12&size=800x400&maptype=hybrid&style=feature:poi|visibility:off&key=${GOOGLE_KEY}` : null,
        apt: a,
        flightNm: Math.round(a._nm),
        flightFmt: fmtFlight(a._nm),
        amenityTags: (dogData?.dog_features ?? []).slice(0, 3),
      };
    });
  } catch (e: any) {
    if (__DEV__) console.warn('[Discover] dog cards error:', e?.message);
    return [];
  }
}

function buildShortCards(lat: number, lng: number, usedSet: Set<string>): DestCard[] {
  // No live API calls — use satellite tile for photos
  const { min, max } = BUCKETS.short;
  const withDist = airports
    .map(a => { const _nm = distNm(lat, lng, a.lat, a.lng); return { ...a, _nm, _score: destinationScore(a, _nm) }; });
  const candidates = withDist.filter(a => a._nm >= min && a._nm <= max).sort((a, b) => b._score - a._score);
  const picks = sectionPick(candidates, 8, 'short', usedSet);

  return picks.map(a => {
    const tags: string[] = [];
    if (a.nearestFoodNm != null)       tags.push('Food');
    if (a.nearestGolfNm != null)        tags.push('Golf');
    if (a.nearestHotelNm != null)       tags.push('Stay');
    if (a.nearestAttractionNm != null)  tags.push('Things to do');

    return {
      key: `short-${a.id}`,
      placeName: `Fly to ${a.city}`,
      cat: 'short' as DestCat,
      distMi: null,
      photoUri: GOOGLE_KEY ? `https://maps.googleapis.com/maps/api/staticmap?center=${a.lat},${a.lng}&zoom=12&size=800x400&maptype=hybrid&style=feature:poi|visibility:off&key=${GOOGLE_KEY}` : null,
      apt: a,
      flightNm: Math.round(a._nm),
      flightFmt: fmtFlight(a._nm),
      amenityTags: tags.slice(0, 3),
    };
  });
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function DiscoverScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [search, setSearch] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [profile, setProfile] = useState<any>(null);
  const [recentSearches, setRecentSearches] = useState<any[]>([]);
  const [homeIdent, setHomeIdent] = useState<string | null>(null);
  const [searchMode, setSearchMode] = useState<'airports' | 'people'>('airports');
  const [pilotResults, setPilotResults] = useState<any[]>([]);
  const [activityFeed, setActivityFeed] = useState<any[]>([]);
  const [discoverMode, setDiscoverMode] = useState<'discover' | 'feed'>('discover');
  const [feedItems, setFeedItems] = useState<any[]>([]);
  const [feedLoading, setFeedLoading] = useState(false);
  const scrollY = useRef(new Animated.Value(0)).current;
  const [refPt, setRefPt] = useState<{ lat: number; lng: number } | null>(null);

  const [locationSource, setLocationSource] = useState<'gps' | 'home' | 'fallback' | null>(null);
  const [locationLabel,  setLocationLabel]  = useState<string | null>(null);
  // Track the last anchor coords that triggered a section build so that token-refresh
  // re-renders and double location-effect invocations don't fire 44 extra API calls.
  const lastBuildAnchor = useRef<string | null>(null);

  const [foodCards,  setFoodCards]  = useState<DestCard[] | null>(null);
  const [golfCards,  setGolfCards]  = useState<DestCard[] | null>(null);
  const [parkCards,  setParkCards]  = useState<DestCard[] | null>(null);
  const [hotelCards, setHotelCards] = useState<DestCard[] | null>(null);
  const [shortCards, setShortCards] = useState<DestCard[] | null>(null);
  const [dogCards,   setDogCards]   = useState<DestCard[] | null>(null);
  const [searchCrewCarMap, setSearchCrewCarMap] = useState<Record<string, boolean>>({});
  const [crewCarSet, setCrewCarSet] = useState<Set<string>>(new Set());
  const [cruiseSpeed, setCruiseSpeed] = useState(120);
  const [buildTrigger, setBuildTrigger] = useState(0);
  const [nearbyFestivals, setNearbyFestivals] = useState<FestivalEntry[]>([]);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [flyTripEvent, setFlyTripEvent] = useState<FestivalEntry | null>(null);

  // Redirect to onboarding if not complete.
  // Checks both new and legacy keys so existing users aren't re-onboarded.
  useEffect(() => {
    (async () => {
      try {
        const newFlag = await AsyncStorage.getItem('hasCompletedOnboarding');
        if (newFlag === 'true') return;
        const legacyFlag = await AsyncStorage.getItem('onboardingComplete:guest');
        if (legacyFlag === 'true') {
          await AsyncStorage.setItem('hasCompletedOnboarding', 'true');
          return;
        }
        router.replace('/welcome' as any);
      } catch {}
    })();
  }, []);

  // Load profile.
  // Load profile — uses guest key since onboarding is guest-first.
  useEffect(() => {
    const key = `userProfile:${user?.id ?? 'guest'}`;
    AsyncStorage.getItem(key).then(raw => {
      if (!raw) return;
      try {
        const p = JSON.parse(raw);
        setProfile(p);
        if (p.home_airport) setHomeIdent(p.home_airport.toUpperCase());
        if (__DEV__) console.log('[Discover] profile loaded — key:', key, '| home airport:', p.home_airport ?? 'none');
      } catch {}
    });
  }, [user?.id]);

  // Reload cruise speed every time Discover comes into focus so changes
  // saved in pilot-profile.tsx are reflected immediately on the cards.
  useFocusEffect(useCallback(() => {
    const key = `userProfile:${user?.id ?? 'guest'}`;
    AsyncStorage.getItem(key).then(raw => {
      if (!raw) return;
      try {
        const s = Number(JSON.parse(raw).cruise_speed);
        if (s > 0) {
          if (__DEV__) console.log('[Discover] cruise speed loaded on focus:', s, 'kts');
          setCruiseSpeed(s);
        }
      } catch {}
    });
  }, [user?.id]));

  // Reload saved festival IDs whenever Discover comes into focus so the
  // bookmark icon reflects changes made on the Events or Bucket List tabs.
  useFocusEffect(useCallback(() => {
    if (user?.id) {
      getSavedDestinations(user.id).then(items => {
        setSavedIds(new Set(items.map(i => i.id)));
      });
    }
  }, [user?.id]));

  // On every focus, check whether the feature day has rolled over.
  // If there is no snapshot saved for today's day key, reset the build anchor
  // so the section build effect re-runs with fresh featured destinations.
  useFocusEffect(useCallback(() => {
    const dayKey = getFeatureDayKey();
    AsyncStorage.getItem(`discover:snapshot:${dayKey}`).then(snap => {
      if (!snap) {
        if (__DEV__) console.log('[Discover] no snapshot for day', dayKey, '— triggering rebuild');
        lastBuildAnchor.current = null;
        setBuildTrigger(t => t + 1);
      } else {
        if (__DEV__) console.log('[Discover] snapshot exists for day', dayKey, '— no rebuild needed');
      }
    }).catch(() => {});
  }, []));

  // Load recent pilot activity feed
  useFocusEffect(useCallback(() => {
    (async () => {
      try {
        // Recent flights + reviews from all public users, last 24h
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const [flightsRes, reviewsRes] = await Promise.all([
          supabase
            .from('visited_airports')
            .select('user_id, icao, name, state, visited_at')
            .gte('visited_at', since)
            .order('visited_at', { ascending: false })
            .limit(10),
          supabase
            .from('airport_reviews')
            .select('user_id, airport_icao, visit_reason, created_at')
            .gte('created_at', since)
            .order('created_at', { ascending: false })
            .limit(10),
        ]);

        const items: any[] = [];
        for (const f of (flightsRes.data ?? [])) {
          items.push({ type: 'flight', user_id: f.user_id, icao: f.icao, label: f.name, state: f.state, ts: f.visited_at });
        }
        for (const r of (reviewsRes.data ?? [])) {
          items.push({ type: 'review', user_id: r.user_id, icao: r.airport_icao, label: r.visit_reason?.replace('_', ' ') ?? 'report', ts: r.created_at });
        }
        items.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());

        // Fetch user names for the activity items
        const userIds = [...new Set(items.map(i => i.user_id))];
        if (userIds.length > 0) {
          const { data: profiles } = await supabase
            .from('pilot_profiles')
            .select('user_id, name, username')
            .in('user_id', userIds);
          const nameMap = new Map((profiles ?? []).map(p => [p.user_id, p.name || p.username || 'Pilot']));
          for (const item of items) item.userName = nameMap.get(item.user_id) ?? 'Pilot';
        }

        // Dedupe: skip same user+type+icao within 5 minutes
        const deduped: any[] = [];
        for (const item of items) {
          const dup = deduped.find(d => d.type === item.type && d.icao === item.icao && d.user_id === item.user_id &&
            Math.abs(new Date(d.ts).getTime() - new Date(item.ts).getTime()) < 5 * 60 * 1000);
          if (!dup) deduped.push(item);
        }
        setActivityFeed(deduped.slice(0, 8));
      } catch {}
    })();
  }, []));

  // Load personal feed (from pilots you follow)
  async function loadFeed() {
    if (!user?.id) { setFeedItems([]); return; }
    setFeedLoading(true);
    try {
      // Get who I follow
      const { data: follows } = await supabase
        .from('pilot_follows')
        .select('following_id')
        .eq('follower_id', user.id);
      const followedIds = (follows ?? []).map(f => f.following_id);
      if (followedIds.length === 0) { setFeedItems([]); setFeedLoading(false); return; }

      // Get their recent flights + reviews
      const [flightsRes, reviewsRes] = await Promise.all([
        supabase.from('visited_airports')
          .select('user_id, icao, name, state, visited_at')
          .in('user_id', followedIds)
          .order('visited_at', { ascending: false })
          .limit(30),
        supabase.from('airport_reviews')
          .select('user_id, airport_icao, visit_reason, notes, created_at')
          .in('user_id', followedIds)
          .order('created_at', { ascending: false })
          .limit(30),
      ]);

      const items: any[] = [];
      for (const f of (flightsRes.data ?? [])) {
        items.push({ type: 'flight', user_id: f.user_id, icao: f.icao, label: f.name, state: f.state, ts: f.visited_at });
      }
      for (const r of (reviewsRes.data ?? [])) {
        items.push({ type: 'review', user_id: r.user_id, icao: r.airport_icao, label: r.visit_reason?.replace('_', ' ') ?? 'report', notes: r.notes, ts: r.created_at });
      }
      items.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());

      // Dedupe
      const deduped: any[] = [];
      for (const item of items) {
        const dup = deduped.find(d => d.type === item.type && d.icao === item.icao && d.user_id === item.user_id &&
          Math.abs(new Date(d.ts).getTime() - new Date(item.ts).getTime()) < 5 * 60 * 1000);
        if (!dup) deduped.push(item);
      }

      // Resolve names
      const userIds = [...new Set(deduped.map(i => i.user_id))];
      const { data: profiles } = await supabase
        .from('pilot_profiles')
        .select('user_id, name, username, certificate')
        .in('user_id', userIds);
      const profileMap = new Map((profiles ?? []).map(p => [p.user_id, p]));
      for (const item of deduped) {
        const p = profileMap.get(item.user_id);
        item.userName = p?.name || p?.username || 'Pilot';
        item.certificate = p?.certificate;
      }

      setFeedItems(deduped.slice(0, 30));
    } catch (e: any) {
      if (__DEV__) console.warn('[Feed] error:', e?.message);
    }
    setFeedLoading(false);
  }

  // Load feed when switching to feed mode
  useEffect(() => {
    if (discoverMode === 'feed') loadFeed();
  }, [discoverMode, user?.id]);

  // Load recent searches
  useEffect(() => {
    AsyncStorage.getItem('recentSearches').then(s => {
      if (s) try { setRecentSearches(JSON.parse(s)); } catch {}
    });
  }, []);

  // Resolve reference point.
  // Priority: GPS → home airport → US centre.
  // The outer try/catch ensures refPt is ALWAYS set — if any Location API call
  // throws (device restriction, first-launch edge case, timeout), execution falls
  // through to the home-airport then US-centre fallbacks instead of silently hanging.
  useEffect(() => {
    (async () => {
      // ── Priority 1: GPS ──────────────────────────────────────────────────────
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          try {
            const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
            const { latitude: lat, longitude: lng } = pos.coords;
            setRefPt({ lat, lng });
            setLocationSource('gps');
            if (__DEV__) console.log(`[Discover] using GPS location (${lat.toFixed(4)}, ${lng.toFixed(4)})`);

            // Reverse geocode → city/state label, cached per ~11 km grid cell.
            const cacheKey = `geocodeLabel:${lat.toFixed(1)},${lng.toFixed(1)}`;
            try {
              const cached = await AsyncStorage.getItem(cacheKey);
              if (cached) {
                setLocationLabel(cached);
              } else {
                const geo = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
                const place = geo?.[0];
                if (place) {
                  const label = [place.city, place.region].filter(Boolean).join(', ');
                  setLocationLabel(label || null);
                  if (label) await AsyncStorage.setItem(cacheKey, label);
                }
              }
            } catch {
              // reverse geocode is best-effort; label is cosmetic only
            }
            return; // ✓ GPS succeeded — done
          } catch (gpsErr) {
            if (__DEV__) console.log('[Discover] GPS failed — trying home airport', gpsErr);
            // fall through to Priority 2
          }
        } else {
          if (__DEV__) console.log('[Discover] GPS permission denied — trying home airport');
          // fall through to Priority 2
        }
      } catch (permErr) {
        if (__DEV__) console.log('[Discover] Location API unavailable — trying home airport', permErr);
        // fall through to Priority 2
      }

      // ── Priority 2: home airport ─────────────────────────────────────────────
      if (homeIdent) {
        const home = airports.find(a => aptIdent(a) === homeIdent);
        if (home) {
          setRefPt({ lat: home.lat, lng: home.lng });
          setLocationSource('home');
          const label = [home.city, home.state].filter(Boolean).join(', ');
          setLocationLabel(label || null);
          if (__DEV__) console.log(`[Discover] GPS failed → using home airport ${homeIdent} (${home.lat.toFixed(4)}, ${home.lng.toFixed(4)})`);
          return; // ✓ home airport succeeded — done
        }
      }

      // ── Priority 3: geographic centre of contiguous US ───────────────────────
      setRefPt({ lat: 39.5, lng: -98.35 });
      setLocationSource('fallback');
      setLocationLabel(null);
      if (__DEV__) console.log('[Discover] fallback → using default location (US center)');
    })();
  }, [homeIdent]);

  // Kick off all section fetches once reference point is resolved.
  // Guards against duplicate builds using a combined anchor+dayKey string so that
  // both location changes and daily rollover trigger a fresh set of cards.
  useEffect(() => {
    if (!refPt) return;
    const { lat, lng } = refPt;
    const dayKey = getFeatureDayKey();

    // Dedup key: ~1 nm precision anchor + feature day. Same anchor on a new day → rebuild.
    const anchorKey = `${lat.toFixed(2)},${lng.toFixed(2)}`;
    const buildKey = `${anchorKey}:${dayKey}`;
    if (lastBuildAnchor.current === buildKey) {
      if (__DEV__) console.log(`[Discover] skipping duplicate build for key=${buildKey}`);
      return;
    }
    lastBuildAnchor.current = buildKey;

    const snapshotKey = `discover:snapshot:${dayKey}`;

    (async () => {
      // ── Load from today's snapshot if available ──────────────────────────────
      try {
        const raw = await AsyncStorage.getItem(snapshotKey);
        if (raw) {
          const snap = JSON.parse(raw);
          // Reject snapshots built with an older chain filter — they may contain chains
          if (snap.version !== CHAIN_FILTER_VERSION) {
            if (__DEV__) console.log('[Discover] snapshot version mismatch — rebuilding with updated chain filter');
            await AsyncStorage.removeItem(snapshotKey);
          } else {
            if (snap.food?.length)  setFoodCards(snap.food);
            if (snap.golf?.length)  setGolfCards(snap.golf);
            if (snap.park?.length)  setParkCards(snap.park);
            if (snap.hotel?.length) setHotelCards(snap.hotel);
            if (snap.short?.length) setShortCards(snap.short);
            if (__DEV__) console.log('[Discover] loaded featured from snapshot:', dayKey);
            // Dog cards are not snapshotted — always build from Supabase
            buildDogCards(lat, lng, new Set()).then(cards => setDogCards(cards));
            return;
          }
        }
      } catch {}

      // ── Build fresh ──────────────────────────────────────────────────────────
      if (__DEV__) {
        console.log(
          `[Discover] building sections — anchor=(${lat.toFixed(3)}, ${lng.toFixed(3)})` +
          ` dayKey=${dayKey} label="${locationLabel ?? '(none)'}" source=${locationSource ?? 'unknown'}`
        );
        console.log(
          `[Discover] distance buckets:` +
          ` food ${BUCKETS.food.min}-${BUCKETS.food.max} nm` +
          ` | golf ${BUCKETS.golf.min}-${BUCKETS.golf.max} nm` +
          ` | hotel ${BUCKETS.hotel.min}-${BUCKETS.hotel.max} nm` +
          ` | short ${BUCKETS.short.min}-${BUCKETS.short.max} nm`
        );
      }

      // Reset live fetch budget for this rebuild
      _discoverLiveFetches = 0;

      // Shared dedup set — airports picked for one section are excluded from others.
      const usedSet = new Set<string>();

      // Short cards are synchronous — no cache lookup needed
      const short = buildShortCards(lat, lng, usedSet);
      setShortCards(short);

      // Async builders — Supabase cache lookups for photos, no Places API
      const [food, hotel, golf, park] = await Promise.all([
        buildFoodCards(lat, lng, usedSet),
        buildPlaceCards('hotel', a => a.nearestHotelNm != null && a.nearestHotelNm <= 2, a => a.nearestHotelNm != null ? nmToMi(a.nearestHotelNm) : null, lat, lng, usedSet),
        buildGolfCards(lat, lng, usedSet),
        buildPlaceCards('park', a => a.nearestAttractionNm != null && a.nearestAttractionNm <= 8, a => a.nearestAttractionNm != null ? nmToMi(a.nearestAttractionNm) : null, lat, lng, usedSet, 16),
      ]);
      setFoodCards(food);
      setHotelCards(hotel);
      setGolfCards(golf);
      setParkCards(park);

      const dog = await buildDogCards(lat, lng, usedSet);
      setDogCards(dog);

      try {
        const snapshot = { version: CHAIN_FILTER_VERSION, food, golf, park, hotel, short };
        await AsyncStorage.setItem(snapshotKey, JSON.stringify(snapshot));
        if (__DEV__) console.log('[Discover] saved featured snapshot for day:', dayKey);

        // Clean up snapshot from 2 days ago to avoid unbounded storage growth
        const old = new Date();
        old.setDate(old.getDate() - 2);
        const oldKey = `discover:snapshot:${old.getFullYear()}-${String(old.getMonth() + 1).padStart(2, '0')}-${String(old.getDate()).padStart(2, '0')}`;
        AsyncStorage.removeItem(oldKey).catch(() => {});
      } catch {}
    })();
  }, [refPt, buildTrigger]);

  // Recompute nearby festivals whenever the reference point changes.
  // Runs synchronously (no API calls) so no loading state needed.
  useEffect(() => {
    if (!refPt) return;
    setNearbyFestivals(computeNearbyFestivals(refPt.lat, refPt.lng));
  }, [refPt]);

  async function toggleFestivalSave(event: FestivalEntry) {
    if (!user?.id) return;
    const itemId = String(event.id);
    if (savedIds.has(itemId)) {
      await unsaveDestination(user.id, itemId);
      setSavedIds(prev => { const next = new Set(prev); next.delete(itemId); return next; });
    } else {
      await saveDestination(user.id, {
        id: itemId,
        _type: 'festival',
        event_name: event.event_name,
        city: event.city ?? '',
        state: event.state ?? '',
        start_date: event.start_date,
        end_date: event.end_date ?? event.start_date,
        nearest_airport: event.nearest_airport ?? '',
        category: event.category,
        event_link: event.event_link,
      });
      setSavedIds(prev => new Set(prev).add(itemId));
    }
  }

  // Search across full airport dataset
  const searchResults = useMemo(() => {
    if (search.length < 2) return [];
    const q = search.toLowerCase();
    return airports
      .filter(a =>
        a.name?.toLowerCase().includes(q) ||
        a.city?.toLowerCase().includes(q) ||
        a.id?.toLowerCase().includes(q) ||
        a.icao?.toLowerCase().includes(q)
      )
      .slice(0, 20);
  }, [search]);

  // Pilot search — queries Supabase when mode is 'people'
  useEffect(() => {
    if (searchMode !== 'people' || search.length < 2) { setPilotResults([]); return; }
    const q = search.trim().toLowerCase();
    const timer = setTimeout(() => {
      supabase
        .from('pilot_profiles')
        .select('user_id, name, username, home_airport, certificate')
        .or(`name.ilike.%${q}%,username.ilike.%${q}%`)
        .eq('is_public', true)
        .limit(15)
        .then(({ data }) => setPilotResults(data ?? []));
    }, 300); // debounce
    return () => clearTimeout(timer);
  }, [search, searchMode]);

  // Fetch crew car status for search results
  useEffect(() => {
    if (searchResults.length === 0) { setSearchCrewCarMap({}); return; }
    const icaos = searchResults.map(a => aptIdent(a)).filter(Boolean);
    supabase.from('crew_cars').select('icao, available, reported_at').in('icao', icaos)
      .order('reported_at', { ascending: false })
      .then(({ data }) => {
        // Only the most-recent report per ICAO determines current availability
        const latest: Record<string, boolean> = {};
        for (const r of (data ?? [])) {
          if (!(r.icao in latest)) latest[r.icao] = !!r.available;
        }
        const map: Record<string, boolean> = {};
        for (const [icao, avail] of Object.entries(latest)) {
          if (avail) map[icao] = true;
        }
        setSearchCrewCarMap(map);
      });
  }, [searchResults]);

  // Fetch crew car status for all discover cards — single batch query once cards load
  useEffect(() => {
    const allCards = [
      ...(foodCards ?? []), ...(golfCards ?? []),
      ...(parkCards ?? []), ...(hotelCards ?? []), ...(shortCards ?? []),
    ];
    if (allCards.length === 0) return;
    const icaos = [...new Set(allCards.map(c => aptIdent(c.apt)))];
    supabase.from('crew_cars').select('icao, available, reported_at').in('icao', icaos)
      .order('reported_at', { ascending: false })
      .then(({ data }) => {
        // Only the most-recent report per ICAO determines current availability
        const latest: Record<string, boolean> = {};
        for (const r of (data ?? [])) {
          if (!(r.icao in latest)) latest[r.icao] = !!r.available;
        }
        const s = new Set<string>();
        for (const [icao, avail] of Object.entries(latest)) {
          if (avail) s.add(icao);
        }
        setCrewCarSet(s);
      });
  }, [foodCards, golfCards, parkCards, hotelCards, shortCards]);

  function goToAirport(a: Airport, tab?: string) {
    const params: Record<string, string> = {
      icao: aptIdent(a),
      name: a.name,
      city: a.city,
      state: a.state,
      lat: String(a.lat),
      lng: String(a.lng),
      elevation: String(a.elevation ?? ''),
      fuel: a.fuel || '',
      runways: JSON.stringify(a.runways || []),
      description: '',
    };
    if (tab) params.tab = tab;
    router.push({ pathname: '/airport', params });
  }

  async function goToAirportFromSearch(a: any) {
    try {
      const updated = [a, ...recentSearches.filter((r: any) => r.id !== a.id)].slice(0, 5);
      setRecentSearches(updated);
      await AsyncStorage.setItem('recentSearches', JSON.stringify(updated));
    } catch {}
    setSearch('');
    goToAirport(a as Airport);
  }

  const SECTIONS: { label: string; cards: DestCard[] | null; cat: DestCat }[] = [
    { label: 'Fly for Food',     cards: foodCards ? foodCards.slice(1) : null,  cat: 'food'  },
    { label: 'Fly with Your Dog', cards: dogCards,   cat: 'dog'   },
    { label: 'Golf Getaways',    cards: golfCards,  cat: 'golf'  },
    { label: 'Parks & Outdoors', cards: parkCards,  cat: 'park'  },
    { label: 'Weekend Escapes',  cards: hotelCards, cat: 'hotel' },
    { label: 'Short Flights',    cards: shortCards, cat: 'short' },
  ];

  const showSearch = search.length >= 2 || (searchFocused && recentSearches.length > 0) || (searchFocused && searchMode === 'people');

  return (
    <View style={ds.root}>
      {/* ── Cinematic background atmosphere — vertical gradient + barely-visible grain */}
      <LinearGradient
        colors={['#0B1A2A', '#08121E', '#050A12']}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFillObject}
        pointerEvents="none"
      />

      {/* ── Google Places key diagnostic (self-removing once key is wired correctly) */}
      {!GOOGLE_KEY && (
        <View style={ds.placesKeyWarn}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Feather name="alert-triangle" size={13} color="#FF8080" />
            <Text style={ds.placesKeyWarnTxt}>
              Google Places key missing — place cards unavailable in this build
            </Text>
          </View>
        </View>
      )}

      {/* ── Header + Search (shared gradient surface) ───────────────────── */}
      <View style={ds.headerArea}>
        {/* Atmospheric gradient spans header text + search bar as one surface */}
        <LinearGradient
          colors={['rgba(28,16,8,0.88)', 'rgba(14,24,44,0.72)', 'rgba(7,11,20,0)']}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />

        {/* ── Header (collapses on scroll) ──────────────────────────── */}
        <View style={{ paddingTop: insets.top + 10 }}>
          <Animated.View style={{
            overflow: 'hidden',
            maxHeight: scrollY.interpolate({ inputRange: [0, 100], outputRange: [120, 0], extrapolate: 'clamp' }),
            opacity: scrollY.interpolate({ inputRange: [0, 60], outputRange: [1, 0], extrapolate: 'clamp' }),
          }}>
            <View style={ds.hdr}>
              <Text style={ds.hdrGreet}>
                {profile?.name
                  ? `HEY, ${profile.name.toUpperCase()}`
                  : 'DISCOVER'}
              </Text>
              <Text style={ds.hdrTitle}>Let's go{'\n'}somewhere.</Text>
              {locationLabel && (
                <View style={ds.locationPill}>
                  <View style={ds.locationDot} />
                  <Text style={ds.locationPillTxt}>{locationLabel}</Text>
                </View>
              )}
            </View>
          </Animated.View>
        </View>

        {/* ── Search ────────────────────────────────────────────────────── */}
        <GlassSearchBar
          value={search}
          onChangeText={setSearch}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setTimeout(() => setSearchFocused(false), 200)}
        />
      </View>

      {/* ── Discover / Feed toggle ──────────────────────────────────────── */}
      {!showSearch && (
        <View style={ds.modeToggleRow}>
          <TouchableOpacity
            style={[ds.modeToggleBtn, discoverMode === 'discover' && ds.modeToggleBtnActive]}
            onPress={() => setDiscoverMode('discover')}
            activeOpacity={0.7}
          >
            <Text style={[ds.modeToggleText, discoverMode === 'discover' && ds.modeToggleTextActive]}>Discover</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[ds.modeToggleBtn, discoverMode === 'feed' && ds.modeToggleBtnActive]}
            onPress={() => setDiscoverMode('feed')}
            activeOpacity={0.7}
          >
            <Text style={[ds.modeToggleText, discoverMode === 'feed' && ds.modeToggleTextActive]}>Feed</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Search / recent results overlay ─────────────────────────────── */}
      {showSearch && (
        <View style={ds.dropdownBox}>
          {/* Search mode toggle */}
          <View style={ds.searchToggle}>
            <TouchableOpacity
              style={[ds.searchToggleBtn, searchMode === 'airports' && ds.searchToggleBtnActive]}
              onPress={() => setSearchMode('airports')}
              activeOpacity={0.7}
            >
              <Feather name="map-pin" size={13} color={searchMode === 'airports' ? '#0D1421' : '#6B83A0'} />
              <Text style={[ds.searchToggleText, searchMode === 'airports' && ds.searchToggleTextActive]}>Airports</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[ds.searchToggleBtn, searchMode === 'people' && ds.searchToggleBtnActive]}
              onPress={() => setSearchMode('people')}
              activeOpacity={0.7}
            >
              <Feather name="users" size={13} color={searchMode === 'people' ? '#0D1421' : '#6B83A0'} />
              <Text style={[ds.searchToggleText, searchMode === 'people' && ds.searchToggleTextActive]}>Pilots</Text>
            </TouchableOpacity>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" showsVerticalScrollIndicator={false}>
            {searchMode === 'airports' && (
              <>
                {search.length < 2 && recentSearches.length > 0 && (
                  <>
                    <Text style={ds.dropdownLabel}>RECENT</Text>
                    {recentSearches.map((a: any, i: number) => (
                      <View key={i} style={ds.resultRow}>
                        <TouchableOpacity style={{ flex: 1 }} onPress={() => goToAirportFromSearch(a)}>
                          <Text style={ds.resultId}>{a.icao || a.id}</Text>
                          <Text style={ds.resultName}>{a.name}</Text>
                          <Text style={ds.resultCity}>{a.city}, {a.state}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={async () => {
                            const updated = recentSearches.filter((_: any, idx: number) => idx !== i);
                            setRecentSearches(updated);
                            await AsyncStorage.setItem('recentSearches', JSON.stringify(updated));
                          }}
                          style={ds.dismissBtn}
                        >
                          <Feather name="x" size={13} color="#6B83A0" style={{ opacity: 0.55 }} />
                        </TouchableOpacity>
                      </View>
                    ))}
                  </>
                )}
                {search.length >= 2 && (
                  searchResults.length === 0
                    ? <Text style={ds.noResults}>No airports found</Text>
                    : searchResults.map((a: any, i: number) => (
                        <Pressable key={i} style={({ pressed }) => [ds.resultRow, pressed && ds.resultRowPressed]} onPress={() => goToAirportFromSearch(a)}>
                          <View style={{ flex: 1 }}>
                            <Text style={ds.resultId}>{a.icao || a.id}</Text>
                            <Text style={ds.resultName}>{a.name}</Text>
                            <Text style={ds.resultCity}>{a.city}, {a.state}</Text>
                          </View>
                          <View style={{ alignItems: 'flex-end', gap: 5 }}>
                            {(() => {
                              type AmenityTag = { key: string; icon: React.ReactElement };
                              const tags: AmenityTag[] = [];
                              if (a.fuel)                               tags.push({ key: 'fuel',  icon: <MaterialCommunityIcons name="gas-station" size={13} color="#6B83A0" /> });
                              if (searchCrewCarMap[aptIdent(a as Airport)]) tags.push({ key: 'car',   icon: <MaterialCommunityIcons name="car" size={13} color="#6B83A0" /> });
                              if (a.nearestFoodNm != null)               tags.push({ key: 'food',  icon: <MaterialCommunityIcons name="food" size={13} color="#6B83A0" /> });
                              if (a.nearestGolfNm != null)               tags.push({ key: 'golf',  icon: <MaterialCommunityIcons name="golf" size={13} color="#6B83A0" /> });
                              if (a.nearestHotelNm != null)              tags.push({ key: 'hotel', icon: <MaterialCommunityIcons name="bed" size={13} color="#6B83A0" /> });
                              if (a.nearestAttractionNm != null)         tags.push({ key: 'pin',   icon: <Feather name="map-pin" size={13} color="#6B83A0" /> });
                              if (tags.length === 0) return null;
                              return (
                                <View style={ds.amenityRow}>
                                  {tags.slice(0, 4).map(t => (
                                    <View key={t.key} style={ds.amenityChip}>{t.icon}</View>
                                  ))}
                                </View>
                              );
                            })()}
                            {a.elevation != null && <Text style={ds.resultMeta}>{a.elevation} ft</Text>}
                          </View>
                        </Pressable>
                      ))
                )}
              </>
            )}

            {searchMode === 'people' && (
              <>
                {search.length < 2 && <Text style={ds.noResults}>Search by name or username</Text>}
                {search.length >= 2 && pilotResults.length === 0 && <Text style={ds.noResults}>No pilots found</Text>}
                {pilotResults.map((p: any, i: number) => (
                  <Pressable
                    key={p.user_id ?? i}
                    style={({ pressed }) => [ds.resultRow, pressed && ds.resultRowPressed]}
                    onPress={() => router.push({ pathname: '/community-profile', params: { userId: p.user_id } })}
                  >
                    <View style={ds.pilotAvatar}>
                      <Feather name="user" size={16} color="#6B83A0" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={ds.resultName}>{p.name || 'Pilot'}</Text>
                      {p.username && <Text style={ds.resultCity}>@{p.username}</Text>}
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      {p.home_airport && <Text style={ds.resultMeta}>{p.home_airport}</Text>}
                      {p.certificate && <Text style={ds.resultMeta}>{p.certificate}</Text>}
                    </View>
                  </Pressable>
                ))}
              </>
            )}
          </ScrollView>
        </View>
      )}

      {/* ── Discovery sections ───────────────────────────────────────────── */}
      {!showSearch && discoverMode === 'discover' && (
        <Animated.ScrollView
          showsVerticalScrollIndicator={false}
          keyboardDismissMode="on-drag"
          contentContainerStyle={ds.scroll}
          onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: false })}
          scrollEventThrottle={16}
        >

          {/* 1. Featured Destination — dominant hero card, best food pick */}
          {foodCards && foodCards.length > 0 && (
            <View style={{ marginHorizontal: 16, marginBottom: 28 }}>
              <View style={[ds.secTitleRow, { paddingHorizontal: 0, marginBottom: 12 }]}>
                <View style={[ds.secTitleAccent, { backgroundColor: '#FBBF24' }]} />
                <MaterialCommunityIcons name="star-shooting" size={14} color="#FBBF24" />
                <Text style={[ds.secTitle, { color: '#FBBF24', fontSize: 12, letterSpacing: 1.4 }]}>FEATURED DESTINATION</Text>
              </View>
              <FeaturedDestinationCard
                card={foodCards[0]}
                crewCarSet={crewCarSet}
                cruiseSpeed={cruiseSpeed}
                homeIdent={homeIdent}
                onPress={() => goToAirport(foodCards[0].apt, CAT_TAB[foodCards[0].cat])}
              />
            </View>
          )}

          {/* 1. Surprise Me */}
          <View style={{ marginBottom: 8 }}>
            <SurpriseMe />
          </View>

          {/* 2. Fly This Weekend — all event types, sorted closest → soonest */}
          <EventSection
            title="Fly This Weekend"
            accentColor={SKY}
            icon={<MaterialCommunityIcons name="airplane-takeoff" size={16} color={TEXT1} />}
            events={nearbyFestivals.slice(0, 20)}
            onSeeAll={() => router.push('/(tabs)/events' as any)}
            onCardPress={e => setFlyTripEvent(e)}
            savedIds={savedIds}
            onSave={toggleFestivalSave}
          />

          {/* 3–7. Destination sections: Fly for Food first, then the rest */}
          {SECTIONS.map(sec => (
            <DiscoverSection
              key={sec.label}
              label={sec.label}
              cat={sec.cat}
              cards={sec.cards}
              crewCarSet={crewCarSet}
              cruiseSpeed={cruiseSpeed}
              onCardPress={c => goToAirport(c.apt, CAT_TAB[c.cat])}
            />
          ))}

          <View style={{ height: 50 }} />
        </Animated.ScrollView>
      )}

      {/* ── Feed view ─────────────────────────────────────────────────────── */}
      {!showSearch && discoverMode === 'feed' && (
        <Animated.ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={ds.scroll}
          onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: false })}
          scrollEventThrottle={16}
        >
          {!user?.id ? (
            <View style={ds.feedEmpty}>
              <Feather name="users" size={28} color="#2A3A52" />
              <Text style={ds.feedEmptyTitle}>Your Pilot Feed</Text>
              <Text style={ds.feedEmptyText}>Sign in and follow other pilots to see their flights, reports, and saves here.</Text>
            </View>
          ) : feedLoading ? (
            <View style={ds.feedEmpty}>
              <ActivityIndicator color="#38BDF8" />
            </View>
          ) : feedItems.length === 0 ? (
            <View style={ds.feedEmpty}>
              <Feather name="users" size={28} color="#2A3A52" />
              <Text style={ds.feedEmptyTitle}>No activity yet</Text>
              <Text style={ds.feedEmptyText}>Follow other pilots to see their flights and reports in your feed.</Text>
              <TouchableOpacity
                style={ds.feedFindBtn}
                onPress={() => { setDiscoverMode('discover'); setSearchMode('people'); setSearch(''); setSearchFocused(true); }}
                activeOpacity={0.7}
              >
                <Feather name="search" size={14} color="#38BDF8" />
                <Text style={ds.feedFindBtnText}>Find Pilots</Text>
              </TouchableOpacity>
            </View>
          ) : (
            feedItems.map((item, i) => (
              <TouchableOpacity
                key={`${item.type}-${item.icao}-${item.user_id}-${i}`}
                style={ds.feedCard}
                onPress={() => goToAirport(airports.find(a => aptIdent(a) === item.icao?.toUpperCase()) as Airport)}
                activeOpacity={0.7}
              >
                <View style={ds.feedCardHeader}>
                  <View style={ds.feedAvatar}>
                    <Feather name="user" size={14} color="#6B83A0" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={ds.feedUserName}>{item.userName}</Text>
                    {item.certificate && <Text style={ds.feedCert}>{item.certificate}</Text>}
                  </View>
                  <Text style={ds.feedTime}>{formatActivityTime(item.ts)}</Text>
                </View>
                <View style={ds.feedCardBody}>
                  <View style={ds.feedActionIcon}>
                    <Feather name={item.type === 'flight' ? 'navigation' : 'clipboard'} size={13} color={item.type === 'flight' ? '#38BDF8' : '#0D9488'} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={ds.feedActionText}>
                      {item.type === 'flight' ? 'Flew to ' : 'Reported on '}
                      <Text style={ds.feedIcao}>{item.icao}</Text>
                      {item.label && item.state ? ` · ${item.label}, ${item.state}` : item.label ? ` · ${item.label}` : ''}
                    </Text>
                    {item.notes?.trim() && (
                      <Text style={ds.feedNotes} numberOfLines={2}>{item.notes}</Text>
                    )}
                  </View>
                </View>
              </TouchableOpacity>
            ))
          )}
          <View style={{ height: 50 }} />
        </Animated.ScrollView>
      )}

      {flyTripEvent && (
        <FlyThisTrip
          event={flyTripEvent}
          onClose={() => setFlyTripEvent(null)}
          location={refPt ? { latitude: refPt.lat, longitude: refPt.lng } : null}
          userId={user?.id ?? null}
          saved={savedIds.has(String(flyTripEvent.id))}
          onSave={() => toggleFestivalSave(flyTripEvent)}
        />
      )}
    </View>
  );
}

// ── FeaturedDestinationCard ───────────────────────────────────────────────────

function FeaturedDestinationCard({ card, crewCarSet, cruiseSpeed, homeIdent, onPress }: {
  card: DestCard; crewCarSet: Set<string>; cruiseSpeed: number; homeIdent: string | null; onPress: () => void;
}) {
  const router = useRouter();
  const proof = socialProof(aptIdent(card.apt));
  const cardScale = useRef(new Animated.Value(1)).current;
  const handlePressIn  = () => Animated.spring(cardScale, { toValue: 0.985, useNativeDriver: true, tension: 300, friction: 20 }).start();
  const handlePressOut = () => Animated.spring(cardScale, { toValue: 1,     useNativeDriver: true, tension: 300, friction: 20 }).start();

  return (
    <Pressable onPress={onPress} onPressIn={handlePressIn} onPressOut={handlePressOut}>
      <Animated.View style={[fcd.card, { transform: [{ scale: cardScale }] }]}>

        {/* ── Top accent — signals primary/featured status ───────────────── */}
        <LinearGradient
          colors={['transparent', 'rgba(251,191,36,0.55)', 'transparent']}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
          style={fcd.accentBar}
          pointerEvents="none"
        />

        {/* ── Hero image ─────────────────────────────────────────────────── */}
        <View style={fcd.imgBox}>
          {card.photoUri ? (
            <Image source={{ uri: card.photoUri }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
          ) : (
            <View style={[StyleSheet.absoluteFillObject, { backgroundColor: CAT_COLORS[card.cat][0] }]}>
              <View style={[StyleSheet.absoluteFillObject, { backgroundColor: CAT_CHIP[card.cat].bg, opacity: 0.28 }]} />
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                <CatIcon cat={card.cat} size={56} color="#F0F4FF" />
              </View>
            </View>
          )}

          {/* Golden-hour warm cast at top */}
          <LinearGradient
            colors={['rgba(251,191,36,0.16)', 'transparent']}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 90 }}
            pointerEvents="none"
          />

          {/* Strong cinematic bottom fade for text legibility */}
          <LinearGradient
            colors={['transparent', 'transparent', 'rgba(5,8,18,0.78)', 'rgba(5,8,18,1.0)']}
            locations={[0, 0.25, 0.65, 1]}
            style={StyleSheet.absoluteFillObject}
            pointerEvents="none"
          />

          {/* Category chip — top-left */}
          <DiscoverCategoryChip cat={card.cat} />

          {/* Airport + destination name overlaid at bottom of image */}
          <View style={fcd.imgBottom}>
            <Text style={fcd.featIcao}>{aptIdent(card.apt)} · {card.apt.city}, {card.apt.state}</Text>
            <Text style={fcd.featPlace} numberOfLines={1}>{card.placeName}</Text>
          </View>
        </View>

        {/* ── Card body ──────────────────────────────────────────────────── */}
        <View style={fcd.body}>
          {/* Flight data pill */}
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
            <View style={ds.flightPill}>
              <Text style={ds.flightPillTxt}>{card.flightNm} nm</Text>
              <Text style={ds.flightPillDot}>·</Text>
              <Text style={ds.flightPillTxt}>{fmtFlight(card.flightNm, cruiseSpeed)}</Text>
              {card.distMi != null && (
                <>
                  <Text style={ds.flightPillDot}>·</Text>
                  <Text style={ds.flightPillTxt}>
                    {card.cat === 'food' ? proximityLabel(card.distMi) : `${card.distMi} mi`}
                  </Text>
                </>
              )}
            </View>
          </View>

          {/* Experiential description */}
          <Text style={fcd.hook}>{featHook(card.cat, card.distMi)}</Text>

          {/* CTA — primary action row */}
          <View style={fcd.ctaRow}>
            <TouchableOpacity
              style={fcd.ctaBtn}
              activeOpacity={0.75}
              onPress={e => {
                e.stopPropagation();
                router.push({
                  pathname: '/route',
                  params: {
                    ...(homeIdent ? { from: homeIdent } : {}),
                    to: aptIdent(card.apt),
                  },
                });
              }}
            >
              <Text style={fcd.ctaTxt}>Plan Flight</Text>
              <Feather name="arrow-right" size={12} color={SKY} />
            </TouchableOpacity>
          </View>

          {/* Social proof — below CTA, intentionally de-emphasized */}
          <View style={fcd.socialRow}>
            <MaterialCommunityIcons name="account-group-outline" size={10} color="#1E2E42" />
            <Text style={fcd.socialTxt}>{proof.saved} pilots saved · {proof.flew} flew recently</Text>
          </View>
        </View>
      </Animated.View>
    </Pressable>
  );
}

const fcd = StyleSheet.create({
  card: {
    borderRadius: 18, overflow: 'hidden',
    backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER,
    shadowColor: '#38BDF8', shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.12, shadowRadius: 32, elevation: 18,
  },
  imgBox: { width: '100%', height: 215, overflow: 'hidden' },
  imgBottom: {
    position: 'absolute', bottom: 14, left: 14, right: 14,
  },
  featIcao: {
    fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.45)',
    letterSpacing: 1.2, marginBottom: 4,
  },
  featPlace: {
    fontSize: 26, fontWeight: '900', color: '#F0F4FF', letterSpacing: -0.5,
    textShadowColor: 'rgba(0,0,0,0.80)',
    textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 10,
  },
  accentBar: { height: 2 },
  body: { padding: 16, paddingTop: 14, paddingBottom: 14 },
  hook: {
    fontSize: 13, color: '#7A94B2', lineHeight: 20,
    fontStyle: 'italic', marginBottom: 14, letterSpacing: 0.1,
  },
  // CTA gets its own row — clear visual hierarchy
  ctaRow: {
    flexDirection: 'row', alignItems: 'center', marginBottom: 10,
  },
  ctaBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(56,189,248,0.10)',
    borderRadius: 20, paddingVertical: 8, paddingHorizontal: 16,
    borderWidth: 1, borderColor: 'rgba(56,189,248,0.25)',
  },
  ctaTxt: { fontSize: 12, fontWeight: '700', color: SKY, letterSpacing: 0.4 },
  // Social proof — intentionally quiet, below CTA
  socialRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  socialTxt: { fontSize: 10, color: '#1E2E42', fontWeight: '500', letterSpacing: 0.2 },
});

// ── DiscoverSection ───────────────────────────────────────────────────────────

function DiscoverSection({
  label, cat, cards, crewCarSet, cruiseSpeed, onCardPress,
}: {
  label: string;
  cat: DestCat;
  cards: DestCard[] | null;
  crewCarSet: Set<string>;
  cruiseSpeed: number;
  onCardPress: (c: DestCard) => void;
}) {
  return (
    <View style={ds.section}>
      <View style={ds.secTitleRow}>
        <View style={ds.secTitleAccent} />
        <CatIcon cat={cat} size={16} color="#F0F4FF" />
        <Text style={ds.secTitle}>{label}</Text>
      </View>
      {cards === null ? (
        <DiscoverSkeletonRow />
      ) : cards.length === 0 ? null : (
        <FlatList
          horizontal
          data={cards}
          keyExtractor={c => c.key}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={ds.cardRow}
          renderItem={({ item: c }) => (
            <DiscoverDestinationCard card={c} crewCarSet={crewCarSet} cruiseSpeed={cruiseSpeed} onPress={() => onCardPress(c)} />
          )}
        />
      )}
    </View>
  );
}

// ── DiscoverDestinationCard ───────────────────────────────────────────────────

function DiscoverDestinationCard({ card, onPress, crewCarSet, cruiseSpeed }: { card: DestCard; onPress: () => void; crewCarSet: Set<string>; cruiseSpeed: number }) {
  const [dark] = CAT_COLORS[card.cat];
  const accent = CAT_CHIP[card.cat].bg;
  const hasCrewCar = crewCarSet.has(aptIdent(card.apt));
  const cardScale = useRef(new Animated.Value(1)).current;
  const handlePressIn  = () => Animated.spring(cardScale, { toValue: 0.97, useNativeDriver: true, tension: 300, friction: 20 }).start();
  const handlePressOut = () => Animated.spring(cardScale, { toValue: 1,    useNativeDriver: true, tension: 300, friction: 20 }).start();
  return (
    <Pressable onPress={onPress} onPressIn={handlePressIn} onPressOut={handlePressOut}>
    <Animated.View style={[ds.card, { transform: [{ scale: cardScale }] }]}>
      {/* Hero image */}
      <View style={ds.imgBox}>
        {card.photoUri ? (
          <Image
            source={{ uri: card.photoUri }}
            style={StyleSheet.absoluteFillObject}
            resizeMode="cover"
          />
        ) : (
          <View style={[StyleSheet.absoluteFillObject, { backgroundColor: dark }]}>
            <View style={[StyleSheet.absoluteFillObject, { backgroundColor: accent, opacity: 0.28 }]} />
            <View style={ds.imgFallback}>
              <CatIcon cat={card.cat} size={44} color="#F0F4FF" />
            </View>
          </View>
        )}
        {/* Cinematic vignette — subtle warm tint fades into dark glass body */}
        <LinearGradient
          colors={['transparent', 'rgba(10,8,4,0.55)', 'rgba(10,14,24,0.94)']}
          style={ds.imgOverlay}
          pointerEvents="none"
        />
        {/* Category chip — top-left */}
        <DiscoverCategoryChip cat={card.cat} />
      </View>

      {/* Card body — flex fills remaining height; top content + tags pinned to bottom */}
      <View style={ds.cardBody}>
        <View>
          <Text style={ds.cardIcao} numberOfLines={1}>
            {aptIdent(card.apt)} · {card.apt.city}, {card.apt.state}
          </Text>
          <Text style={ds.cardPlace} numberOfLines={2}>{card.placeName}</Text>

          {/* Flight data pill — instrument-style */}
          <View style={ds.flightPill}>
            <Text style={ds.flightPillTxt}>{card.flightNm} nm</Text>
            <Text style={ds.flightPillDot}>·</Text>
            <Text style={ds.flightPillTxt}>{fmtFlight(card.flightNm, cruiseSpeed)}</Text>
            {card.distMi != null && (
              <>
                <Text style={ds.flightPillDot}>·</Text>
                <Text style={ds.flightPillTxt}>
                  {card.cat === 'food' ? proximityLabel(card.distMi) : `${card.distMi} mi`}
                </Text>
              </>
            )}
          </View>

          {/* Food-specific: social proof + pilot favorite */}
          {card.cat === 'food' && (() => {
            const proof = socialProof(aptIdent(card.apt));
            const isFav = proof.saved > 35;
            return (
              <>
                {isFav && (
                  <View style={[ds.tag, ds.pilotFavTag]}>
                    <MaterialCommunityIcons name="star" size={10} color="#FBBF24" />
                    <Text style={[ds.tagTxt, { color: '#FBBF24' }]}>Top Pick</Text>
                  </View>
                )}
                <Text style={ds.socialProofTxt}>{proof.saved} saved · {proof.flew} flew this week</Text>
              </>
            );
          })()}
        </View>

        {(hasCrewCar || (card.amenityTags && card.amenityTags.length > 0)) && (
          <View style={ds.tagRow}>
            {card.amenityTags?.map(t => (
              <View key={t} style={ds.tag}>
                <Text style={ds.tagTxt}>{t}</Text>
              </View>
            ))}
            {hasCrewCar && (
              <View style={[ds.tag, { flexDirection: 'row', alignItems: 'center', gap: 4 }]}>
                <MaterialCommunityIcons name="car" size={10} color="#38BDF8" />
                <Text style={ds.tagTxt}>Crew Car</Text>
              </View>
            )}
          </View>
        )}
      </View>
    </Animated.View>
    </Pressable>
  );
}

// ── DiscoverCategoryChip ──────────────────────────────────────────────────────

function DiscoverCategoryChip({ cat }: { cat: DestCat }) {
  const { bg, border } = CAT_CHIP[cat];
  return (
    <View style={[ds.chip, { backgroundColor: bg, borderColor: border, flexDirection: 'row', alignItems: 'center', gap: 5 }]}>
      <CatIcon cat={cat} size={11} color="#fff" />
      <Text style={ds.chipTxt}>{CAT_LABEL[cat]}</Text>
    </View>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function DiscoverSkeletonCard() {
  return (
    <View style={[ds.card, { opacity: 0.35 }]}>
      <View style={[ds.imgBox, { backgroundColor: '#111827' }]} />
      <View style={ds.cardBody}>
        <View style={[ds.skelLine, { width: 140 }]} />
        <View style={[ds.skelLine, { width: 90, marginTop: 7 }]} />
        <View style={[ds.skelLine, { width: 115, marginTop: 7 }]} />
      </View>
    </View>
  );
}

function DiscoverSkeletonRow() {
  return (
    <View style={{ flexDirection: 'row', paddingHorizontal: 16, gap: 12 }}>
      <DiscoverSkeletonCard />
      <DiscoverSkeletonCard />
      <DiscoverSkeletonCard />
    </View>
  );
}

// ── NearbyFestivalsSection ────────────────────────────────────────────────────

const FEST_CARD_W = CARD_W;  // match destination card width

/** Shared compact event card — used by both festival and aviation sections */
function EventDiscoverCard({ event, onPress, onSave, saved }: {
  event: FestivalEntry;
  onPress: () => void;
  onSave: () => void;
  saved: boolean;
}) {
  const accent  = festAccent(event.category);
  const dateStr = fmtEventDate(event.start_date, event.end_date);
  const nm      = Math.round(event._nm);

  const cardScale     = useRef(new Animated.Value(1)).current;
  const bookmarkScale = useRef(new Animated.Value(1)).current;

  const handlePressIn  = () => Animated.spring(cardScale, { toValue: 0.97, useNativeDriver: true, tension: 300, friction: 20 }).start();
  const handlePressOut = () => Animated.spring(cardScale, { toValue: 1,    useNativeDriver: true, tension: 300, friction: 20 }).start();

  const handleSave = () => {
    Animated.sequence([
      Animated.spring(bookmarkScale, { toValue: 1.35, useNativeDriver: true, tension: 500, friction: 10 }),
      Animated.spring(bookmarkScale, { toValue: 1,    useNativeDriver: true, tension: 300, friction: 20 }),
    ]).start();
    onSave();
  };

  return (
    <Pressable onPress={onPress} onPressIn={handlePressIn} onPressOut={handlePressOut}>
      <Animated.View style={[fds.card, { transform: [{ scale: cardScale }] }]}>
        {/* Accent top line — thin color bar anchored to top edge */}
        <View style={[fds.accentLine, { backgroundColor: accent }]} />
        {/* Subtle top tint from accent color */}
        <LinearGradient
          colors={[accent + '18', 'transparent']}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 56 }}
          pointerEvents="none"
        />

        <View style={fds.cardInner}>
          {/* Row 1: category badge + bookmark */}
          <View style={fds.topRow}>
            <View style={[fds.catBadge, { backgroundColor: accent + '22', borderColor: accent + '50' }]}>
              <Text style={[fds.catBadgeTxt, { color: accent }]}>{event.category.toUpperCase()}</Text>
            </View>
            <TouchableOpacity
              onPress={e => { e.stopPropagation?.(); handleSave(); }}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              activeOpacity={1}
            >
              <Animated.View style={{ transform: [{ scale: bookmarkScale }] }}>
                <MaterialCommunityIcons
                  name={saved ? 'bookmark' : 'bookmark-outline'}
                  size={18}
                  color={saved ? '#FF6B20' : 'rgba(255,255,255,0.28)'}
                />
              </Animated.View>
            </TouchableOpacity>
          </View>

          {/* Row 2: countdown pill */}
          {(() => {
            const today = new Date(); today.setHours(0,0,0,0);
            const diff = Math.ceil((new Date(event.start_date + 'T12:00:00').getTime() - today.getTime()) / 86400000);
            if (diff < 0) return null;
            const label = diff === 0 ? 'Today!' : diff === 1 ? 'Tomorrow' : `In ${diff} days`;
            const isToday = diff === 0;
            return (
              <View style={fds.countdownRow}>
                <View style={[fds.countdownPill, isToday && fds.countdownPillToday]}>
                  <Text style={[fds.countdownTxt, isToday && { color: '#22C55E' }]}>{label}</Text>
                </View>
              </View>
            );
          })()}

          {/* Airport + location */}
          <Text style={fds.icaoLine} numberOfLines={1}>
            {event.nearest_airport} · {event.city}, {event.state}
          </Text>

          {/* Event title */}
          <Text style={fds.eventTitle} numberOfLines={2}>{event.event_name}</Text>

          {/* Brief teaser — first sentence of description */}
          {!!event.description && (
            <Text style={fds.descTxt} numberOfLines={2}>
              {event.description.split(/(?<=[.!?])\s+/)[0]}
            </Text>
          )}

          {/* Meta row */}
          <View style={fds.metaRow}>
            <View style={fds.metaPill}>
              <MaterialCommunityIcons name="calendar-month-outline" size={10} color={TEXT2} />
              <Text style={fds.metaTxt}>{dateStr}</Text>
            </View>
            <View style={fds.metaPill}>
              <MaterialCommunityIcons name="arrow-top-right" size={10} color={TEXT3} />
              <Text style={fds.metaTxt}>{nm} nm</Text>
            </View>
          </View>
        </View>
      </Animated.View>
    </Pressable>
  );
}

/** Reusable FlatList section for both Festivals and Aviation events */
function EventSection({
  title,
  accentColor,
  icon,
  events,
  onSeeAll,
  onCardPress,
  savedIds,
  onSave,
}: {
  title: string;
  accentColor: string;
  icon: React.ReactNode;
  events: FestivalEntry[];
  onSeeAll: () => void;
  onCardPress: (e: FestivalEntry) => void;
  savedIds: Set<string>;
  onSave: (e: FestivalEntry) => void;
}) {
  if (events.length === 0) return null;
  return (
    <View style={ds.section}>
      <View style={[ds.secTitleRow, fds.titleRow]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={[ds.secTitleAccent, { backgroundColor: accentColor }]} />
          {icon}
          <Text style={ds.secTitle}>{title}</Text>
        </View>
        <TouchableOpacity onPress={onSeeAll} style={fds.seeAllBtn} activeOpacity={0.7}>
          <Text style={fds.seeAllTxt}>See All</Text>
          <Feather name="arrow-right" size={12} color={SKY} />
        </TouchableOpacity>
      </View>
      <FlatList
        horizontal
        data={events}
        keyExtractor={e => e.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={ds.cardRow}
        renderItem={({ item: e }) => (
          <EventDiscoverCard
            event={e}
            onPress={() => onCardPress(e)}
            onSave={() => onSave(e)}
            saved={savedIds.has(String(e.id))}
          />
        )}
      />
    </View>
  );
}



// ── Styles ────────────────────────────────────────────────────────────────────

const ds = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },  // BG is fallback; gradient covers it

  // ── Hero header ────────────────────────────────────────────────────────────
  headerArea: {},
  hdr: {
    paddingHorizontal: 22, paddingBottom: 28,
  },
  hdrGreet: {
    fontSize: 11, color: ORANGE, fontWeight: '800',
    letterSpacing: 2.4, textTransform: 'uppercase',
    marginBottom: 10,
  },
  hdrTitle: {
    fontSize: 34, fontWeight: '900', color: TEXT1,
    lineHeight: 44, letterSpacing: -1.0,
  },
  // Location as a pill badge
  locationPill: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    alignSelf: 'flex-start', marginTop: 14,
    backgroundColor: 'rgba(56,189,248,0.07)',
    borderRadius: 20, paddingVertical: 6, paddingHorizontal: 12,
    borderWidth: 1, borderColor: 'rgba(56,189,248,0.18)',
  },
  locationDot: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: SKY,
  },
  locationPillTxt: {
    fontSize: 11, fontWeight: '700', color: SKY, letterSpacing: 0.4,
  },

  // ── Search ─────────────────────────────────────────────────────────────────
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, marginBottom: 6,
  },
  searchBox: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 18, paddingHorizontal: 16, paddingVertical: 14,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)',
  },
  searchBoxFocused: {
    borderColor: 'rgba(56,189,248,0.32)',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  searchIcon: { opacity: 1 },
  searchInput: { flex: 1, color: TEXT1, fontSize: 15, fontWeight: '500' },
  searchClear: { padding: 4 },
  searchDone: { paddingHorizontal: 4 },
  searchDoneTxt: { color: SKY, fontSize: 15, fontWeight: '600' },

  // ── Search dropdown ─────────────────────────────────────────────────────────
  // maxHeight instead of flex:1 so 1–2 results don't leave a giant empty box
  dropdownBox: {
    maxHeight: 440, marginHorizontal: 16, marginTop: 8,
    backgroundColor: SURFACE2, borderRadius: 16,
    borderWidth: 1, borderColor: 'rgba(56,189,248,0.14)', overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5, shadowRadius: 22, elevation: 12,
  },
  dropdownLabel: {
    fontSize: 10, fontWeight: '800', color: TEXT3,
    letterSpacing: 2, textTransform: 'uppercase',
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6,
  },
  resultRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(56,189,248,0.1)',
  },
  resultRowPressed: {
    backgroundColor: 'rgba(249,115,22,0.07)',
  },
  // PRIMARY — ICAO is the fastest scan target for pilots
  resultId: { fontSize: 17, fontWeight: '900', color: ORANGE, marginBottom: 2, letterSpacing: 0.5 },
  // SECONDARY — airport name, clean white, clearly subordinate
  resultName: { fontSize: 13, fontWeight: '600', color: TEXT1, marginBottom: 1 },
  // TERTIARY — city/state, muted, quieter presence
  resultCity: { fontSize: 11, fontWeight: '400', color: TEXT3, letterSpacing: 0.1 },
  // DATA — elevation, right-aligned, technical numeric feel
  resultMeta: { fontSize: 11, fontWeight: '700', color: TEXT3, letterSpacing: 0.8, fontVariant: ['tabular-nums'] },
  // Amenity icons grouped in a tight 2×2 grid
  amenityRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 3, justifyContent: 'flex-end', maxWidth: 76 },
  // Each icon in its own tiny pill for visual separation
  amenityChip: {
    backgroundColor: 'rgba(56,189,248,0.08)',
    borderRadius: 6, paddingHorizontal: 5, paddingVertical: 3,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(56,189,248,0.22)',
  },
  noResults: { color: TEXT3, padding: 20, textAlign: 'center', fontSize: 14 },

  // Search mode toggle
  searchToggle: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 6 },
  searchToggleBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: '#1E2D42',
  },
  searchToggleBtnActive: { backgroundColor: '#38BDF8', borderColor: '#38BDF8' },
  searchToggleText: { fontSize: 13, fontWeight: '600', color: '#6B83A0' },
  searchToggleTextActive: { color: '#0D1421', fontWeight: '700' },
  pilotAvatar: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: '#0A1628',
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#1E2D42', marginRight: 10,
  },

  // Discover / Feed toggle
  modeToggleRow: { flexDirection: 'row', gap: 0, marginHorizontal: 20, marginTop: 10, marginBottom: 14, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 12, borderWidth: 1, borderColor: '#1E2D42', padding: 3 },
  modeToggleBtn: { flex: 1, paddingVertical: 9, alignItems: 'center', borderRadius: 9 },
  modeToggleBtnActive: { backgroundColor: 'rgba(56,189,248,0.12)', borderWidth: 1, borderColor: 'rgba(56,189,248,0.30)' },
  modeToggleText: { fontSize: 14, fontWeight: '600', color: '#4A5B73' },
  modeToggleTextActive: { color: '#38BDF8', fontWeight: '700' },

  // Feed view
  feedEmpty: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60, paddingHorizontal: 32, gap: 10 },
  feedEmptyTitle: { fontSize: 18, fontWeight: '700', color: '#F0F4FF' },
  feedEmptyText: { fontSize: 14, color: '#6B83A0', textAlign: 'center', lineHeight: 21 },
  feedFindBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: '#1E2D42' },
  feedFindBtnText: { fontSize: 14, fontWeight: '600', color: '#38BDF8' },
  feedCard: {
    marginHorizontal: 16, marginBottom: 12,
    backgroundColor: 'rgba(10,18,36,0.97)', borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
  feedCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  feedAvatar: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: '#0A1628',
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#1E2D42',
  },
  feedUserName: { fontSize: 14, fontWeight: '700', color: '#F0F4FF' },
  feedCert: { fontSize: 11, color: '#4A5B73' },
  feedTime: { fontSize: 11, color: '#4A5B73' },
  feedCardBody: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  feedActionIcon: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(56,189,248,0.06)',
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  feedActionText: { fontSize: 14, color: '#C8D8EE', lineHeight: 20 },
  feedIcao: { fontWeight: '700', color: '#38BDF8' },
  feedNotes: { fontSize: 12, color: '#6B83A0', lineHeight: 18, marginTop: 4 },

  // (compact activity styles removed — feed now has its own tab)
  dismissBtn: { paddingLeft: 12, paddingVertical: 8 },
  dismissTxt: { color: TEXT3, opacity: 0.55 },

  // ── Sections ───────────────────────────────────────────────────────────────
  scroll: { paddingTop: 16, paddingBottom: 60 },
  section: { marginBottom: 32 },
  secTitleRow: {
    flexDirection: 'row', alignItems: 'center', gap: 9,
    paddingHorizontal: 20, marginBottom: 14,
  },
  secTitleAccent: {
    width: 2, height: 16, borderRadius: 1, backgroundColor: ORANGE,
  },
  secTitle: {
    fontSize: 17, fontWeight: '900', color: TEXT1, letterSpacing: -0.5,
  },
  cardRow: { paddingHorizontal: 16, gap: 14 },

  // Surprise Me block — hero surface, same glass system as cards
  surpriseWrap: {
    marginHorizontal: 16, marginBottom: 8,
    backgroundColor: SURFACE, borderRadius: 16,
    borderWidth: 1, borderColor: BORDER,
    padding: 16, gap: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.5, shadowRadius: 14, elevation: 8,
  },
  surpriseDesc: { fontSize: 14, color: TEXT3, lineHeight: 20 },

  // ── DiscoverDestinationCard ────────────────────────────────────────────────
  card: {
    width: CARD_W, height: CARD_H, borderRadius: 16, overflow: 'hidden',
    backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER,
    shadowColor: '#000', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.55, shadowRadius: 14, elevation: 9,
  },
  imgBox: { width: CARD_W, height: IMG_H, overflow: 'hidden' },
  imgFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  imgEmoji: { fontSize: 44 },
  // Cinematic vignette — deeper fade into card body for richer contrast
  imgOverlay: {
    position: 'absolute', bottom: 0, left: 0, right: 0, height: '70%',
  },

  // ── DiscoverCategoryChip ──────────────────────────────────────────────────
  chip: {
    position: 'absolute', top: 10, left: 10,
    borderRadius: 20, paddingVertical: 4, paddingHorizontal: 10,
    borderWidth: 1,
  },
  chipTxt: { fontSize: 10, fontWeight: '800', color: '#fff', letterSpacing: 0.5 },

  // Card body — flex:1 fills height after imgBox; space-between pins tags to bottom
  cardBody: { padding: 14, flex: 1, justifyContent: 'space-between' },
  cardIcao: {
    fontSize: 11, fontWeight: '700', color: TEXT3,   // metadata — quiet, subordinate
    letterSpacing: 0.8, marginBottom: 4,
  },
  cardPlace: {
    fontSize: 14, fontWeight: '700', color: TEXT1,   // destination name — strong, scannable
    lineHeight: 19, letterSpacing: -0.2, marginBottom: 9,
  },
  // Instrument-style flight data pill
  flightPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(0,0,0,0.50)',
    borderRadius: 10, paddingVertical: 4, paddingHorizontal: 10,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)',
  },
  flightPillTxt: { fontSize: 11, color: TEXT2, fontWeight: '600', fontVariant: ['tabular-nums'] },
  flightPillDot: { fontSize: 10, color: 'rgba(255,255,255,0.2)' },

  tagRow: { flexDirection: 'row', gap: 5, flexWrap: 'wrap' },
  tag: {
    backgroundColor: 'rgba(56,189,248,0.09)',
    borderRadius: 10, paddingVertical: 2, paddingHorizontal: 7,
    borderWidth: 1, borderColor: 'rgba(56,189,248,0.15)',
  },
  tagTxt: { fontSize: 10, color: SKY, fontWeight: '700' },

  // Pilot favorite tag variant
  pilotFavTag: {
    flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6,
    backgroundColor: 'rgba(251,191,36,0.10)', borderColor: 'rgba(251,191,36,0.25)',
  },
  // Social proof under food cards
  socialProofTxt: { fontSize: 9, color: '#2A3D52', marginTop: 4, fontWeight: '500' },

  // Skeleton cards
  skelLine: { height: 9, backgroundColor: SURFACE2, borderRadius: 4 },

  // Google Places key diagnostic banner
  placesKeyWarn: {
    backgroundColor: '#2A0A0A', borderWidth: 1, borderColor: '#7A2020',
    borderRadius: 10, marginHorizontal: 16, marginBottom: 8,
    paddingHorizontal: 14, paddingVertical: 9,
  },
  placesKeyWarnTxt: { color: '#FF8080', fontSize: 12, fontWeight: '600' },
});

// ── Festival / Aviation event card styles ─────────────────────────────────────

const fds = StyleSheet.create({
  // Card container — identical glass system to DiscoverDestinationCard
  card: {
    width: FEST_CARD_W, height: 205, borderRadius: 16, overflow: 'hidden',
    backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER,
    borderTopColor: 'rgba(255,255,255,0.10)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.55, shadowRadius: 14, elevation: 9,
  },

  // Thin accent color line anchored to very top of card
  accentLine: { height: 2, width: '100%' },

  // Card content padding — flex fills fixed card height, meta row pinned to bottom
  cardInner: { padding: 13, flex: 1, justifyContent: 'space-between' },

  // Top row: category badge + bookmark
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },

  // Category badge
  catBadge: {
    borderRadius: 7, borderWidth: 1,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  catBadgeTxt: { fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },
  countdownRow: { marginBottom: 8 },
  countdownPill: { alignSelf: 'flex-start', backgroundColor: '#1C1206', borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: ORANGE },
  countdownPillToday: { backgroundColor: '#0A1F0A', borderColor: '#22C55E' },
  countdownTxt: { color: ORANGE, fontSize: 10, fontWeight: '700' },

  // Airport + city line
  icaoLine: { fontSize: 10, fontWeight: '700', color: TEXT3, letterSpacing: 0.7, marginBottom: 4 },

  // Event title — strong, scannable, slightly larger for hierarchy
  eventTitle: {
    fontSize: 15, fontWeight: '800', color: TEXT1,
    lineHeight: 20, letterSpacing: -0.3, marginBottom: 5,
  },

  // One-sentence teaser pulled from event description
  descTxt: {
    fontSize: 11, color: TEXT3, lineHeight: 15, marginBottom: 6,
    fontStyle: 'italic',
  },

  // Bottom metadata row
  metaRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  metaPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(0,0,0,0.36)',
    borderRadius: 8, paddingVertical: 4, paddingHorizontal: 8,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)',
  },
  metaTxt: { fontSize: 11, color: TEXT2, fontWeight: '600', fontVariant: ['tabular-nums'] },

  // Section header
  titleRow: { justifyContent: 'space-between' },
  seeAllBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingVertical: 4, paddingHorizontal: 2,
  },
  seeAllTxt: {
    fontSize: 12, fontWeight: '700', color: SKY, letterSpacing: 0.2,
  },
});
