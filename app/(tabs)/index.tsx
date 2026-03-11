import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ImageBackground, ScrollView, StyleSheet, Text,
  TextInput, TouchableOpacity, View,
} from 'react-native';
import airportsData from '../../assets/images/airports.json';
import SurpriseMe from '../../components/SurpriseMe';

const airports: any[] = airportsData as any[];

// ─── Utilities ──────────────────────────────────────────────────────────────

function getDistanceNm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 3440.065;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatFlightTime(nm: number, speedKts: number): string {
  const hours = nm / speedKts;
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

// Fisher-Yates shuffle
function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Pick one from each category (random), then shuffle the rest behind them
// Ensures variety across categories on every app launch
function buildDisplaySet(all: FeaturedDest[]): FeaturedDest[] {
  const byCategory: Record<string, FeaturedDest[]> = {};
  for (const d of all) {
    if (!byCategory[d.category]) byCategory[d.category] = [];
    byCategory[d.category].push(d);
  }
  const picks: FeaturedDest[] = [];
  const extras: FeaturedDest[] = [];
  for (const cat of Object.keys(byCategory)) {
    const shuffled = shuffleArray(byCategory[cat]);
    picks.push(shuffled[0]);
    extras.push(...shuffled.slice(1));
  }
  return [...shuffleArray(picks), ...shuffleArray(extras)];
}

// Default home coords — Spirit of St. Louis area (KSUS)
const DEFAULT_LAT = 38.7491;
const DEFAULT_LNG = -90.5756;

// ─── Categories ─────────────────────────────────────────────────────────────

const CATEGORIES = [
  { id: 'all',       label: 'All',           emoji: '✈️' },
  { id: 'short',     label: 'Short Flights',  emoji: '⏱' },
  { id: 'food',      label: 'Food',           emoji: '🍔' },
  { id: 'scenic',    label: 'Scenic',         emoji: '🏔' },
  { id: 'golf',      label: 'Golf',           emoji: '⛳' },
  { id: 'mountains', label: 'Mountains',      emoji: '🏔' },
  { id: 'beach',     label: 'Beach',          emoji: '🌊' },
];

// ─── Data Model ─────────────────────────────────────────────────────────────

export type FeaturedDest = {
  id: string;
  icao: string;
  name: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  tag: string;
  category: 'beach' | 'mountains' | 'golf' | 'food' | 'scenic';
  heroImage: string;
  description: string;
  towered?: boolean;
  minRunwayFt?: number;
};

const FEATURED: FeaturedDest[] = [
  // ── Beach ──────────────────────────────────────────────────────────────────
  {
    id: 'KSBA', icao: 'KSBA', name: 'Santa Barbara', city: 'Santa Barbara', state: 'CA',
    tag: '🌊 Beach', category: 'beach', lat: 34.4262, lng: -119.8401,
    // Santa Barbara coastline — palm-lined beach with Santa Ynez mountains behind
    heroImage: 'https://images.unsplash.com/photo-1591448574102-b72e8b4904f1?w=600&q=80',
    description: 'Pacific Coast gem with wine country and the Santa Ynez Mountains.',
    towered: true, minRunwayFt: 6052,
  },
  {
    id: 'KEYW', icao: 'KEYW', name: 'Key West', city: 'Key West', state: 'FL',
    tag: '🌴 Beach', category: 'beach', lat: 24.5561, lng: -81.7596,
    // Florida Keys aerial — turquoise water and bridge/islands from above
    heroImage: 'https://images.unsplash.com/photo-1519046904884-53103b34b206?w=600&q=80',
    description: 'The southernmost runway in the continental US. Warm water, sunsets, and Old Town charm.',
    towered: true, minRunwayFt: 4800,
  },
  // ── Mountains ──────────────────────────────────────────────────────────────
  {
    id: 'KASE', icao: 'KASE', name: 'Aspen', city: 'Aspen', state: 'CO',
    tag: '⛷️ Mountains', category: 'mountains', lat: 39.2232, lng: -106.8689,
    // Aspen / Colorado Rockies — snow-covered peaks above a mountain valley
    heroImage: 'https://images.unsplash.com/photo-1605540436563-5bca919ae766?w=600&q=80',
    description: 'One of the most dramatic visual approaches in the country. World-class skiing and après.',
    towered: true, minRunwayFt: 8006,
  },
  {
    id: 'KEGE', icao: 'KEGE', name: 'Eagle County', city: 'Eagle', state: 'CO',
    tag: '🏔 Mountains', category: 'mountains', lat: 39.6426, lng: -106.9177,
    // Vail valley — Colorado mountain canyon and river valley from above
    heroImage: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=600&q=80',
    description: 'Gateway to Vail and Beaver Creek. High-altitude arrival through a dramatic canyon.',
    towered: true, minRunwayFt: 9000,
  },
  {
    id: 'KBZN', icao: 'KBZN', name: 'Bozeman', city: 'Bozeman', state: 'MT',
    tag: '🏔 Mountains', category: 'mountains', lat: 45.7775, lng: -111.1528,
    // Gallatin Valley / Big Sky — Montana mountain range and wide valley
    heroImage: 'https://images.unsplash.com/photo-1508193638397-1c4234db14d8?w=600&q=80',
    description: "Yellowstone's north gateway. Big Sky country at its most expansive.",
    towered: true, minRunwayFt: 9003,
  },
  // ── Golf ───────────────────────────────────────────────────────────────────
  {
    id: 'KMRY', icao: 'KMRY', name: 'Monterey', city: 'Monterey', state: 'CA',
    tag: '⛳ Golf', category: 'golf', lat: 36.5870, lng: -121.8428,
    // Pebble Beach / Monterey Peninsula — coastal golf hole with Pacific Ocean
    heroImage: 'https://images.unsplash.com/photo-1535131749006-b7f58c99034b?w=600&q=80',
    description: 'Pebble Beach, Spyglass Hill, and Carmel-by-the-Sea. The pinnacle of golf destinations.',
    towered: true, minRunwayFt: 4600,
  },
  {
    id: 'KSDL', icao: 'KSDL', name: 'Scottsdale', city: 'Scottsdale', state: 'AZ',
    tag: '⛳ Golf', category: 'golf', lat: 33.6229, lng: -111.9111,
    // Scottsdale / Sonoran Desert — desert golf fairway with saguaro and mountains
    heroImage: 'https://images.unsplash.com/photo-1587174486073-ae5e5cff23aa?w=600&q=80',
    description: 'Golf capital of the world. 200+ courses, world-class resorts, and perfect winter weather.',
    towered: false, minRunwayFt: 8249,
  },
  // ── Scenic ─────────────────────────────────────────────────────────────────
  {
    id: 'KTVL', icao: 'KTVL', name: 'Lake Tahoe', city: 'South Lake Tahoe', state: 'CA',
    tag: '🏔 Scenic', category: 'scenic', lat: 38.8939, lng: -119.9950,
    // Lake Tahoe — deep blue alpine lake with Sierra Nevada peaks
    heroImage: 'https://images.unsplash.com/photo-1501594907352-04cda38ebc29?w=600&q=80',
    description: 'One of the most stunning approaches in the West. Crystal alpine lake ringed by Sierra peaks.',
    towered: false, minRunwayFt: 8544,
  },
  {
    id: 'KHAF', icao: 'KHAF', name: 'Half Moon Bay', city: 'Half Moon Bay', state: 'CA',
    tag: '🌊 Scenic', category: 'scenic', lat: 37.5134, lng: -122.5006,
    // Half Moon Bay / Northern California coast — rocky cliffs above Pacific surf
    heroImage: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=600&q=80',
    description: 'Runway perched above the Pacific. Coastal cliffs, fresh Dungeness crab, and big wave surf.',
    towered: false, minRunwayFt: 5000,
  },
  // ── Food ───────────────────────────────────────────────────────────────────
  {
    id: 'KSBP', icao: 'KSBP', name: 'San Luis Obispo', city: 'San Luis Obispo', state: 'CA',
    tag: '🍔 Food', category: 'food', lat: 35.2368, lng: -120.6426,
    // San Luis Obispo / Central Coast — rolling California wine hills and vineyards
    heroImage: 'https://images.unsplash.com/photo-1474314170901-c5ea31dff3c0?w=600&q=80',
    description: "California's happiest city. Farm-to-table dining, local wine, and Pacific views.",
    towered: true, minRunwayFt: 6120,
  },
  {
    id: 'KFDK', icao: 'KFDK', name: 'Frederick', city: 'Frederick', state: 'MD',
    tag: '🍔 Food', category: 'food', lat: 39.4176, lng: -77.3743,
    // Frederick / Maryland — Blue Ridge foothills and farmland from above
    heroImage: 'https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?w=600&q=80',
    description: 'The classic Mid-Atlantic $100 hamburger stop. On-field restaurant, easy pattern.',
    towered: false, minRunwayFt: 5220,
  },
];

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function DiscoverScreen() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [profile, setProfile] = useState<any>(null);
  const [recentSearches, setRecentSearches] = useState<any[]>([]);
  const [homeCoords, setHomeCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [cruiseSpeed, setCruiseSpeed] = useState(150);
  const [activeCategory, setActiveCategory] = useState<string>('all');

  // Rotate + shuffle FEATURED once per session so each load feels fresh
  const [displayFeatured] = useState<FeaturedDest[]>(() => buildDisplaySet(FEATURED));

  // Redirect to onboarding if not complete
  useEffect(() => {
    AsyncStorage.getItem('onboardingComplete').then((done) => {
      if (!done) router.replace('/onboarding' as any);
    });
  }, []);

  // Load profile → home airport coords + cruise speed
  useEffect(() => {
    AsyncStorage.getItem('userProfile').then((data) => {
      if (!data) return;
      const p = JSON.parse(data);
      setProfile(p);
      if (p.cruise_speed) setCruiseSpeed(Number(p.cruise_speed));
      if (p.home_airport) {
        const homeApt = airports.find(
          (a: any) => (a.icao || a.id)?.toUpperCase() === p.home_airport.toUpperCase()
        );
        if (homeApt?.lat && homeApt?.lng) setHomeCoords({ lat: homeApt.lat, lng: homeApt.lng });
      }
    });
  }, []);

  // Load recent searches
  useEffect(() => {
    AsyncStorage.getItem('recentSearches').then((s) => {
      if (s) setRecentSearches(JSON.parse(s));
    });
  }, []);

  // Featured destinations with distance + flight time
  const featuredWithMeta = useMemo(() => {
    return displayFeatured.map((dest) => {
      if (!homeCoords) return { ...dest, distNm: null as number | null, flightTime: null as string | null };
      const distNm = Math.round(getDistanceNm(homeCoords.lat, homeCoords.lng, dest.lat, dest.lng));
      return { ...dest, distNm, flightTime: formatFlightTime(distNm, cruiseSpeed) };
    });
  }, [displayFeatured, homeCoords, cruiseSpeed]);

  // Short flights — pulled from the full airports dataset, 30–300 nm from home.
  // Expands the radius in steps until at least 4 results are found.
  const shortFlightAirports = useMemo(() => {
    const homeLat = homeCoords?.lat ?? DEFAULT_LAT;
    const homeLng = homeCoords?.lng ?? DEFAULT_LNG;

    // Pre-compute distances once to avoid redundant trig per iteration
    const withDist = airports
      .filter((a: any) => a.lat && a.lng)
      .map((a: any) => ({ ...a, _dist: getDistanceNm(homeLat, homeLng, a.lat, a.lng) }));

    const minNm = 30;
    let maxNm = 300;

    while (maxNm <= 800) {
      const slice = withDist
        .filter((a: any) => a._dist >= minNm && a._dist <= maxNm)
        .sort((a: any, b: any) => a._dist - b._dist)
        .slice(0, 12)
        .map((a: any) => ({
          ...a,
          distNm: Math.round(a._dist),
          flightTime: formatFlightTime(Math.round(a._dist), cruiseSpeed),
        }));

      if (slice.length >= 4) return slice;
      maxNm += 150;
    }
    return [];
  }, [homeCoords, cruiseSpeed]);

  // Filtered + sorted destinations based on active category.
  // "All" → nearest first. Category filters fall back to nearest if empty.
  const filteredDests = useMemo(() => {
    const sortByDist = (arr: typeof featuredWithMeta) =>
      [...arr].sort((a, b) => {
        if (a.distNm === null) return 1;
        if (b.distNm === null) return -1;
        return a.distNm - b.distNm;
      });

    if (activeCategory === 'all') return sortByDist(featuredWithMeta);
    if (activeCategory === 'short') return shortFlightAirports as any;

    const filtered = featuredWithMeta.filter(d => d.category === activeCategory);
    // Fallback: if no results in this category, show all sorted by distance
    return filtered.length > 0 ? filtered : sortByDist(featuredWithMeta);
  }, [featuredWithMeta, activeCategory, shortFlightAirports]);

  const searchResults = useMemo(() => {
    if (search.length < 2) return [];
    const q = search.toLowerCase();
    return airports
      .filter(
        (a: any) =>
          a.name?.toLowerCase().includes(q) ||
          a.city?.toLowerCase().includes(q) ||
          a.id?.toLowerCase().includes(q) ||
          a.icao?.toLowerCase().includes(q)
      )
      .slice(0, 20);
  }, [search]);

  const showResults = search.length >= 2;

  async function goToAirport(a: any) {
    try {
      const updated = [a, ...recentSearches.filter((r: any) => r.id !== a.id)].slice(0, 5);
      setRecentSearches(updated);
      await AsyncStorage.setItem('recentSearches', JSON.stringify(updated));
    } catch {}

    const full = airports.find(
      (apt: any) => apt.icao === (a.icao || a.id) || apt.id === (a.icao || a.id)
    ) || a;

    router.push({
      pathname: '/airport',
      params: {
        icao: full.icao || full.id,
        name: full.name,
        city: full.city,
        state: full.state,
        lat: full.lat,
        lng: full.lng,
        elevation: full.elevation,
        fuel: full.fuel,
        runways: full.runways ? JSON.stringify(full.runways) : null,
        towered: full.towered,
        minRunwayFt: full.minRunwayFt,
        description: (a as any).description,
        category: (a as any).category,
      },
    });
    setSearch('');
  }

  const homeLabel = profile?.home_airport ?? 'KSUS';
  const isShort = activeCategory === 'short';

  return (
    <View style={styles.container}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.scroll}
      >
        {/* ── Header ─────────────────────────────────────────── */}
        <View style={styles.header}>
          <Text style={styles.greeting}>{getGreeting()}, {profile?.name || 'Pilot'} ✈️</Text>
          <Text style={styles.tagline}>Where are you{'\n'}flying today?</Text>
        </View>

        {/* ── Search bar ─────────────────────────────────────── */}
        <View style={[styles.searchBox, isFocused && styles.searchBoxFocused]}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search airport, city, or ICAO…"
            placeholderTextColor="#4A6080"
            value={search}
            onChangeText={setSearch}
            autoCorrect={false}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setTimeout(() => setIsFocused(false), 200)}
            autoCapitalize="characters"
            returnKeyType="search"
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')} style={styles.clearBtn}>
              <Text style={styles.clearBtnText}>✕</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* ── Surprise Me ────────────────────────────────────── */}
        {!showResults && <SurpriseMe />}

        {/* ── Recent searches ─────────────────────────────────── */}
        {search === '' && recentSearches.length > 0 && isFocused && (
          <View style={styles.dropdownBox}>
            <Text style={styles.dropdownLabel}>RECENT</Text>
            {recentSearches.map((airport: any, i: number) => (
              <View key={i} style={styles.resultRow}>
                <TouchableOpacity style={{ flex: 1 }} onPress={() => goToAirport(airport)}>
                  <Text style={styles.resultId}>{airport.icao || airport.id}</Text>
                  <Text style={styles.resultName}>{airport.name}</Text>
                  <Text style={styles.resultCity}>{airport.city}, {airport.state}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={async () => {
                    const updated = recentSearches.filter((_: any, idx: number) => idx !== i);
                    setRecentSearches(updated);
                    await AsyncStorage.setItem('recentSearches', JSON.stringify(updated));
                  }}
                  style={styles.dismissBtn}
                >
                  <Text style={styles.dismissText}>✕</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        {/* ── Search results ─────────────────────────────────── */}
        {showResults && (
          <View style={styles.dropdownBox}>
            {searchResults.length === 0 ? (
              <Text style={styles.noResults}>No airports found</Text>
            ) : (
              searchResults.map((a: any, i: number) => (
                <TouchableOpacity key={i} style={styles.resultRow} onPress={() => goToAirport(a)}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.resultId}>{a.icao || a.id}</Text>
                    <Text style={styles.resultName}>{a.name}</Text>
                    <Text style={styles.resultCity}>{a.city}, {a.state}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    {a.fuel && <Text style={styles.resultMeta}>⛽ {a.fuel}</Text>}
                    {a.elevation && <Text style={styles.resultMeta}>📏 {a.elevation} ft</Text>}
                  </View>
                </TouchableOpacity>
              ))
            )}
          </View>
        )}

        {/* ── Category chips ─────────────────────────────────── */}
        {!showResults && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.categoryScroll}
            contentContainerStyle={styles.categoryRow}
          >
            {CATEGORIES.map(cat => (
              <TouchableOpacity
                key={cat.id}
                style={[styles.categoryChip, activeCategory === cat.id && styles.categoryChipActive]}
                onPress={() => setActiveCategory(cat.id)}
                activeOpacity={0.75}
              >
                <Text style={[
                  styles.categoryChipText,
                  activeCategory === cat.id && styles.categoryChipTextActive,
                ]}>
                  {cat.emoji} {cat.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {/* ── Destinations ────────────────────────────────────── */}
        {!showResults && (
          <>
            <View style={styles.sectionRow}>
              <Text style={styles.sectionTitle}>
                {isShort ? 'Nearby Airports' : 'Featured Destinations'}
              </Text>
              <Text style={styles.sectionFrom}>from {homeLabel}</Text>
            </View>

            {isShort ? (
              /* ── Short flights: practical list view from full dataset ── */
              <View style={styles.flightList}>
                {filteredDests.map((airport: any, i: number) => (
                  <TouchableOpacity
                    key={airport.icao || airport.id || i}
                    style={styles.flightCard}
                    onPress={() => goToAirport(airport)}
                    activeOpacity={0.8}
                  >
                    <View style={styles.flightCardLeft}>
                      <Text style={styles.flightCardIcao}>{airport.icao || airport.id}</Text>
                      <Text style={styles.flightCardName} numberOfLines={1}>{airport.name}</Text>
                      <Text style={styles.flightCardCity}>{airport.city}, {airport.state}</Text>
                      <View style={styles.flightCardMeta}>
                        {airport.fuel && <Text style={styles.flightCardTag}>⛽ {airport.fuel}</Text>}
                        {airport.elevation && (
                          <Text style={styles.flightCardTag}>📏 {airport.elevation} ft</Text>
                        )}
                      </View>
                    </View>
                    <View style={styles.flightCardRight}>
                      <Text style={styles.flightCardDist}>{airport.distNm} nm</Text>
                      <Text style={styles.flightCardTime}>{airport.flightTime}</Text>
                      <Text style={styles.flightCardArrow}>›</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              /* ── All / category: curated image grid ── */
              <View style={styles.grid}>
                {filteredDests.map((dest: any) => (
                  <TouchableOpacity
                    key={dest.id}
                    style={styles.card}
                    onPress={() => goToAirport(dest)}
                    activeOpacity={0.88}
                  >
                    <ImageBackground
                      source={{ uri: dest.heroImage }}
                      style={styles.cardBg}
                      imageStyle={styles.cardBgImage}
                    >
                      <View style={styles.cardDim} />
                      <View style={styles.cardFade} />
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>{dest.tag}</Text>
                      </View>
                      <View style={styles.cardContent}>
                        <Text style={styles.cardName} numberOfLines={1}>{dest.name}</Text>
                        <Text style={styles.cardSub}>{dest.icao} · {dest.state}</Text>
                        {dest.distNm != null && dest.flightTime != null && (
                          <View style={styles.distPill}>
                            <Text style={styles.distText}>{dest.distNm} nm · {dest.flightTime}</Text>
                          </View>
                        )}
                      </View>
                    </ImageBackground>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </>
        )}

        <View style={{ height: 24 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#070B14' },
  scroll: { paddingHorizontal: 20, paddingBottom: 60 },

  // Header
  header: { paddingTop: 66, paddingBottom: 22 },
  greeting: {
    fontSize: 10, color: '#F97316', fontWeight: '700',
    letterSpacing: 1.8, textTransform: 'uppercase', marginBottom: 10,
    opacity: 0.65,
  },
  tagline: {
    fontSize: 34, fontWeight: '900', color: '#F0F4FF',
    lineHeight: 46, letterSpacing: -0.8,
  },

  // Search
  searchBox: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#0C1520', borderRadius: 16,
    paddingHorizontal: 18, paddingVertical: 17, marginBottom: 16,
    borderWidth: 1.5, borderColor: '#1E2D45',
  },
  searchBoxFocused: { borderColor: '#2A4260' },
  searchIcon: { fontSize: 15, marginRight: 12, opacity: 0.72 },
  searchInput: { flex: 1, color: '#F0F4FF', fontSize: 15, fontWeight: '500' },
  clearBtn: { paddingLeft: 12, paddingVertical: 4 },
  clearBtnText: { color: '#3A5070', fontSize: 14 },

  // Dropdowns
  dropdownBox: {
    backgroundColor: '#0C1520', borderRadius: 16,
    borderWidth: 1, borderColor: '#1A2A40',
    marginBottom: 18, overflow: 'hidden',
  },
  dropdownLabel: {
    fontSize: 10, fontWeight: '700', color: '#2D4260',
    letterSpacing: 1.8, textTransform: 'uppercase',
    paddingHorizontal: 14, paddingTop: 14, paddingBottom: 8,
  },
  resultRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#111E30',
  },
  resultId: { fontSize: 12, fontWeight: '700', color: '#38BDF8', marginBottom: 2 },
  resultName: { fontSize: 14, fontWeight: '600', color: '#E8EEF8', marginBottom: 1 },
  resultCity: { fontSize: 12, color: '#3A5070' },
  resultMeta: { fontSize: 11, color: '#3A5070' },
  noResults: { color: '#3A5070', padding: 18, textAlign: 'center', fontSize: 14 },
  dismissBtn: { paddingLeft: 16, paddingVertical: 8 },
  dismissText: { color: '#3A5070', fontSize: 14 },

  // Category chips
  categoryScroll: { marginHorizontal: -20, marginBottom: 20 },
  categoryRow: { gap: 8, paddingHorizontal: 20 },
  categoryChip: {
    backgroundColor: '#0D1421', borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 8,
    borderWidth: 1, borderColor: '#1E2D45',
  },
  categoryChipActive: { backgroundColor: '#38BDF8', borderColor: '#38BDF8' },
  categoryChipText: { fontSize: 13, fontWeight: '600', color: '#4A5B73' },
  categoryChipTextActive: { color: '#0D1421', fontWeight: '800' },

  // Section header
  sectionRow: {
    flexDirection: 'row', alignItems: 'baseline',
    justifyContent: 'space-between', marginBottom: 14, marginTop: 4,
  },
  sectionTitle: {
    fontSize: 11, fontWeight: '700', color: '#3A4E65',
    letterSpacing: 1.5, textTransform: 'uppercase',
  },
  sectionFrom: {
    fontSize: 11, fontWeight: '700', color: '#3A4E65',
    letterSpacing: 1.5, textTransform: 'uppercase', opacity: 0.6,
  },

  // Short flight list cards
  flightList: { gap: 10 },
  flightCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#0D1421', borderRadius: 16,
    padding: 16, borderWidth: 1, borderColor: '#1E2D45',
  },
  flightCardLeft: { flex: 1 },
  flightCardIcao: {
    fontSize: 12, fontWeight: '700', color: '#38BDF8',
    letterSpacing: 1.5, marginBottom: 3,
  },
  flightCardName: { fontSize: 15, fontWeight: '700', color: '#F0F4FF', marginBottom: 2 },
  flightCardCity: { fontSize: 12, color: '#4A5B73', marginBottom: 8 },
  flightCardMeta: { flexDirection: 'row', gap: 12 },
  flightCardTag: { fontSize: 11, color: '#3A5070' },
  flightCardRight: { alignItems: 'flex-end', gap: 2, paddingLeft: 12 },
  flightCardDist: { fontSize: 17, fontWeight: '800', color: '#F0F4FF' },
  flightCardTime: { fontSize: 12, color: '#60CEFF', fontWeight: '600', marginBottom: 6 },
  flightCardArrow: { fontSize: 22, color: '#1E3A5A' },

  // Destination image grid
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  card: { width: '47%', height: 196, borderRadius: 18, overflow: 'hidden' },
  cardBg: { flex: 1, justifyContent: 'space-between' },
  cardBgImage: { borderRadius: 18 },
  cardDim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.15)',
  },
  cardFade: {
    position: 'absolute', bottom: 0, left: 0, right: 0, height: 120,
    backgroundColor: 'rgba(4,8,18,0.78)',
    borderBottomLeftRadius: 18, borderBottomRightRadius: 18,
  },
  badge: {
    position: 'absolute', top: 18, left: 16,
    backgroundColor: 'rgba(0,0,0,0.28)',
    borderRadius: 16, paddingHorizontal: 10, paddingVertical: 4,
  },
  badgeText: { fontSize: 11, color: '#fff', fontWeight: '700', letterSpacing: 0.2 },
  cardContent: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 12 },
  cardName: { fontSize: 16, fontWeight: '800', color: '#fff', marginBottom: 2 },
  cardSub: { fontSize: 11, color: 'rgba(255,255,255,0.55)', fontWeight: '600', marginBottom: 7 },
  distPill: {
    backgroundColor: 'rgba(56,189,248,0.11)',
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4,
    alignSelf: 'flex-start',
    borderWidth: 0.5, borderColor: 'rgba(56,189,248,0.32)',
  },
  distText: { fontSize: 11, color: '#38BDF8', fontWeight: '700' },
});
