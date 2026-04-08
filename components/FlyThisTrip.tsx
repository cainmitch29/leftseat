/**
 * components/FlyThisTrip.tsx
 *
 * V1 trip-planning detail modal for festivals and aviation events.
 * Opens as a pageSheet when the user taps "Fly This Trip" on any card.
 *
 * Data pulled from:
 *   - event fields: nearest_airport, lat, lng, distance_miles, category, etc.
 *   - AsyncStorage userProfile: cruise_speed, home_airport (fallback when no GPS)
 *   - assets/images/airports.json: airport name, city, fuel
 *
 * Distance logic:
 *   1. GPS location (if available) → nearest_airport (lat/lng)
 *   2. Home airport (ICAO lookup) → nearest_airport (lat/lng)  [fallback]
 *   3. Neither available → "No location" shown cleanly
 *
 * Flight time = distNm / cruiseSpeed × 60  (defaults to 120 kts)
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { Image, Linking, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import airportsData from '../assets/images/airports.json';
import { useOgImage } from '../utils/ogImage';

// ── Design tokens ─────────────────────────────────────────────────────────────
import { SKY, BORDER, TEXT1, TEXT2, TEXT3 } from '../constants/theme';
const ORANGE = '#C4611A'; // intentionally muted in this modal context

const AVIATION_TYPES = new Set(['Fly-In','Airshow','Pancake Breakfast','Poker Run','EAA Event','AOPA Event','Other']);
const FEST_CAT_ACCENT: Record<string, string> = {
  'Food Festival': '#F59E0B',
  'Festival':      '#9B77F5',
};
function catAccent(cat: string): string {
  if (AVIATION_TYPES.has(cat)) return SKY;
  return FEST_CAT_ACCENT[cat] ?? TEXT3;
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

function distanceNm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3440.065;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function flightTimeLabel(nm: number, kts: number): string {
  const min = Math.round((nm / kts) * 60);
  if (min < 60) return `~${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `~${h}h` : `~${h}h ${m}m`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });
}

function daysUntilLabel(dateStr: string): string | null {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.ceil((new Date(dateStr + 'T12:00:00').getTime() - today.getTime()) / 86400000);
  if (diff < 0)  return null;
  if (diff === 0) return 'Today!';
  if (diff === 1) return 'Tomorrow';
  return `In ${diff} days`;
}

/** "100LL,A" → "100LL · Jet A" */
function formatFuel(fuel: string | null | undefined): string | null {
  if (!fuel) return null;
  return fuel.split(',').map(f => f.trim() === 'A' ? 'Jet A' : f.trim()).join(' · ');
}

/**
 * Dynamic decision summary: "Easy day trip · 42 min flight · 6 min drive"
 * All three segments are computed from live data and joined with ·
 */
function decisionLine(distNm: number | null, kts: number, groundMi: number): string {
  const parts: string[] = [];

  // Trip type bucket
  if (distNm !== null) {
    parts.push(
      distNm < 75  ? 'Quick hop'
      : distNm < 150 ? 'Perfect weekend trip'
      : distNm < 300 ? 'Easy day trip'
      : distNm < 500 ? 'Good cross-country'
      : 'Longer trip'
    );
    // Flight time in minutes
    const min = Math.round((distNm / kts) * 60);
    parts.push(`${min} min flight`);
  }

  // Drive time from airport (~30 mph average)
  if (groundMi > 0) {
    const driveMin = Math.round(groundMi * 2);  // 30 mph = 2 min/mile
    parts.push(`${driveMin} min drive`);
  } else if (distNm !== null) {
    parts.push('land and walk');
  }

  return parts.length > 0
    ? parts.join(' · ')
    : 'Event is held at the airport';
}

/**
 * Short social pull-line based on category — shown under the event title.
 * Returns null for unknown categories so we can hide the line cleanly.
 */
function socialLine(category: string): string | null {
  if (category === 'Fly-In')            return 'Pilots flying in';
  if (category === 'Airshow')           return 'Airshow crowd expected';
  if (category === 'Pancake Breakfast') return 'Classic fly-in breakfast';
  if (category === 'EAA Event')         return 'EAA members welcome';
  if (category === 'AOPA Event')        return 'AOPA members welcome';
  if (category === 'Food Festival')     return 'Great food + live music';
  if (category === 'Festival')          return 'Popular community festival';
  return null;
}

/**
 * Apple Maps driving directions: airport → event venue.
 * Uses venue coordinates when available, falls back to city/state text search.
 */
function getMapsUrl(event: any, airport: any | null): string {
  const srcLat = airport?.lat;
  const srcLng = airport?.lng;
  const src = (srcLat && srcLng)
    ? `${srcLat},${srcLng}`
    : encodeURIComponent(event.nearest_airport);
  const dstLat = event.event_lat;
  const dstLng = event.event_lng;
  const dst = (dstLat && dstLng)
    ? `${dstLat},${dstLng}`
    : encodeURIComponent(`${event.city ?? ''}${event.state ? `, ${event.state}` : ''}`);
  return `https://maps.apple.com/?saddr=${src}&daddr=${dst}&dirflg=d`;
}

/** Find an airport record by any of its identifier fields. */
function findAirport(icao: string): any | null {
  if (!icao) return null;
  const key = icao.toUpperCase();
  return (airportsData as any[]).find(a =>
    (a.icao ?? '').toUpperCase() === key ||
    (a.faa  ?? '').toUpperCase() === key ||
    (a.id   ?? '').toUpperCase() === key
  ) ?? null;
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  event:    any | null;
  onClose:  () => void;
  location: { latitude: number; longitude: number } | null;
  userId:   string | null;
  saved:    boolean;
  onSave:   () => void;
}

export default function FlyThisTrip({ event, onClose, location, userId, saved, onSave }: Props) {
  const router = useRouter();
  const [cruiseSpeed,    setCruiseSpeed]    = useState(120);  // kts — default until profile loads
  const [homeAirportKey, setHomeAirportKey] = useState<string | null>(null);
  const heroImage = useOgImage(event?.event_link);

  // Load cruise speed + home airport from cached profile once modal opens
  useEffect(() => {
    if (!userId || !event) return;
    AsyncStorage.getItem(`userProfile:${userId}`).then(raw => {
      if (!raw) return;
      try {
        const p = JSON.parse(raw);
        const s = Number(p.cruise_speed);
        if (s > 0) setCruiseSpeed(s);
        if (p.home_airport) setHomeAirportKey(p.home_airport.toUpperCase());
      } catch {}
    });
  }, [userId, event]);

  // Airport lookup (name, city, fuel) for the event's nearest_airport
  const airport = useMemo(() => findAirport(event?.nearest_airport ?? ''), [event]);

  // Distance calculation — GPS first, then home airport fallback.
  //
  // DESTINATION: prefer airports.json lat/lng (always accurate, covers Missouri
  // festivals whose event.lat/lng are 0). Fall back to event's embedded coords.
  // event.lat === 0 is falsy in JS, so trusting it directly caused "Set home
  // airport" to show even when a valid home airport was loaded.
  const { distNm, distSource } = useMemo<{ distNm: number | null; distSource: string | null }>(() => {
    if (!event) return { distNm: null, distSource: null };

    // Resolve destination coordinates from airports.json first
    const destAirport = findAirport(event.nearest_airport ?? '');
    const aptLat: number | null = destAirport?.lat ?? (event.lat  || null);
    const aptLng: number | null = destAirport?.lng ?? (event.lng  || null);
    if (!aptLat || !aptLng) return { distNm: null, distSource: null };

    // 1 — GPS location
    if (location?.latitude && location?.longitude) {
      return {
        distNm:     Math.round(distanceNm(location.latitude, location.longitude, aptLat, aptLng)),
        distSource: 'your location',
      };
    }

    // 2 — Home airport fallback
    if (homeAirportKey) {
      const home = findAirport(homeAirportKey);
      if (home?.lat && home?.lng) {
        return {
          distNm:     Math.round(distanceNm(home.lat, home.lng, aptLat, aptLng)),
          distSource: homeAirportKey,
        };
      }
    }

    return { distNm: null, distSource: null };
  }, [event, location, homeAirportKey]);

  if (!event) return null;

  // Ground distance in statute miles — prefer airport_distance_nm (v3, labeled in nm),
  // fall back to distance_miles (v2, also stored in nm despite the name).
  const gndMi = (() => {
    if (event.airport_distance_nm != null && event.airport_distance_nm > 0)
      return Math.round(event.airport_distance_nm * 1.15078);
    if (event.distance_miles != null && event.distance_miles > 0)
      return Math.round(event.distance_miles * 1.15078);
    return 0;
  })();

  const fuel         = formatFuel(airport?.fuel);
  const countdown    = daysUntilLabel(event.start_date);
  const isToday      = countdown === 'Today!';
  const accent       = catAccent(event.category);
  const isAviation   = AVIATION_TYPES.has(event.category);
  const dateLabel    = formatDate(event.start_date);
  const endLabel     = event.end_date && event.end_date !== event.start_date
                       ? ` – ${formatDate(event.end_date)}` : '';

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={s.container}>

        {/* ── Drag handle ──────────────────────────────────────────────── */}
        <View style={s.dragHandleRow}>
          <View style={s.dragHandle} />
        </View>

        {/* ── Header ──────────────────────────────────────────────────── */}
        <View style={s.header}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <MaterialCommunityIcons name="airplane-takeoff" size={18} color={SKY} />
            <Text style={s.headerTitle}>Fly This Trip</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
            <TouchableOpacity onPress={onSave} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <MaterialCommunityIcons
                name={saved ? 'bookmark' : 'bookmark-outline'}
                size={24}
                color={saved ? ORANGE : '#6B83A0'}
              />
            </TouchableOpacity>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Feather name="x" size={22} color="#6B83A0" />
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>

          {/* ── Hero image (og:image from event website) ─────────────── */}
          {heroImage ? (
            <Image
              source={{ uri: heroImage }}
              style={s.heroImage}
              resizeMode="cover"
            />
          ) : null}

          {/* ── All padded content ───────────────────────────────────── */}
          <View style={s.content}>

          {/* ── Top meta: category badge + urgency ──────────────────── */}
          <View style={s.topMeta}>
            <View style={[s.catBadge, { backgroundColor: accent + '18', borderColor: accent + '38' }]}>
              <Text style={[s.catTxt, { color: accent }]}>{event.category.toUpperCase()}</Text>
            </View>
            {countdown && (
              <View style={[s.countdownPill, isToday && s.countdownPillToday]}>
                <Text style={[s.countdownTxt, isToday && s.countdownTxtToday]}>{countdown}</Text>
              </View>
            )}
          </View>

          {/* ── Event name + social pull line + date + location ─────── */}
          <Text style={s.eventName}>{event.event_name}</Text>
          {socialLine(event.category) && (
            <Text style={[s.socialLine, { color: accent }]}>{socialLine(event.category)}</Text>
          )}
          <Text style={s.date}>{dateLabel}{endLabel}</Text>
          {(event.city || event.state) ? (
            <Text style={s.location}>
              {event.city}{event.state ? `, ${event.state}` : ''}
            </Text>
          ) : null}

          {/* ── Trip at a glance ────────────────────────────────────── */}
          <Text style={s.sectionLabel}>TRIP AT A GLANCE</Text>
          <View style={s.glanceRow}>

            {/* Flight card — slightly elevated to signal it's the primary stat */}
            <View style={[s.glanceCard, s.glanceCardFlight]}>
              <MaterialCommunityIcons name="airplane" size={20} color={SKY} />
              <Text style={s.glanceCardLabel}>Flight</Text>
              {distNm !== null ? (
                <>
                  <Text style={[s.glanceCardValue, { color: SKY }]}>{distNm} nm</Text>
                  <Text style={s.glanceCardSub}>{flightTimeLabel(distNm, cruiseSpeed)}</Text>
                  {distSource !== 'your location' && distSource && (
                    <Text style={s.glanceCardFrom}>from {distSource}</Text>
                  )}
                </>
              ) : (
                <Text style={s.glanceCardEmpty}>Set home{'\n'}airport</Text>
              )}
            </View>

            {/* Ground card */}
            <View style={s.glanceCard}>
              <MaterialCommunityIcons name="car" size={20} color={TEXT2} />
              <Text style={s.glanceCardLabel}>Ground</Text>
              {gndMi > 0 ? (
                <>
                  <Text style={s.glanceCardValue}>{gndMi} mi</Text>
                  <Text style={s.glanceCardSub}>from {event.nearest_airport}</Text>
                </>
              ) : (
                <>
                  <Text style={s.glanceCardValue}>At</Text>
                  <Text style={s.glanceCardSub}>the airport</Text>
                </>
              )}
            </View>

            {/* Fuel card */}
            <View style={s.glanceCard}>
              <MaterialCommunityIcons name="gas-station" size={20} color={fuel ? '#22C55E' : TEXT3} />
              <Text style={s.glanceCardLabel}>Fuel</Text>
              {fuel ? (
                fuel.split(' · ').map((f, i) => (
                  <Text key={i} style={[s.glanceCardValue, { fontSize: 11, lineHeight: 16 }]}>{f}</Text>
                ))
              ) : (
                <Text style={s.glanceCardEmpty}>Check FBO</Text>
              )}
            </View>

          </View>

          {/* Decision summary line */}
          <Text style={s.decisionLine}>{decisionLine(distNm, cruiseSpeed, gndMi)}</Text>

          {/* Cruise speed note */}
          {distNm !== null && (
            <Text style={s.cruiseNote}>
              Estimated at {cruiseSpeed} kts cruise
            </Text>
          )}

          {/* ── Destination airport ──────────────────────────────────── */}
          <Text style={s.sectionLabel}>DESTINATION AIRPORT</Text>
          <TouchableOpacity
            style={s.airportCard}
            activeOpacity={0.8}
            onPress={() => {
              onClose();
              router.push({ pathname: '/airport', params: { icao: event.nearest_airport } });
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={s.airportIcao}>{event.nearest_airport}</Text>
              {airport?.name ? <Text style={s.airportName} numberOfLines={1}>{airport.name}</Text> : null}
              {airport?.city ? (
                <Text style={s.airportCity}>
                  {airport.city}{airport.state ? `, ${airport.state}` : ''}
                </Text>
              ) : null}
            </View>
            <View style={s.viewAirportBtn}>
              <MaterialCommunityIcons name="office-building" size={12} color={SKY} />
              <Text style={s.viewAirportTxt}>View Airport</Text>
            </View>
          </TouchableOpacity>

          {/* ── About this event ─────────────────────────────────────── */}
          {event.description ? (
            <>
              <Text style={s.sectionLabel}>ABOUT THIS {isAviation ? 'EVENT' : 'FESTIVAL'}</Text>
              <Text style={s.desc}>{event.description}</Text>
            </>
          ) : null}

          {/* ── Actions ──────────────────────────────────────────────── */}
          <View style={s.actions}>

            {/* Plan route — primary CTA when home airport is known */}
            {homeAirportKey && event.nearest_airport ? (
              <TouchableOpacity
                style={s.primaryBtn}
                activeOpacity={0.85}
                onPress={() => {
                  onClose();
                  router.push({
                    pathname: '/route',
                    params: { from: homeAirportKey, to: event.nearest_airport },
                  });
                }}
              >
                <MaterialCommunityIcons name="airplane-takeoff" size={16} color="#0D1421" />
                <Text style={s.primaryBtnTxt}>Plan This Route</Text>
              </TouchableOpacity>
            ) : null}

            {/* Maps */}
            <TouchableOpacity
              style={s.secondaryBtn}
              onPress={() => Linking.openURL(getMapsUrl(event, airport))}
              activeOpacity={0.8}
            >
              <MaterialCommunityIcons name="map-marker-radius" size={14} color={TEXT2} />
              <Text style={s.secondaryBtnTxt}>Open in Maps</Text>
            </TouchableOpacity>

            {/* Event/festival website */}
            {event.event_link ? (
              <TouchableOpacity
                style={s.secondaryBtn}
                onPress={() => Linking.openURL(event.event_link)}
                activeOpacity={0.8}
              >
                <Feather name="external-link" size={13} color={TEXT2} />
                <Text style={s.secondaryBtnTxt}>
                  {isAviation ? 'View Event Website' : 'View Festival Website'}
                </Text>
              </TouchableOpacity>
            ) : null}

          </View>

          </View>{/* end content */}
        </ScrollView>
      </View>
    </Modal>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#080F1C' },
  dragHandleRow: { alignItems: 'center', paddingTop: 10, paddingBottom: 4 },
  dragHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.18)' },

  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 22, paddingTop: 20, paddingBottom: 16,
    borderBottomWidth: 1, borderBottomColor: '#1A2D44',
  },
  headerTitle: { fontSize: 17, fontWeight: '800', color: TEXT1 },

  body: { paddingBottom: 52 },

  heroImage: {
    width: '100%', height: 190,
  },
  content: { paddingHorizontal: 22, paddingTop: 20 },

  topMeta: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  catBadge: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4 },
  catTxt: { fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  countdownPill: {
    backgroundColor: '#1C1206', borderRadius: 20,
    paddingHorizontal: 10, paddingVertical: 3,
    borderWidth: 1, borderColor: ORANGE,
  },
  countdownPillToday: { backgroundColor: '#0A1F0A', borderColor: '#22C55E' },
  countdownTxt: { color: ORANGE, fontSize: 11, fontWeight: '700' },
  countdownTxtToday: { color: '#22C55E' },

  eventName: {
    fontSize: 24, fontWeight: '800', color: TEXT1,
    letterSpacing: -0.5, lineHeight: 30, marginBottom: 4,
  },
  socialLine: { fontSize: 12, fontWeight: '600', opacity: 0.8, marginBottom: 8 },
  date:     { fontSize: 14, color: TEXT2, marginBottom: 2 },
  location: { fontSize: 14, color: TEXT3, marginBottom: 24 },

  sectionLabel: {
    fontSize: 10, fontWeight: '800', letterSpacing: 1.2,
    color: '#3A5472', marginBottom: 12,
  },

  // Trip at a glance cards
  glanceRow: { flexDirection: 'row', gap: 10, marginBottom: 6 },
  glanceCard: {
    flex: 1, backgroundColor: 'rgba(13,24,41,0.95)',
    borderRadius: 14, borderWidth: 1, borderColor: BORDER,
    padding: 14, gap: 4, alignItems: 'flex-start',
  },
  // Flight card gets a subtle sky border to signal it's the key stat
  glanceCardFlight: { borderColor: SKY + '40', backgroundColor: 'rgba(10,24,44,0.98)' },
  glanceCardLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5, color: TEXT3, marginTop: 6 },
  glanceCardValue: { fontSize: 15, fontWeight: '800', color: TEXT1 },
  glanceCardSub:   { fontSize: 11, color: TEXT3 },
  glanceCardFrom:  { fontSize: 10, color: '#3A5472' },
  glanceCardEmpty: { fontSize: 11, color: '#3A5472', fontStyle: 'italic', marginTop: 2, lineHeight: 16 },

  decisionLine: { fontSize: 12, color: TEXT2, fontStyle: 'italic', marginBottom: 4 },
  cruiseNote: { fontSize: 11, color: '#3A5472', marginBottom: 24, marginTop: 2 },

  // Airport card
  airportCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: 'rgba(13,24,41,0.95)',
    borderRadius: 14, borderWidth: 1, borderColor: '#1A2D44',
    padding: 16, marginBottom: 28,
  },
  airportIcao: { fontSize: 22, fontWeight: '800', color: ORANGE, letterSpacing: 1, marginBottom: 3 },
  airportName: { fontSize: 13, color: TEXT2, fontWeight: '500', marginBottom: 2 },
  airportCity: { fontSize: 12, color: TEXT3 },
  viewAirportBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: SKY + '18', borderRadius: 10,
    paddingVertical: 8, paddingHorizontal: 12,
    borderWidth: 1, borderColor: SKY + '30',
  },
  viewAirportTxt: { fontSize: 12, fontWeight: '700', color: SKY },

  desc: { fontSize: 14, color: TEXT2, lineHeight: 22, marginBottom: 28 },

  // Actions
  actions: { gap: 10 },
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: SKY, borderRadius: 14, paddingVertical: 15,
  },
  primaryBtnTxt: { color: '#0D1421', fontSize: 15, fontWeight: '700' },
  secondaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: 14, paddingVertical: 14,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1, borderColor: BORDER,
  },
  secondaryBtnSaved:  { borderColor: '#C4611A44', backgroundColor: '#C4611A0E' },
  secondaryBtnTxt:    { color: TEXT2, fontSize: 14, fontWeight: '600' },

  // Save button — ghost/minimal, lowest visual weight
  ghostBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderRadius: 14, paddingVertical: 11,
  },
  ghostBtnSaved: {},
  ghostBtnTxt: { color: TEXT3, fontSize: 13, fontWeight: '500' },
});
