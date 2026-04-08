import React from 'react';
import airportsData from '@/assets/images/airports.json';
import { GOOGLE_KEY } from '@/utils/config';
import { MaterialCommunityIcons, Feather } from '@expo/vector-icons';
import { getFlightCategory } from '@/utils/weather';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import {
  ActivityIndicator, Alert, Animated as RNAnimated, Dimensions, Image, Modal, ScrollView,
  StyleSheet, Text, TouchableOpacity, View
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import SignInPrompt from './SignInPrompt';

const SCREEN_W = Dimensions.get('window').width;

const airports: any[] = airportsData as any[];

// Generic chain/low-interest names to filter out of highlights
const GENERIC_NAMES = [
  'mcdonald', 'subway', 'burger king', "wendy's", 'taco bell', 'pizza hut',
  'domino', 'kfc', 'walmart', 'target', 'walgreens', 'cvs', 'dollar tree',
  'dollar general', 'speedway', 'circle k', "casey's", 'kwik trip', 'loves',
  'flying j', 'pilot travel', 'holiday inn express', 'best western',
  'comfort inn', 'super 8', 'days inn', 'motel 6', 'quality inn',
];

const FUEL_LABELS: Record<string, string> = { A: 'Jet A', 'A+': 'Jet A+', B: 'Jet B' };
function formatFuel(fuel: string): string {
  return fuel.split(',').map(f => FUEL_LABELS[f.trim()] ?? f.trim()).join(' / ');
}

function isGenericPlace(name: string): boolean {
  const lower = name.toLowerCase();
  return GENERIC_NAMES.some(g => lower.includes(g));
}

function scorePlaceQuality(place: any): number {
  const rating = place.rating || 0;
  const reviews = place.user_ratings_total || 0;
  if (reviews < 15) return 0;
  return rating * Math.log(reviews + 1);
}

// Score an airport's baseline destination value (runway length + services)
function scoreAirportQuality(a: any): number {
  let score = 0;
  const rl = a.runways?.length
    ? Math.max(...a.runways.map((r: any) => r.length || 0))
    : 0;
  if (rl >= 5000) score += 20;
  else if (rl >= 3500) score += 10;
  else if (rl >= 2500) score += 5;
  if (a.has_tower?.startsWith('ATCT')) score += 15;
  if (a.city) score += 5; // has a city tag = likely a proper town nearby
  return score;
}

// minHours/maxHours define soft overlapping bands centered near the target.
// Adjacent options intentionally overlap so there are no dead zones.
const HOUR_OPTIONS = [
  { label: '30 min', hours: 0.5,  minHours: 0.25, maxHours: 0.75 },
  { label: '1 hr',   hours: 1,    minHours: 0.58, maxHours: 1.42 },
  { label: '1.5 hrs',hours: 1.5,  minHours: 0.92, maxHours: 1.92 },
  { label: '2 hrs',  hours: 2,    minHours: 1.33, maxHours: 2.5  },
  { label: '2.5 hrs',hours: 2.5,  minHours: 1.75, maxHours: 3.0  },
  { label: '3 hrs',  hours: 3,    minHours: 2.17, maxHours: 3.5  },
  { label: '5 hrs',  hours: 5,    minHours: 4.0,  maxHours: 6.0  },
  { label: '10 hrs', hours: 10,   minHours: 7.5,  maxHours: 12.5 },
];

function getDistanceNm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 3440.065;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getDistanceMiles(lat1: number, lng1: number, lat2: number, lng2: number) {
  return getDistanceNm(lat1, lng1, lat2, lng2) * 1.15078;
}

const SCENIC_KEYWORDS = ['lake', 'river', 'mountain', 'state park', 'national', 'falls', 'canyon', 'trail', 'forest', 'scenic', 'overlook', 'ridge', 'valley', 'gorge', 'reservoir', 'bay', 'coast', 'beach', 'island'];
const SCENIC_TYPES = ['natural_feature', 'park', 'campground', 'rv_park'];

function isScenic(place: any): boolean {
  const lower = place.name.toLowerCase();
  return SCENIC_KEYWORDS.some(k => lower.includes(k)) ||
    (place.types || []).some((t: string) => SCENIC_TYPES.includes(t));
}

/**
 * Build "why fly here" summary from cached Supabase data + static airport fields.
 * NO live Places API calls — uses airport_places_cache if an airport has been visited before.
 */
async function fetchDestinationSummary(airport: any, _lat: number, _lng: number): Promise<string[]> {
  const icao = (airport.icao || airport.faa || airport.id || '').toUpperCase();
  const bullets: string[] = [];

  try {
    // Check Supabase cache for previously fetched place data
    const { data: cacheRows } = await supabase
      .from('airport_places_cache')
      .select('category, data')
      .eq('airport_icao', icao);

    const cached: Record<string, any[]> = {};
    for (const row of (cacheRows ?? [])) {
      cached[row.category] = row.data ?? [];
    }

    // Best non-chain restaurant from cache
    const bestRest = (cached['restaurants'] ?? []).find((p: any) => !isGenericPlace(p.name ?? ''));
    if (bestRest) bullets.push(`${bestRest.name} — dining near the field`);

    // Golf from cache or static data
    const bestGolf = (cached['golf'] ?? [])[0];
    if (bestGolf) bullets.push(`${bestGolf.name} — fly in, play a round`);
    else if (airport.nearestGolfName) bullets.push(`${airport.nearestGolfName} — golf nearby`);

    // Attractions from cache
    const bestAttr = (cached['attractions'] ?? cached['things'] ?? [])[0];
    if (bestAttr && bullets.length < 2) bullets.push(`${bestAttr.name} — worth the trip`);

    // Hotels from cache
    const bestHotel = (cached['hotels'] ?? [])[0];
    if (bestHotel && bullets.length < 2) bullets.push(`Overnight options close to the field`);
  } catch {}

  // Static fallbacks from airport data
  if (bullets.length < 1 && airport.nearestFoodNm != null)
    bullets.push('Dining within a short drive of the ramp');
  if (bullets.length < 2 && airport.nearestGolfNm != null)
    bullets.push('Golf nearby — fly in, play a round');

  // Elevation context
  const elev = Number(airport.elevation);
  if (bullets.length < 2 && elev >= 4000)
    bullets.push(`High-elevation field at ${elev.toLocaleString()} ft`);

  // Generic fallbacks
  if (bullets.length < 1) bullets.push(airport.fuel ? 'Fuel on the field — convenient stop' : 'Quiet field worth exploring');
  if (bullets.length < 2) bullets.push('Good cross-country stop — easy in and out');

  if (__DEV__) console.log(`[SurpriseMe] summary for ${icao}: ${bullets.length} bullets (cache-based, no API calls)`);
  return bullets.slice(0, 2);
}

export default function SurpriseMe() {
  const { user } = useAuth();
  const [visible, setVisible] = useState(false);
  const [selectedHours, setSelectedHours] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [cruiseSpeed, setCruiseSpeed] = useState(120);
  const [heroPhotoUri, setHeroPhotoUri] = useState<string | null>(null);
  const [pilotIntel, setPilotIntel] = useState<{
    courtesyCar: string | null; reportCount: number; lastReportedAt: string | null;
  } | null>(null);
  const [savedToBucket, setSavedToBucket] = useState(false);
  const [signInPrompt, setSignInPrompt] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const callId = useRef(0);
  const resultAnim = useRef(new RNAnimated.Value(0)).current;
  const router = useRouter();

  useEffect(() => {
    if (!user) return;
    AsyncStorage.getItem(`userProfile:${user.id}`).then((data) => {
      if (data) {
        const profile = JSON.parse(data);
        if (profile.cruise_speed) setCruiseSpeed(profile.cruise_speed);
      }
    });
  }, [user?.id]);

  useEffect(() => {
    if (!result?.airport) { setPilotIntel(null); return; }
    const icao = (result.airport.icao || result.airport.id || '').toUpperCase();
    if (!icao) { setPilotIntel(null); return; }
    supabase
      .from('airport_reviews')
      .select('courtesy_car, created_at')
      .eq('airport_icao', icao)
      .order('created_at', { ascending: false })
      .limit(30)
      .then(({ data }) => {
        if (!data || data.length === 0) { setPilotIntel(null); return; }
        const carVotes = data.filter(r => r.courtesy_car === 'yes' || r.courtesy_car === 'no');
        const yesCount = carVotes.filter(r => r.courtesy_car === 'yes').length;
        const courtesyCar = carVotes.length >= 2
          ? (yesCount > carVotes.length / 2 ? 'yes' : yesCount < carVotes.length / 2 ? 'no' : 'mixed')
          : carVotes.length === 1 ? carVotes[0].courtesy_car : null;
        setPilotIntel({ courtesyCar, reportCount: data.length, lastReportedAt: data[0].created_at });
      });
    // Reset bucket list saved state for new result
    setSavedToBucket(false);
  }, [result?.airport?.icao, result?.airport?.id]);

  // Hero image — satellite tile only, no live Places API call
  useEffect(() => {
    if (!result?.airport) { setHeroPhotoUri(null); return; }
    const apt = result.airport;
    const icao = (apt.icao || apt.faa || apt.id || '').toString().toUpperCase();
    // Use dataset heroImage if available, otherwise satellite tile
    if (apt.heroImage) {
      setHeroPhotoUri(apt.heroImage);
      if (__DEV__) console.log(`[SurpriseMe] hero for ${icao}: dataset heroImage (no API call)`);
    } else if (GOOGLE_KEY && apt.lat && apt.lng) {
      setHeroPhotoUri(`https://maps.googleapis.com/maps/api/staticmap?center=${apt.lat},${apt.lng}&zoom=14&size=1200x630&maptype=satellite&key=${GOOGLE_KEY}`);
      if (__DEV__) console.log(`[SurpriseMe] hero for ${icao}: satellite tile (no Places call)`);
    } else {
      setHeroPhotoUri(null);
    }
  }, [result?.airport?.icao, result?.airport?.id]);

  async function findSurprise() {
    if (!selectedHours) { Alert.alert('Pick a flight time first!'); return; }
    const thisCall = ++callId.current;
    setLoading(true);
    setResult(null);

    try {
      // Try to use home airport as the fallback origin; GPS overrides if granted
      let fallbackLat = 39.8283; // US geographic center
      let fallbackLng = -98.5795;
      try {
        const raw = await AsyncStorage.getItem(`userProfile:${user?.id ?? 'guest'}`);
        if (raw) {
          const p = JSON.parse(raw);
          if (p.home_airport) {
            const homeApt = (airports as any[]).find(
              (a: any) => (a.icao || a.faa || a.id)?.toUpperCase() === p.home_airport.toUpperCase()
            );
            if (homeApt?.lat && homeApt?.lng) { fallbackLat = homeApt.lat; fallbackLng = homeApt.lng; }
          }
        }
      } catch {}

      const { status } = await Location.requestForegroundPermissionsAsync();
      let userLat = fallbackLat;
      let userLng = fallbackLng;
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({});
        userLat = loc.coords.latitude;
        userLng = loc.coords.longitude;
      }
      const opt = HOUR_OPTIONS.find(o => o.hours === selectedHours)!;
      const targetNm = selectedHours * cruiseSpeed;
      const minNm = opt.minHours * cruiseSpeed;
      const maxNm = opt.maxHours * cruiseSpeed;

      const candidates = airports.filter(a => {
        const d = getDistanceNm(userLat, userLng, a.lat, a.lng);
        return d >= minNm && d <= maxNm && a.fuel && a.lat && a.lng;
      });

      if (candidates.length === 0) {
        Alert.alert('No airports found', 'Try a different time range.');
        setLoading(false);
        return;
      }

      // Score by quality + proximity to target flight time (prefer airports near center of band)
      // Then bias slightly toward better current weather (favor VFR, avoid LIFR).
      const preScored = candidates
        .map(a => {
          const dist = getDistanceNm(userLat, userLng, a.lat, a.lng);
          const proximity = 1 - Math.abs(dist - targetNm) / targetNm;
          const quality = scoreAirportQuality(a);
          return { ...a, _baseScore: quality * 0.6 + proximity * 0.4, _proximity: proximity, _quality: quality };
        })
        .sort((a: any, b: any) => b._baseScore - a._baseScore);

      const poolSize = Math.max(8, Math.min(preScored.length, Math.floor(preScored.length * 0.35)));
      const pool = preScored.slice(0, poolSize);
      const airport = pool[Math.floor(Math.random() * pool.length)];

      const distNm = Math.round(getDistanceNm(userLat, userLng, airport.lat, airport.lng));
      const distMiles = Math.round(getDistanceMiles(userLat, userLng, airport.lat, airport.lng));
      const rawHours = distNm / cruiseSpeed;
      const h = Math.floor(rawHours);
      const m = Math.round((rawHours - h) * 60);
      const flightTime = h === 0 ? `${m}m` : m === 0 ? `${h}h` : `${h}h ${m}m`;

      if (thisCall !== callId.current) { setLoading(false); return; }
      // Animate the result card in
      resultAnim.setValue(0);
      setResult({ airport, distNm, distMiles, flightTime, whySummary: [], weatherCategory: null });
      RNAnimated.spring(resultAnim, { toValue: 1, tension: 200, friction: 18, useNativeDriver: true }).start();

      // Load whySummary asynchronously
      fetchDestinationSummary(airport, airport.lat, airport.lng)
        .then((whySummary) => {
          setResult((prev: any) =>
            prev && (prev.airport.icao === airport.icao || prev.airport.id === airport.id)
              ? { ...prev, whySummary }
              : prev
          )
        })
        .catch(() => {})

      // Load weather asynchronously
      const id = (airport.icao || airport.faa || airport.id || '').toString().toUpperCase();
      if (id) {
        fetch(`https://aviationweather.gov/api/data/metar?ids=${id}&format=json`)
          .then(r => r.json())
          .then(j => {
            if (Array.isArray(j) && j.length > 0) {
              const raw = j[0];
              let flightCategory = raw.flight_category ?? null;
              if (!flightCategory) {
                const metarText = (raw.rawOb || raw.raw_ob || raw.raw_text || raw.rawText || raw.raw) ?? null;
                if (metarText) flightCategory = getFlightCategory(metarText);
              }
              setResult((prev: any) =>
                prev && (prev.airport.icao === airport.icao || prev.airport.id === airport.id)
                  ? { ...prev, weatherCategory: flightCategory }
                  : prev
              )
            }
          })
          .catch(() => {})
      }
    } catch {
      Alert.alert('Error', 'Something went wrong. Try again.');
    }
    setLoading(false);
  }

  function goToAirport() {
    if (!result) return;
    router.push({
      pathname: '/airport',
      params: {
        icao: result.airport.icao || result.airport.id,
        name: result.airport.name,
        city: result.airport.city,
        state: result.airport.state,
        lat: result.airport.lat,
        lng: result.airport.lng,
        elevation: result.airport.elevation,
        fuel: result.airport.fuel,
        runways: result.airport.runways ? JSON.stringify(result.airport.runways) : null,
      }
    });
    setVisible(false);
  }

  function formatRelative(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d ago`;
    return `${Math.floor(days / 30)}mo ago`;
  }

  async function saveToBucketList() {
    if (!user?.id) { setSignInPrompt(true); return; }
    if (!result?.airport || savedToBucket) return;
    const apt = result.airport;
    const icao = (apt.icao || apt.faa || apt.id || '').toUpperCase();
    try {
      const { error } = await supabase.from('bucket_list').insert({
        user_id: user.id,
        icao,
        name: apt.name,
        city: apt.city,
        state: apt.state,
        lat: apt.lat,
        lng: apt.lng,
      });
      if (!error) setSavedToBucket(true);
      else if (__DEV__) console.warn('[SurpriseMe] bucket save error:', error.message);
    } catch (e: any) {
      if (__DEV__) console.warn('[SurpriseMe] bucket exception:', e?.message);
    }
  }

  const CATEGORIES = [
    { value: 'food', label: 'Food', icon: 'silverware-fork-knife' },
    { value: 'golf', label: 'Golf', icon: 'golf' },
    { value: 'scenic', label: 'Scenic', icon: 'image-filter-hdr' },
    { value: 'surprise', label: 'Surprise', icon: 'dice-5' },
  ];

  return (
    <>
      <TouchableOpacity style={styles.trigger} onPress={() => setVisible(true)} activeOpacity={0.82}>
        {/* Hero glass surface — slightly warmer + brighter than standard cards */}
        <LinearGradient
          colors={['rgba(26,14,6,0.92)', 'rgba(12,18,34,0.96)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />
        <View style={styles.triggerDice}>
          <LinearGradient
            colors={['#FF8A40', '#FF4D00']}
            style={StyleSheet.absoluteFillObject}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          />
          <MaterialCommunityIcons name="dice-5" size={28} color="#FFFFFF" />
        </View>
        <View style={styles.triggerText}>
          <Text style={styles.triggerEyebrow}>FEELING ADVENTUROUS?</Text>
          <Text style={styles.triggerTitle}>Surprise Me</Text>
          <Text style={styles.triggerSub}>Find the perfect destination to fly today</Text>
        </View>
        <Feather name="chevron-right" size={20} color="#FF4D00" style={{ opacity: 0.9, flexShrink: 0 }} />
      </TouchableOpacity>

      <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
        <View style={styles.modal}>
          {/* Ambient warm golden glow — top of screen */}
          <LinearGradient
            colors={['rgba(251,191,36,0.07)', 'rgba(249,115,22,0.03)', 'transparent']}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 280 }}
            pointerEvents="none"
          />
          <View style={styles.modalHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Text style={styles.modalTitle}>Where to?</Text>
              <MaterialCommunityIcons name="dice-5" size={22} color="#F0F4FF" />
            </View>
            <TouchableOpacity onPress={() => { setVisible(false); setResult(null); setSelectedHours(null); }}>
              <Feather name="x" size={20} color="#4A5B73" />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.modalBody}>
            <Text style={styles.sectionLabel}>HOW LONG DO YOU WANT TO FLY?</Text>
            <View style={styles.hoursGrid}>
              {HOUR_OPTIONS.map(opt => (
                <TouchableOpacity
                  key={opt.hours}
                  style={[styles.hourChip, selectedHours === opt.hours && styles.hourChipActive]}
                  onPress={() => { setSelectedHours(opt.hours); setResult(null); }}
                >
                  <Text style={[styles.hourChipText, selectedHours === opt.hours && styles.hourChipTextActive]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {selectedHours && (() => {
              const opt = HOUR_OPTIONS.find(o => o.hours === selectedHours)!;
              return (
                <Text style={styles.rangeHint}>
                  ≈ {selectedHours < 1 ? `${Math.round(selectedHours * 60)} min` : `${selectedHours} hr`} flight from you · {Math.round(opt.minHours * cruiseSpeed)}–{Math.round(opt.maxHours * cruiseSpeed)} nm at {cruiseSpeed} kts
                </Text>
              );
            })()}

            {/* Category filter (placeholder — selection stored but not yet used in scoring) */}
            <Text style={styles.sectionLabel}>WHAT SOUNDS GOOD?</Text>
            <View style={styles.hoursGrid}>
              {CATEGORIES.map(cat => (
                <TouchableOpacity
                  key={cat.value}
                  style={[styles.hourChip, selectedCategory === cat.value && styles.hourChipActive]}
                  onPress={() => setSelectedCategory(selectedCategory === cat.value ? null : cat.value)}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <MaterialCommunityIcons name={cat.icon as any} size={14} color={selectedCategory === cat.value ? '#0D1421' : '#4A5B73'} />
                    <Text style={[styles.hourChipText, selectedCategory === cat.value && styles.hourChipTextActive]}>
                      {cat.label}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              style={[styles.goBtn, !selectedHours && styles.goBtnDisabled]}
              onPress={findSurprise}
              disabled={!selectedHours || loading}
            >
              {loading
                ? <ActivityIndicator color="#0D1421" />
                : <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <MaterialCommunityIcons name="dice-5" size={16} color="#0D1421" />
                    <Text style={styles.goBtnText}>Roll the Destination</Text>
                  </View>
              }
            </TouchableOpacity>

            {result && (
              <RNAnimated.View style={[styles.resultCard, {
                opacity: resultAnim,
                transform: [{ scale: resultAnim.interpolate({ inputRange: [0, 1], outputRange: [0.95, 1] }) }],
              }]}>
                {/* ── Cinematic Hero ── */}
                <View style={styles.resultHero}>
                  {heroPhotoUri
                    ? <Image source={{ uri: heroPhotoUri }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
                    : <View style={styles.resultHeroFallback} />
                  }
                  {/* Golden-hour warm cast — upper third */}
                  <LinearGradient
                    colors={['rgba(251,191,36,0.22)', 'rgba(249,115,22,0.10)', 'transparent']}
                    style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '65%' }}
                    start={{ x: 0.25, y: 0 }} end={{ x: 0.75, y: 1 }}
                    pointerEvents="none"
                  />
                  {/* Left edge vignette */}
                  <LinearGradient
                    colors={['rgba(6,10,18,0.60)', 'transparent']}
                    style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: 72 }}
                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                    pointerEvents="none"
                  />
                  {/* Right edge vignette */}
                  <LinearGradient
                    colors={['transparent', 'rgba(6,10,18,0.60)']}
                    style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: 72 }}
                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                    pointerEvents="none"
                  />
                  {/* Top vignette */}
                  <LinearGradient
                    colors={['rgba(6,10,18,0.60)', 'transparent']}
                    style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '40%' }}
                    start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }}
                    pointerEvents="none"
                  />
                  {/* Bottom cinematic fade — text lives here */}
                  <LinearGradient
                    colors={['transparent', 'rgba(6,10,18,0.78)', 'rgba(6,10,18,0.98)']}
                    style={styles.resultHeroGradient}
                    start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }}
                  />
                  {/* ICAO glass badge */}
                  <View style={styles.resultIcaoBadge}>
                    <MaterialCommunityIcons name="airplane" size={11} color="#38BDF8" style={{ marginRight: 4 }} />
                    <Text style={styles.resultIcaoBadgeText}>{result.airport.icao || result.airport.id}</Text>
                  </View>
                  {/* Weather badge — top right */}
                  {result.weatherCategory && (
                    <View style={[
                      styles.weatherHeroBadge,
                      result.weatherCategory === 'VFR' ? styles.weatherBadgeVfr :
                      result.weatherCategory === 'MVFR' ? styles.weatherBadgeMvfr :
                      result.weatherCategory === 'IFR' ? styles.weatherBadgeIfr :
                      styles.weatherBadgeLifr,
                    ]}>
                      <Text style={styles.weatherBadgeText}>{result.weatherCategory}</Text>
                    </View>
                  )}
                  {/* Airport name + city over the hero bottom */}
                  <View style={styles.heroTitleBlock}>
                    <Text style={styles.heroAirportName} numberOfLines={2}>{result.airport.name}</Text>
                    <Text style={styles.heroCityState}>{result.airport.city}, {result.airport.state}</Text>
                  </View>
                </View>

                {/* ── Body ── */}
                <View style={styles.resultBody}>
                  {/* Avionics stat strip */}
                  <View style={styles.statStrip}>
                    {/* Distance — warm orange */}
                    <View style={[styles.statCell, styles.statCellWarm]}>
                      <Text style={styles.statCellLabel}>DISTANCE</Text>
                      <Text style={[styles.statCellValue, { color: '#FBBF24' }]}>
                        {result.distNm}<Text style={[styles.statCellUnit, { color: '#D97706' }]}> nm</Text>
                      </Text>
                    </View>
                    <View style={styles.statDivider} />
                    {/* Flight Time — primary accent blue, center highlight */}
                    <View style={[styles.statCell, styles.statCellPrimary]}>
                      <Text style={[styles.statCellLabel, { color: '#38BDF8' }]}>FLIGHT TIME</Text>
                      <Text style={[styles.statCellValue, { color: '#E0F2FE', fontSize: 19 }]}>{result.flightTime}</Text>
                    </View>
                    <View style={styles.statDivider} />
                    {/* Elevation — muted */}
                    <View style={styles.statCell}>
                      <Text style={styles.statCellLabel}>ELEVATION</Text>
                      <Text style={styles.statCellValue}>
                        {result.airport.elevation}<Text style={styles.statCellUnit}> ft</Text>
                      </Text>
                    </View>
                  </View>

                  {/* Service pills */}
                  <View style={styles.pillRow}>
                    {result.airport.fuel && (
                      <View style={styles.servicePill}>
                        <MaterialCommunityIcons name="gas-station" size={12} color="#22C55E" />
                        <Text style={styles.servicePillText}>{formatFuel(result.airport.fuel)}</Text>
                      </View>
                    )}
                    {pilotIntel?.courtesyCar && (
                      <View style={[styles.servicePill,
                        pilotIntel.courtesyCar === 'yes' ? styles.servicePillBlue :
                        pilotIntel.courtesyCar === 'mixed' ? styles.servicePillAmber : styles.servicePillMuted
                      ]}>
                        <MaterialCommunityIcons name="car" size={12}
                          color={pilotIntel.courtesyCar === 'yes' ? '#38BDF8' : pilotIntel.courtesyCar === 'mixed' ? '#F59E0B' : '#6B83A0'} />
                        <Text style={[styles.servicePillText, {
                          color: pilotIntel.courtesyCar === 'yes' ? '#38BDF8' : pilotIntel.courtesyCar === 'mixed' ? '#F59E0B' : '#6B83A0'
                        }]}>
                          {pilotIntel.courtesyCar === 'yes' ? 'Crew Car' : pilotIntel.courtesyCar === 'mixed' ? 'Crew Car (Mixed)' : 'No Crew Car'}
                        </Text>
                      </View>
                    )}
                  </View>

                  {/* Pilot intel */}
                  {pilotIntel && pilotIntel.reportCount > 0 && (
                    <View style={styles.pilotIntelRow}>
                      <Feather name="users" size={12} color="#4A5B73" />
                      <Text style={styles.pilotIntelText}>
                        {pilotIntel.reportCount} pilot report{pilotIntel.reportCount !== 1 ? 's' : ''}
                        {pilotIntel.lastReportedAt ? ` · last ${formatRelative(pilotIntel.lastReportedAt)}` : ''}
                      </Text>
                    </View>
                  )}

                  {/* Why Fly Here */}
                  {result.whySummary?.length > 0 && (
                    <View style={styles.whyBox}>
                      <LinearGradient
                        colors={['rgba(249,115,22,0.10)', 'rgba(249,115,22,0.03)', 'transparent']}
                        style={StyleSheet.absoluteFillObject}
                        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                        pointerEvents="none"
                      />
                      <View style={styles.whyHeader}>
                        <View style={styles.whyAccent} />
                        <Text style={styles.whyLabel}>WHY FLY HERE</Text>
                      </View>
                      {result.whySummary.map((line: string, i: number) => {
                        // Strip leading emoji and map to a keyword-based icon
                        const stripped = line.replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F\u200D]+\s*/u, '');
                        const lc = stripped.toLowerCase();
                        let iconEl: React.ReactElement;
                        if (lc.includes('golf') || lc.includes('course') || lc.includes('round'))
                          iconEl = <MaterialCommunityIcons name="golf-tee" size={14} color="#FF4D00" />;
                        else if (lc.includes('brew') || lc.includes('craft') || lc.includes('winery') || lc.includes('taproom'))
                          iconEl = <MaterialCommunityIcons name="glass-mug-variant" size={14} color="#FF4D00" />;
                        else if (lc.includes('scenic') || lc.includes('mountain') || lc.includes('park') || lc.includes('trail') || lc.includes('lake'))
                          iconEl = <MaterialCommunityIcons name="image-filter-hdr" size={14} color="#FF4D00" />;
                        else if (lc.includes('food') || lc.includes('restaurant') || lc.includes('dining') || lc.includes('lunch') || lc.includes('steak') || lc.includes('bbq'))
                          iconEl = <MaterialCommunityIcons name="silverware-fork-knife" size={14} color="#FF4D00" />;
                        else if (lc.includes('hotel') || lc.includes('lodging') || lc.includes('overnight') || lc.includes('overnighter'))
                          iconEl = <MaterialCommunityIcons name="bed-outline" size={14} color="#FF4D00" />;
                        else if (lc.includes('elevation') || lc.includes('high'))
                          iconEl = <Feather name="map-pin" size={14} color="#FF4D00" />;
                        else if (lc.includes('fuel') || lc.includes('cross-country') || lc.includes('waypoint'))
                          iconEl = <MaterialCommunityIcons name="gas-station" size={14} color="#FF4D00" />;
                        else
                          iconEl = <MaterialCommunityIcons name="airplane" size={14} color="#FF4D00" />;

                        return (
                          <View key={i} style={styles.whyRow}>
                            <View style={styles.whyIconWrap}>
                              {iconEl}
                            </View>
                            <Text style={[styles.whyBullet, { flex: 1 }]}>{stripped}</Text>
                          </View>
                        );
                      })}
                    </View>
                  )}

                  {/* Actions */}
                  <TouchableOpacity style={styles.viewBtn} onPress={goToAirport} activeOpacity={0.85}>
                    <Text style={styles.viewBtnText}>View Airport</Text>
                    <Feather name="arrow-right" size={16} color="#0D1421" style={{ marginLeft: 6 }} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.saveBtn, savedToBucket && styles.saveBtnSaved]}
                    onPress={saveToBucketList}
                    disabled={savedToBucket}
                    activeOpacity={0.82}
                  >
                    <MaterialCommunityIcons
                      name={savedToBucket ? 'star' : 'star-outline'}
                      size={16}
                      color={savedToBucket ? '#0D1421' : '#FBBF24'}
                    />
                    <Text style={[styles.saveBtnText, savedToBucket && styles.saveBtnTextSaved]}>
                      {savedToBucket ? 'Saved to Bucket List' : 'Save to Bucket List'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.rerollBtn} onPress={findSurprise} activeOpacity={0.82}>
                    <LinearGradient
                      colors={['rgba(249,115,22,0.18)', 'rgba(249,115,22,0.08)']}
                      style={StyleSheet.absoluteFillObject}
                      start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                    />
                    <MaterialCommunityIcons name="dice-5" size={18} color="#FF4D00" />
                    <Text style={styles.rerollBtnText}>Roll Again</Text>
                  </TouchableOpacity>
                </View>
              </RNAnimated.View>
            )}
            <View style={{ height: 60 }} />
          </ScrollView>
        </View>
      </Modal>

      <SignInPrompt
        visible={signInPrompt}
        onClose={() => setSignInPrompt(false)}
        title="Save to Bucket List"
        body="Create a free account to save airports and track your flights."
      />
    </>
  );
}

const styles = StyleSheet.create({
  // ── Trigger card ──────────────────────────────────────────────
  trigger: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    overflow: 'hidden', borderRadius: 16,
    paddingHorizontal: 16, paddingVertical: 18,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)',
    marginHorizontal: 16, marginBottom: 16,
    shadowColor: '#FF4D00', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22, shadowRadius: 22, elevation: 10,
  },
  triggerDice: {
    width: 52, height: 52, overflow: 'hidden',
    borderRadius: 13, alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  triggerText: { flex: 1 },
  triggerEyebrow: {
    fontSize: 9, fontWeight: '800', color: '#FF4D00',
    letterSpacing: 2.0, textTransform: 'uppercase', marginBottom: 5,
  },
  triggerTitle: { fontSize: 18, fontWeight: '900', color: '#E5E7EB', letterSpacing: -0.4, marginBottom: 2 },
  triggerSub: { fontSize: 12, color: '#64748B', lineHeight: 17 },

  // ── Modal shell ───────────────────────────────────────────────
  modal: { flex: 1, backgroundColor: '#060B16' },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 20, paddingTop: 60, borderBottomWidth: 1, borderBottomColor: '#1E2D45',
  },
  modalTitle: { fontSize: 26, fontWeight: '800', color: '#F0F4FF' },
  closeBtn: { fontSize: 20, color: '#4A5B73' },
  modalBody: { padding: 20 },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: '#4A5B73', letterSpacing: 1.5, marginBottom: 14 },
  hoursGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 },
  hourChip: {
    backgroundColor: '#0D1421', borderRadius: 12, paddingHorizontal: 20, paddingVertical: 12,
    borderWidth: 1, borderColor: '#1E2D45',
  },
  hourChipActive: { backgroundColor: '#38BDF8', borderColor: '#38BDF8' },
  hourChipText: { fontSize: 15, fontWeight: '600', color: '#4A5B73' },
  hourChipTextActive: { color: '#0D1421', fontWeight: '800' },
  rangeHint: { fontSize: 12, color: '#4A5B73', marginBottom: 20, fontStyle: 'italic' },
  goBtn: { backgroundColor: '#38BDF8', borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginBottom: 24 },
  goBtnDisabled: { opacity: 0.4 },
  goBtnText: { color: '#0D1421', fontSize: 16, fontWeight: '800' },

  // ── Result card ───────────────────────────────────────────────
  resultCard: {
    backgroundColor: '#0A1220',
    borderRadius: 22, overflow: 'hidden',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)',
    borderTopColor: 'rgba(255,255,255,0.14)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.55, shadowRadius: 24, elevation: 18,
  },

  // Hero
  resultHero: { height: 230, backgroundColor: '#0D1B2E', overflow: 'hidden' },
  resultHeroFallback: { ...StyleSheet.absoluteFillObject, backgroundColor: '#0D1B2E' },
  resultHeroGradient: {
    position: 'absolute', bottom: 0, left: 0, right: 0, height: 150,
  },
  resultIcaoBadge: {
    position: 'absolute', top: 14, left: 14,
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(7,11,20,0.72)', borderRadius: 9,
    paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: 'rgba(56,189,248,0.25)',
  },
  resultIcaoBadgeText: { fontSize: 13, fontWeight: '800', color: '#38BDF8', letterSpacing: 0.8 },
  weatherHeroBadge: {
    position: 'absolute', top: 14, right: 14,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 9,
    minWidth: 52, alignItems: 'center',
  },
  weatherBadgeText: { fontSize: 11, fontWeight: '800', color: '#FFFFFF', letterSpacing: 0.6 },
  weatherBadgeVfr: { backgroundColor: 'rgba(22,163,74,0.92)' },
  weatherBadgeMvfr: { backgroundColor: 'rgba(37,99,235,0.92)' },
  weatherBadgeIfr: { backgroundColor: 'rgba(220,38,38,0.92)' },
  weatherBadgeLifr: { backgroundColor: 'rgba(124,58,237,0.92)' },
  heroTitleBlock: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingHorizontal: 18, paddingBottom: 18,
  },
  heroAirportName: {
    fontSize: 28, fontWeight: '900', color: '#FFF8F0',
    letterSpacing: -0.7, lineHeight: 34, marginBottom: 5,
    textShadowColor: 'rgba(0,0,0,0.75)', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 8,
  },
  heroCityState: {
    fontSize: 13, fontWeight: '600', color: 'rgba(251,191,36,0.80)',
    letterSpacing: 0.4,
    textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4,
  },

  // Body
  resultBody: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 20 },

  // Avionics stat strip
  statStrip: {
    flexDirection: 'row', alignItems: 'stretch',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)',
    marginBottom: 16, overflow: 'hidden',
  },
  statCell: { flex: 1, alignItems: 'center', paddingVertical: 14, paddingHorizontal: 6 },
  statCellWarm: { backgroundColor: 'rgba(251,191,36,0.06)' },
  statCellPrimary: { backgroundColor: 'rgba(56,189,248,0.07)' },
  statDivider: { width: 1, backgroundColor: 'rgba(255,255,255,0.07)', marginVertical: 10 },
  statCellLabel: {
    fontSize: 9, fontWeight: '700', color: '#4A5B73',
    letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 5,
  },
  statCellValue: { fontSize: 17, fontWeight: '800', color: '#F0F4FF' },
  statCellUnit: { fontSize: 12, fontWeight: '600', color: '#4A5B73' },

  // Service pills
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  servicePill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(34,197,94,0.10)',
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7,
    borderWidth: 1, borderColor: 'rgba(34,197,94,0.22)',
    alignSelf: 'flex-start',
  },
  servicePillBlue: { backgroundColor: 'rgba(56,189,248,0.10)', borderColor: 'rgba(56,189,248,0.22)' },
  servicePillAmber: { backgroundColor: 'rgba(245,158,11,0.10)', borderColor: 'rgba(245,158,11,0.22)' },
  servicePillMuted: { backgroundColor: 'rgba(107,131,160,0.08)', borderColor: 'rgba(107,131,160,0.18)' },
  servicePillText: { fontSize: 12, fontWeight: '700', color: '#22C55E' },

  pilotIntelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 16 },
  pilotIntelText: { fontSize: 12, color: '#4A5B73', fontWeight: '500' },

  // Why Fly Here
  whyBox: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 14, padding: 14, marginBottom: 18,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)',
    borderLeftWidth: 3, borderLeftColor: '#FF4D00',
    gap: 10,
  },
  whyHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  whyAccent: { width: 3, height: 12, backgroundColor: '#FF4D00', borderRadius: 2 },
  whyLabel: {
    fontSize: 10, fontWeight: '800', color: '#FF4D00',
    letterSpacing: 1.8, textTransform: 'uppercase',
  },
  whyRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  whyIconWrap: {
    width: 32, height: 32, borderRadius: 9,
    backgroundColor: 'rgba(249,115,22,0.15)',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    borderWidth: 1, borderColor: 'rgba(249,115,22,0.28)',
  },
  whyBullet: { fontSize: 14, color: '#D4E8F8', lineHeight: 22, paddingTop: 5 },

  // Actions
  viewBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#38BDF8', borderRadius: 14,
    paddingVertical: 15, marginBottom: 10,
  },
  viewBtnText: { color: '#0D1421', fontSize: 16, fontWeight: '800', letterSpacing: 0.2 },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: 14, paddingVertical: 14, marginBottom: 10,
    borderWidth: 1, borderColor: 'rgba(251,191,36,0.30)',
    backgroundColor: 'rgba(251,191,36,0.08)',
  },
  saveBtnSaved: { backgroundColor: '#FBBF24', borderColor: '#FBBF24' },
  saveBtnText: { fontSize: 14, fontWeight: '700', color: '#FBBF24' },
  saveBtnTextSaved: { color: '#0D1421' },
  rerollBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    overflow: 'hidden',
    borderRadius: 14, paddingVertical: 14,
    borderWidth: 1, borderColor: 'rgba(249,115,22,0.35)',
  },
  rerollBtnText: { color: '#FF4D00', fontSize: 15, fontWeight: '700' },
});
