/**
 * app/route.tsx  ·  Route Planner
 *
 * Enter a departure (From) and destination (To) airport.
 * Finds airports within 25 nm of the straight-line corridor,
 * shows them on a Google Static Map, and lists them as tappable
 * stop cards that open the full airport screen.
 */

import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import {
  FlatList, Image, KeyboardAvoidingView, Platform,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import airportsData from '../assets/images/airports.json';
import { GOOGLE_KEY } from '../utils/config';
import { Colors, ORANGE, SKY } from '../constants/theme';
import { supabase } from '../lib/supabase';

// ── Design tokens ──────────────────────────────────────────────────────────────
const BG     = Colors.bg.bottom;   // '#0A0F1C'
const STEEL  = Colors.accent.steel; // '#4E6E8A'

// ── Types ──────────────────────────────────────────────────────────────────────
interface Airport {
  icao: string | null; faa: string | null; id: string;
  name: string; city: string; state: string;
  lat: number; lng: number;
  fuel?: string; has_tower?: string;
  nearestFoodNm?: number;
  nearestHotelNm?: number;
  nearestAttractionNm?: number;
  nearestGolfNm?: number;
  nearestGolfName?: string;
}

interface Stop {
  airport: Airport;
  deviationNm: number;   // perpendicular distance from route line
  legFromNm: number;     // From → Stop distance
  legToNm: number;       // Stop → To distance
  extraNm: number;       // extra nm vs. direct route
}

// ── Airport data ───────────────────────────────────────────────────────────────
const ALL_AIRPORTS: Airport[] = (airportsData as any[]).filter(
  a => a.lat != null && a.lng != null
);

function ident(a: Airport): string {
  return (a.icao || a.faa || a.id || '').toUpperCase();
}

function searchAirports(q: string): Airport[] {
  const query = q.trim().toLowerCase();
  if (query.length < 2) return [];
  return ALL_AIRPORTS.filter(a => {
    const code = ident(a).toLowerCase();
    return code.startsWith(query) ||
      (a.name || '').toLowerCase().includes(query) ||
      (a.city || '').toLowerCase().includes(query);
  }).slice(0, 8);
}

// ── Geometry helpers ───────────────────────────────────────────────────────────

function haversineNm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3440.065;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Perpendicular distance (nm) from point P to segment AB.
 * Uses flat-earth projection — accurate enough for < 500 nm routes.
 */
function pointToSegmentNm(
  pLat: number, pLng: number,
  aLat: number, aLng: number,
  bLat: number, bLng: number,
): number {
  const refLat = (aLat + bLat) / 2;
  const cos = Math.cos(refLat * Math.PI / 180);
  const NM = 60; // 1 degree lat ≈ 60 nm

  const ax = aLng * cos * NM; const ay = aLat * NM;
  const bx = bLng * cos * NM; const by = bLat * NM;
  const px = pLng * cos * NM; const py = pLat * NM;

  const abx = bx - ax; const aby = by - ay;
  const apx = px - ax; const apy = py - ay;
  const ab2 = abx * abx + aby * aby;
  const t   = ab2 === 0 ? 0 : Math.max(0, Math.min(1, (apx * abx + apy * aby) / ab2));

  const cx = ax + t * abx; const cy = ay + t * aby;
  return Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
}

/** Estimate flight time string from distance in nm and cruise speed in kts. */
function flightTime(nm: number, kts: number): string {
  const min = Math.round((nm / Math.max(kts, 60)) * 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

// ── Static map URL ──────────────────────────────────────────────────────────────

function buildMapUrl(from: Airport, to: Airport, stops: Stop[]): string {
  const path = `path=color:0x38BDF8CC|weight:3|${from.lat},${from.lng}|${to.lat},${to.lng}`;
  const fromPin = `markers=color:0xFF4D00|label:D|${from.lat},${from.lng}`;
  const toPin   = `markers=color:0xFF4D00|label:A|${to.lat},${to.lng}`;
  const stopPins = stops.length > 0
    ? `markers=size:small|color:0x38BDF8FF|${stops.map(s => `${s.airport.lat},${s.airport.lng}`).join('|')}`
    : '';

  const parts = [
    'size=600x260',
    'scale=2',
    'maptype=terrain',
    path, fromPin, toPin,
    ...(stopPins ? [stopPins] : []),
    `key=${GOOGLE_KEY}`,
  ];
  return `https://maps.googleapis.com/maps/api/staticmap?${parts.join('&')}`;
}

// ── Corridor computation ───────────────────────────────────────────────────────
const CORRIDOR_NM = 25; // max perpendicular deviation
const MAX_STOPS   = 10;

const MIN_ROUTE_NM = 70; // no stops shown for routes shorter than this

function findStops(from: Airport, to: Airport): Stop[] {
  const directNm = haversineNm(from.lat, from.lng, to.lat, to.lng);
  if (directNm < MIN_ROUTE_NM) return [];
  const fromId = ident(from);
  const toId   = ident(to);

  return ALL_AIRPORTS
    .filter(a => {
      const id = ident(a);
      if (id === fromId || id === toId) return false;
      const dev = pointToSegmentNm(a.lat, a.lng, from.lat, from.lng, to.lat, to.lng);
      return dev <= CORRIDOR_NM;
    })
    .map(a => {
      const legFrom = haversineNm(from.lat, from.lng, a.lat, a.lng);
      const legTo   = haversineNm(a.lat, a.lng, to.lat, to.lng);
      const dev     = pointToSegmentNm(a.lat, a.lng, from.lat, from.lng, to.lat, to.lng);
      return {
        airport: a,
        deviationNm: Math.round(dev * 10) / 10,
        legFromNm:   Math.round(legFrom),
        legToNm:     Math.round(legTo),
        extraNm:     Math.round(legFrom + legTo - directNm),
      };
    })
    // Pick best stops across the whole route (least deviation), then display in flight order
    .sort((a, b) => {
      const devDiff = a.deviationNm - b.deviationNm;
      if (Math.abs(devDiff) > 2) return devDiff;
      const aFuel = a.airport.fuel ? 1 : 0;
      const bFuel = b.airport.fuel ? 1 : 0;
      return bFuel - aFuel;
    })
    .slice(0, MAX_STOPS)
    // Re-sort for display: departure → destination order
    .sort((a, b) => a.legFromNm - b.legFromNm);
}

// ── Airport search field ───────────────────────────────────────────────────────

function AirportField({
  label, value, selected, onChangeText, onSelect, onClear, results, focused, onFocus, onBlur,
}: {
  label: string;
  value: string;
  selected: Airport | null;
  onChangeText: (t: string) => void;
  onSelect: (a: Airport) => void;
  onClear: () => void;
  results: Airport[];
  focused: boolean;
  onFocus: () => void;
  onBlur: () => void;
}) {
  const inputRef = useRef<TextInput>(null);

  return (
    <View>
      <TouchableOpacity
        style={[ss.field, focused && ss.fieldFocused, selected && ss.fieldSelected]}
        onPress={() => inputRef.current?.focus()}
        activeOpacity={0.9}
      >
        <Text style={ss.fieldLabel}>{label}</Text>
        {selected ? (
          <View style={ss.fieldSelectedRow}>
            <Text style={ss.fieldIcao}>{ident(selected)}</Text>
            <Text style={ss.fieldName} numberOfLines={1}>{selected.name}</Text>
            <TouchableOpacity onPress={onClear} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Feather name="x" size={14} color="#4A6080" />
            </TouchableOpacity>
          </View>
        ) : (
          <TextInput
            ref={inputRef}
            style={ss.fieldInput}
            value={value}
            onChangeText={onChangeText}
            placeholder="ICAO, name, or city…"
            placeholderTextColor="#2E4260"
            autoCapitalize="characters"
            autoCorrect={false}
            onFocus={onFocus}
            onBlur={onBlur}
            returnKeyType="search"
          />
        )}
      </TouchableOpacity>

      {focused && results.length > 0 && (
        <View style={ss.dropdown}>
          {results.map((a, i) => (
            <TouchableOpacity
              key={i}
              style={[ss.dropdownRow, i < results.length - 1 && ss.dropdownBorder]}
              onPress={() => onSelect(a)}
              activeOpacity={0.7}
            >
              <Text style={ss.dropdownCode}>{ident(a)}</Text>
              <View style={{ flex: 1 }}>
                <Text style={ss.dropdownName} numberOfLines={1}>{a.name}</Text>
                {(a.city || a.state) && (
                  <Text style={ss.dropdownSub}>
                    {[a.city, a.state].filter(Boolean).join(', ')}
                  </Text>
                )}
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

// ── Stop card ──────────────────────────────────────────────────────────────────

const AMENITY_THRESHOLD_NM = 5;

type AmenityDef = { icon: string; label: string };

function AmenityChip({ icon, label }: AmenityDef) {
  return (
    <View style={ss.amenityChip}>
      <MaterialCommunityIcons name={icon as any} size={11} color={STEEL} />
      <Text style={ss.amenityChipTxt}>{label}</Text>
    </View>
  );
}

function buildAmenities(a: Airport, hasCrewCar: boolean): AmenityDef[] {
  const chips: AmenityDef[] = [];
  if ((a.nearestFoodNm    ?? 999) <= AMENITY_THRESHOLD_NM) chips.push({ icon: 'silverware-fork-knife', label: 'Food'     });
  if ((a.nearestHotelNm   ?? 999) <= AMENITY_THRESHOLD_NM) chips.push({ icon: 'bed',                  label: 'Hotel'    });
  if ((a.nearestGolfNm    ?? 999) <= AMENITY_THRESHOLD_NM) chips.push({ icon: 'golf',                 label: 'Golf'     });
  if ((a.nearestAttractionNm ?? 999) <= AMENITY_THRESHOLD_NM) chips.push({ icon: 'map-marker-star',   label: 'Sights'   });
  if (hasCrewCar)                                          chips.push({ icon: 'car',                  label: 'Crew Car' });
  return chips;
}

function StopCard({ stop, cruiseKts, crewCarSet }: { stop: Stop; cruiseKts: number; crewCarSet: Set<string> }) {
  const a = stop.airport;
  const id = ident(a);
  const amenities = buildAmenities(a, crewCarSet.has(id));

  return (
    <TouchableOpacity
      style={ss.stopCard}
      onPress={() => router.push({ pathname: '/airport', params: { icao: id } })}
      activeOpacity={0.82}
    >
      {/* Left: ICAO + name + amenities */}
      <View style={{ flex: 1 }}>
        <View style={ss.stopTopRow}>
          <Text style={ss.stopIcao}>{id}</Text>
          {a.fuel && (
            <View style={ss.fuelBadge}>
              <MaterialCommunityIcons name="gas-station" size={10} color={ORANGE} />
              <Text style={ss.fuelBadgeTxt}>Fuel</Text>
            </View>
          )}
          {a.has_tower?.startsWith('ATCT') && (
            <View style={ss.towerBadge}>
              <MaterialCommunityIcons name="radio-tower" size={10} color={SKY} />
              <Text style={ss.towerBadgeTxt}>Tower</Text>
            </View>
          )}
        </View>
        <Text style={ss.stopName} numberOfLines={1}>{a.name}</Text>
        <Text style={ss.stopCity} numberOfLines={1}>
          {[a.city, a.state].filter(Boolean).join(', ')}
        </Text>
        {amenities.length > 0 && (
          <View style={ss.amenityRow}>
            {amenities.map((chip, i) => (
              <AmenityChip key={i} {...chip} />
            ))}
          </View>
        )}
      </View>

      {/* Right: stats */}
      <View style={ss.stopStats}>
        <Text style={ss.stopDeviation}>{stop.deviationNm} nm off</Text>
        <Text style={ss.stopLegs}>
          {stop.legFromNm}+{stop.legToNm} nm
        </Text>
        <Text style={ss.stopTime}>
          {flightTime(stop.legFromNm, cruiseKts)}
        </Text>
        <Feather name="chevron-right" size={14} color="#2A3A52" style={{ marginTop: 2 }} />
      </View>
    </TouchableOpacity>
  );
}

// ── Screen ─────────────────────────────────────────────────────────────────────

export default function RouteScreen() {
  const { user } = useAuth();
  const params = useLocalSearchParams<{ from?: string; to?: string }>();

  const [fromQuery, setFromQuery]   = useState('');
  const [fromApt, setFromApt]       = useState<Airport | null>(null);
  const [fromResults, setFromResults] = useState<Airport[]>([]);
  const [fromFocused, setFromFocused] = useState(false);

  const [toQuery, setToQuery]       = useState('');
  const [toApt, setToApt]           = useState<Airport | null>(null);
  const [toResults, setToResults]   = useState<Airport[]>([]);
  const [toFocused, setToFocused]   = useState(false);

  const [cruiseKts, setCruiseKts]   = useState(120);
  const [crewCarSet, setCrewCarSet] = useState<Set<string>>(new Set());

  // Load cruise speed + home airport from profile, then apply URL params on top
  useEffect(() => {
    (async () => {
      // Try authenticated key first, then guest fallback
      const keys = user?.id
        ? [`userProfile:${user.id}`, 'userProfile:guest']
        : ['userProfile:guest'];

      let profile: any = null;
      for (const key of keys) {
        const raw = await AsyncStorage.getItem(key);
        if (raw) {
          try { profile = JSON.parse(raw); } catch {}
          if (profile) {
            if (__DEV__) console.log('[Route] profile loaded from key:', key, '| home_airport:', profile.home_airport ?? 'none', '| cruise_speed:', profile.cruise_speed ?? 'none');
            break;
          }
        }
      }

      if (profile) {
        const s = Number(profile.cruise_speed);
        if (s > 0) setCruiseKts(s);

        // Pre-fill From from profile only if no URL param overrides it
        if (!params.from && profile.home_airport) {
          const home = ALL_AIRPORTS.find(a => ident(a) === profile.home_airport.toUpperCase());
          if (__DEV__) console.log('[Route] home airport lookup:', profile.home_airport, '| found:', !!home);
          if (home) setFromApt(home);
        }
      } else {
        if (__DEV__) console.log('[Route] no profile found in any key');
      }

      // Apply URL params — these take priority over profile
      if (params.from) {
        const apt = ALL_AIRPORTS.find(a => ident(a) === params.from!.toUpperCase());
        if (apt) setFromApt(apt);
      }
      if (params.to) {
        const apt = ALL_AIRPORTS.find(a => ident(a) === params.to!.toUpperCase());
        if (apt) setToApt(apt);
      }
    })();
  }, [user?.id]);

  const stops = useMemo(
    () => (fromApt && toApt ? findStops(fromApt, toApt) : []),
    [fromApt, toApt]
  );

  const directNm = useMemo(
    () => (fromApt && toApt ? Math.round(haversineNm(fromApt.lat, fromApt.lng, toApt.lat, toApt.lng)) : 0),
    [fromApt, toApt]
  );

  const mapUri = useMemo(
    () => (fromApt && toApt ? buildMapUrl(fromApt, toApt, stops) : null),
    [fromApt, toApt, stops]
  );

  // Fetch crew car availability for all stops + destination from Supabase
  useEffect(() => {
    if (!fromApt || !toApt) { setCrewCarSet(new Set()); return; }
    const icaos = [
      ...stops.map(s => ident(s.airport)),
      ident(toApt),
    ].filter(Boolean);
    if (!icaos.length) return;
    supabase
      .from('crew_cars')
      .select('icao, available, reported_at')
      .in('icao', icaos)
      .order('reported_at', { ascending: false })
      .then(({ data }) => {
        const latest: Record<string, boolean> = {};
        for (const r of (data ?? [])) {
          if (!(r.icao in latest)) latest[r.icao] = !!r.available;
        }
        setCrewCarSet(new Set(Object.entries(latest).filter(([, v]) => v).map(([k]) => k)));
      });
  }, [stops, toApt]);

  function handleFromChange(t: string) {
    setFromQuery(t);
    setFromResults(searchAirports(t));
  }
  function handleToChange(t: string) {
    setToQuery(t);
    setToResults(searchAirports(t));
  }
  function selectFrom(a: Airport) {
    setFromApt(a);
    setFromQuery('');
    setFromResults([]);
    setFromFocused(false);
  }
  function selectTo(a: Airport) {
    setToApt(a);
    setToQuery('');
    setToResults([]);
    setToFocused(false);
  }

  const hasRoute = fromApt != null && toApt != null;

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <LinearGradient
        colors={['#060911', '#07101C', '#08132B']}
        locations={[0, 0.48, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} activeOpacity={0.7}>
          <Feather name="arrow-left" size={20} color="#8A9BB5" />
        </TouchableOpacity>
        <Text style={s.title}>Route Planner</Text>
        <View style={s.backBtn} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={s.body}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── From / To inputs ───────────────────────────────────────── */}
          <View style={s.routeCard}>
            <AirportField
              label="FROM"
              value={fromQuery}
              selected={fromApt}
              onChangeText={handleFromChange}
              onSelect={selectFrom}
              onClear={() => { setFromApt(null); setFromQuery(''); setFromResults([]); }}
              results={fromResults}
              focused={fromFocused}
              onFocus={() => setFromFocused(true)}
              onBlur={() => setTimeout(() => setFromFocused(false), 150)}
            />

            {/* Arrow divider */}
            <View style={s.arrowRow}>
              <View style={s.arrowLine} />
              <View style={s.arrowIcon}>
                <Feather name="arrow-down" size={14} color="#1E3050" />
              </View>
              <View style={s.arrowLine} />
            </View>

            <AirportField
              label="TO"
              value={toQuery}
              selected={toApt}
              onChangeText={handleToChange}
              onSelect={selectTo}
              onClear={() => { setToApt(null); setToQuery(''); setToResults([]); }}
              results={toResults}
              focused={toFocused}
              onFocus={() => setToFocused(true)}
              onBlur={() => setTimeout(() => setToFocused(false), 150)}
            />
          </View>

          {/* ── Route map + stats ──────────────────────────────────────── */}
          {hasRoute && (
            <>
              {/* Static map */}
              {mapUri && (
                <View style={s.mapWrap}>
                  <Image
                    source={{ uri: mapUri }}
                    style={s.mapImg}
                    resizeMode="cover"
                  />
                  <LinearGradient
                    colors={['transparent', 'rgba(6,9,17,0.6)']}
                    style={[StyleSheet.absoluteFill, { borderRadius: 16 }]}
                    pointerEvents="none"
                  />
                </View>
              )}

              {/* Route stats */}
              <View style={s.statsRow}>
                <View style={s.statBlock}>
                  <Feather name="navigation" size={13} color="#4A6080" />
                  <Text style={s.statValue}>{directNm} nm</Text>
                  <Text style={s.statLabel}>Direct</Text>
                </View>
                <View style={s.statDivider} />
                <View style={s.statBlock}>
                  <Feather name="clock" size={13} color="#4A6080" />
                  <Text style={s.statValue}>{flightTime(directNm, cruiseKts)}</Text>
                  <Text style={s.statLabel}>Est. flight time</Text>
                </View>
                <View style={s.statDivider} />
                <View style={s.statBlock}>
                  <MaterialCommunityIcons name="airport" size={13} color="#4A6080" />
                  <Text style={s.statValue}>{stops.length}</Text>
                  <Text style={s.statLabel}>Stops found</Text>
                </View>
              </View>

              {/* ── Destination card ────────────────────────────────────── */}
              {(() => {
                const d = toApt!;
                const destAmenities = buildAmenities(d, crewCarSet.has(ident(d)));
                return (
                  <TouchableOpacity
                    style={s.destCard}
                    onPress={() => router.push({ pathname: '/airport', params: { icao: ident(d) } })}
                    activeOpacity={0.82}
                  >
                    <View style={s.destPin}>
                      <MaterialCommunityIcons name="flag-checkered" size={14} color="#22C55E" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.destIcao}>{ident(d)}</Text>
                      <Text style={s.destName} numberOfLines={1}>{d.name}</Text>
                      <Text style={s.destCity} numberOfLines={1}>
                        {[d.city, d.state].filter(Boolean).join(', ')}
                      </Text>
                      {destAmenities.length > 0 && (
                        <View style={ss.amenityRow}>
                          {destAmenities.map((chip, i) => (
                            <AmenityChip key={i} {...chip} />
                          ))}
                        </View>
                      )}
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 3 }}>
                      <Text style={s.destDist}>{directNm} nm</Text>
                      <Text style={s.destTime}>{flightTime(directNm, cruiseKts)}</Text>
                      <Feather name="chevron-right" size={14} color="rgba(34,197,94,0.35)" />
                    </View>
                  </TouchableOpacity>
                );
              })()}

              {/* ── Stops list ──────────────────────────────────────────── */}
              {stops.length > 0 ? (
                <>
                  <Text style={s.sectionTitle}>STOPS ALONG ROUTE</Text>
                  <Text style={s.sectionSub}>
                    Airports within 25 nm of your route · tap any to explore
                  </Text>
                  {stops.map((stop, i) => (
                    <StopCard key={i} stop={stop} cruiseKts={cruiseKts} crewCarSet={crewCarSet} />
                  ))}
                </>
              ) : (
                <View style={s.emptyBox}>
                  <MaterialCommunityIcons name="airport" size={28} color="#2A3F58" />
                  <Text style={s.emptyTxt}>
                    {directNm < MIN_ROUTE_NM
                      ? `${directNm} nm — short enough to fly direct`
                      : 'No airports found within 25 nm of this route'}
                  </Text>
                </View>
              )}
            </>
          )}

          {/* Placeholder when no route yet */}
          {!hasRoute && (
            <View style={s.placeholder}>
              <MaterialCommunityIcons name="airplane" size={40} color="#111D2C" />
              <Text style={s.placeholderTxt}>
                Enter a departure and destination{'\n'}to find stops along your route
              </Text>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: BG },
  body:   { padding: 16, paddingBottom: 48 },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 8, paddingVertical: 12,
  },
  backBtn:  { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title:    { fontSize: 17, fontWeight: '700', color: Colors.text.primary },

  // ── Route card (From/To inputs) ──────────────────────────────────────────────
  routeCard: {
    backgroundColor: Colors.glass.primary,
    borderRadius: 18, borderWidth: 1, borderColor: Colors.border.default,
    padding: 16, marginBottom: 16,
  },
  arrowRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 8,
  },
  arrowLine: { flex: 1, height: 1, backgroundColor: Colors.border.default },
  arrowIcon: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: Colors.glass.secondary, borderWidth: 1, borderColor: Colors.border.active,
    alignItems: 'center', justifyContent: 'center',
  },

  // ── Map ──────────────────────────────────────────────────────────────────────
  mapWrap: {
    borderRadius: 16, overflow: 'hidden', marginBottom: 12,
    borderWidth: 1, borderColor: Colors.border.default,
    height: 190,
  },
  mapImg: { width: '100%', height: '100%' },

  // ── Stats row ────────────────────────────────────────────────────────────────
  statsRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.glass.primary,
    borderRadius: 14, borderWidth: 1, borderColor: Colors.border.default,
    paddingVertical: 14, paddingHorizontal: 8,
    marginBottom: 24,
  },
  statBlock: { flex: 1, alignItems: 'center', gap: 3 },
  statValue: { fontSize: 16, fontWeight: '700', color: Colors.text.primary },
  statLabel: { fontSize: 10, color: Colors.text.dim, fontWeight: '600', letterSpacing: 0.4 },
  statDivider: { width: 1, height: 32, backgroundColor: Colors.border.default },

  // ── Section header ───────────────────────────────────────────────────────────
  sectionTitle: {
    fontSize: 10, fontWeight: '800', color: Colors.text.label, letterSpacing: 2,
    marginBottom: 4,
  },
  sectionSub: {
    fontSize: 12, color: Colors.text.dim, marginBottom: 14, lineHeight: 18,
  },

  // ── Stop card ────────────────────────────────────────────────────────────────
  emptyBox: {
    alignItems: 'center', paddingVertical: 40, gap: 12,
  },
  emptyTxt: { fontSize: 13, color: Colors.text.dim, textAlign: 'center', lineHeight: 20 },

  // ── Destination card ─────────────────────────────────────────────────────────
  destCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: 'rgba(34,197,94,0.05)',
    borderRadius: 14, borderWidth: 1, borderColor: 'rgba(34,197,94,0.20)',
    padding: 14, marginTop: 6,
  },
  destPin: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: 'rgba(34,197,94,0.10)',
    borderWidth: 1, borderColor: 'rgba(34,197,94,0.28)',
    alignItems: 'center', justifyContent: 'center',
  },
  destIcao:  { fontSize: 15, fontWeight: '800', color: '#22C55E', letterSpacing: 0.5, marginBottom: 1 },
  destName:  { fontSize: 12, color: Colors.text.secondary, fontWeight: '500', marginBottom: 1 },
  destCity:  { fontSize: 11, color: Colors.text.muted },
  destDist:  { fontSize: 13, fontWeight: '700', color: '#22C55E' },
  destTime:  { fontSize: 11, color: Colors.text.muted },

  // ── Placeholder ──────────────────────────────────────────────────────────────
  placeholder: {
    alignItems: 'center', paddingVertical: 64, gap: 16,
  },
  placeholderTxt: {
    fontSize: 14, color: '#1A2A3C', textAlign: 'center', lineHeight: 22,
  },
});

// ── Stop card styles ──────────────────────────────────────────────────────────

const ss = StyleSheet.create({
  // Airport field
  field: {
    backgroundColor: Colors.glass.secondary,
    borderRadius: 12, borderWidth: 1, borderColor: Colors.border.default,
    padding: 12, minHeight: 58,
  },
  fieldFocused: {
    borderColor: Colors.border.active,
  },
  fieldSelected: {
    backgroundColor: 'rgba(56,189,248,0.04)',
    borderColor: Colors.border.active,
  },
  fieldLabel: {
    fontSize: 9, fontWeight: '800', color: Colors.text.dim,
    letterSpacing: 1.6, marginBottom: 5,
  },
  fieldSelectedRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  fieldIcao: {
    fontSize: 16, fontWeight: '800', color: SKY, letterSpacing: 0.5,
  },
  fieldName: {
    flex: 1, fontSize: 13, color: Colors.text.secondary, fontWeight: '500',
  },
  fieldInput: {
    fontSize: 16, fontWeight: '600', color: Colors.text.primary,
    padding: 0, margin: 0,
  },

  // Dropdown
  dropdown: {
    backgroundColor: Colors.glass.secondary,
    borderRadius: 12, borderWidth: 1, borderColor: Colors.border.default,
    marginTop: 4, overflow: 'hidden', zIndex: 99,
  },
  dropdownRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 12, paddingHorizontal: 14,
  },
  dropdownBorder: { borderBottomWidth: 1, borderBottomColor: Colors.border.default },
  dropdownCode:   { fontSize: 14, fontWeight: '700', color: SKY, width: 50 },
  dropdownName:   { fontSize: 13, color: Colors.text.primary, fontWeight: '500' },
  dropdownSub:    { fontSize: 11, color: Colors.text.muted, marginTop: 1 },

  // Stop card
  stopCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.glass.primary,
    borderRadius: 14, borderWidth: 1, borderColor: Colors.border.default,
    padding: 14, marginBottom: 10,
  },
  stopTopRow:  { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  stopIcao:    { fontSize: 15, fontWeight: '800', color: Colors.text.primary, letterSpacing: 0.5 },
  stopName:    { fontSize: 12, color: Colors.text.secondary, fontWeight: '500', marginBottom: 1 },
  stopCity:    { fontSize: 11, color: Colors.text.muted },
  stopStats:   { alignItems: 'flex-end', gap: 2 },
  stopDeviation: { fontSize: 12, fontWeight: '700', color: SKY },
  stopLegs:    { fontSize: 11, color: Colors.text.muted },
  stopTime:    { fontSize: 11, color: Colors.text.muted },

  fuelBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: 'rgba(255,77,0,0.08)',
    borderRadius: 6, paddingHorizontal: 5, paddingVertical: 2,
    borderWidth: 1, borderColor: 'rgba(255,77,0,0.20)',
  },
  fuelBadgeTxt: { fontSize: 9, fontWeight: '700', color: ORANGE },
  towerBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: 'rgba(56,189,248,0.08)',
    borderRadius: 6, paddingHorizontal: 5, paddingVertical: 2,
    borderWidth: 1, borderColor: 'rgba(56,189,248,0.20)',
  },
  towerBadgeTxt: { fontSize: 9, fontWeight: '700', color: SKY },

  amenityRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 8,
  },
  amenityChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(78,110,138,0.09)',
    borderRadius: 6, paddingHorizontal: 6, paddingVertical: 3,
    borderWidth: 1, borderColor: 'rgba(78,110,138,0.18)',
  },
  amenityChipTxt: { fontSize: 10, fontWeight: '600', color: STEEL },
});
