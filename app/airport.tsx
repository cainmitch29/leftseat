import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons, Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../contexts/AuthContext';
import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Animated, Image, KeyboardAvoidingView, Linking, Modal,
  Platform, ScrollView, Share, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import airportsData from '../assets/images/airports.json';
import { ORANGE } from '../constants/theme';
import WeatherWidget from '../components/WeatherWidget';
import FlyThisTrip from '../components/FlyThisTrip';
import SignInPrompt from '../components/SignInPrompt';
import AirportReviewModal from '../components/AirportReviewModal';
import { supabase } from '../lib/supabase';
import { getWhyFlyHere, WhyItem } from '../utils/whyFlyHere';
import { fetchCuratedEvents } from '../utils/gaEvents';

import { GOOGLE_KEY } from '../utils/config';
import { getCachedCategory, setCachedCategory } from '../utils/placesCache';
import { canCallPlaces, recordPlacesCall, type PlacesPriority } from '../utils/placesRateLimit';
import { fetchGooglePlacesTab, fetchAirportHeroPhoto } from '../utils/googlePlaces';
const airports: any[] = airportsData as any[];

// ─── Helpers ────────────────────────────────────────────────────────────────

const SKY = '#38BDF8';

function mostCommon(arr: string[]): string {
  const counts = new Map<string, number>();
  for (const v of arr) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = arr[0], bestN = 0;
  for (const [v, n] of counts) { if (n > bestN) { best = v; bestN = n; } }
  return best;
}

function formatRelativeDate(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

const FOOD_CHAINS = [
  'mcdonald', 'burger king', 'wendy', 'taco bell', 'kfc', 'arby', 'subway',
  'pizza hut', 'domino', 'papa john', 'dairy queen', 'sonic drive', 'chick-fil-a',
  'chick fil a', 'starbucks', 'dunkin', 'panera', 'chipotle', 'jersey mike',
  'jimmy john', 'five guys', 'applebee', "chili's", 'chilis', 'olive garden',
  'buffalo wild wing', 'cracker barrel', 'ihop', 'denny', 'waffle house',
  'little caesar', 'panda express', 'popeye', 'jack in the box', 'white castle',
  "hardee", "carl's jr", 'el pollo loco', 'wingstop', "zaxby", 'raising cane',
  'shake shack', 'culver', 'whataburger', 'checkers', "rally's", 'del taco',
  'qdoba', 'noodles & company', "jason's deli", 'mcalister',
];

const LODGING_CHAINS = [
  'motel 6', 'super 8', 'days inn', 'quality inn', 'comfort inn', 'comfort suites',
  'best western', 'holiday inn', 'hampton inn', 'courtyard by marriott',
  'fairfield inn', 'extended stay', 'studio 6', 'red roof', 'la quinta',
  'microtel', 'sleep inn', 'econo lodge', 'knights inn', 'travelodge',
];

// Name must contain one of these to qualify as a real hotel
const HOTEL_NAME_ALLOWLIST = [
  'hotel', 'motel', 'inn', 'resort', 'suites', 'suite', 'lodge', 'lodging',
  'marriott', 'hilton', 'hyatt', 'sheraton', 'westin', 'doubletree',
  'hampton', 'courtyard', 'fairfield', 'aloft', 'embassy', 'residence inn',
  'springhill', 'towneplace', 'home2', 'homewood', 'element', 'autograph',
  'ac hotel', 'w hotel', 'four seasons', 'ritz', 'intercontinental',
  'holiday inn', 'crowne plaza', 'avid', 'candlewood', 'staybridge',
  'best western', 'quality inn', 'comfort inn', 'sleep inn', 'econolodge',
  'days inn', 'super 8', 'la quinta', 'motel 6', 'red roof', 'microtel',
];

// Google Places types that hard-exclude a result regardless of name
const NON_HOTEL_TYPES = new Set([
  'real_estate_agency', 'travel_agency', 'lodging_reservation_service',
  'moving_company', 'storage', 'apartment_complex',
  'property_management_company', 'housing_complex', 'general_contractor',
]);

// Name fragments that hard-exclude a result regardless of allowlist match
const NON_HOTEL_NAME_KEYWORDS = [
  'agency', 'travel', 'vacations', 'real estate', 'realty', 'realtor',
  'properties', 'property', 'management', 'apartments', 'apartment',
  'rental', 'airbnb', 'corporate housing', 'furnished', 'relocation',
  'leasing', 'condos', 'townhome', 'executive suite', 'villa', 'retreat',
  ' house', ' home', 'residence', 'b&b',
];

// Strict allow-list: name must match a known hotel pattern; bad type/name hard-excludes first
function isRealLodging(p: any): boolean {
  const lower = (p.name || '').toLowerCase();
  const types: string[] = p.types || [];
  if (types.some(t => NON_HOTEL_TYPES.has(t))) return false;
  if (NON_HOTEL_NAME_KEYWORDS.some(k => lower.includes(k))) return false;
  if (!p.rating || (p.user_ratings_total ?? 0) < 5) return false;
  return HOTEL_NAME_ALLOWLIST.some(k => lower.includes(k));
}

function isChain(name: string, chains: string[]): boolean {
  const lower = name.toLowerCase();
  return chains.some(c => lower.includes(c));
}

const MINI_GOLF_TERMS = ['mini golf', 'miniature golf', 'mini-golf', 'putt putt', 'putt-putt', 'adventure golf', 'family fun center'];

const NON_GOLF_TYPES = new Set([
  'bowling_alley', 'mini_golf', 'sports_complex', 'gym', 'fitness_center',
  'park', 'amusement_center', 'amusement_park', 'store', 'school', 'event_venue',
]);

const GOLF_SKIP_NAMES = [
  'golf cart', 'cart rental', 'cart sales', 'golf simulator',
  'golf supply', 'golf shop', 'golf academy', 'golf school', 'driving range only',
];

// 'course' and 'club' alone are too broad (matches "training course", "nightclub", etc.)
const GOLF_NAME_KEYWORDS = ['golf', 'country club', 'links', 'fairway', 'greens'];

function golfExcludeReason(p: any): string | null {
  const name: string = (p.name || '').toLowerCase();
  const types: string[] = p.types || [];
  const status: string = p.business_status || '';

  if (status && status !== 'OPERATIONAL') return `status=${status}`;
  if (types.some((t: string) => NON_GOLF_TYPES.has(t))) return `excluded type: ${types.find((t: string) => NON_GOLF_TYPES.has(t))}`;
  if (MINI_GOLF_TERMS.some(t => name.includes(t))) return 'mini golf name';
  if (GOLF_SKIP_NAMES.some(t => name.includes(t))) return 'non-playable name';

  const hasGolfType = types.includes('golf_course');
  const hasGolfName = GOLF_NAME_KEYWORDS.some(t => name.includes(t));
  if (!hasGolfType && !hasGolfName) return 'no golf type or name keyword';

  return null;
}

function isRealOperatingGolf(p: any): boolean {
  return golfExcludeReason(p) === null;
}

function isMiniGolf(name: string): boolean {
  const lower = name.toLowerCase();
  return MINI_GOLF_TERMS.some(t => lower.includes(t));
}

function scorePlaceQuality(p: any, aptLat: number | null, aptLng: number | null): number {
  const rating = p.rating || 0;
  const reviews = p.user_ratings_total || 0;
  const dist = (p.geometry?.location?.lat && aptLat)
    ? getDistanceMiles(aptLat, aptLng!, p.geometry.location.lat, p.geometry.location.lng)
    : 50;
  // Distance is the primary factor (-10 per mile).
  // Rating × log(reviews) is a tie-breaker — max ~12 pts at 4.5★ × log(500+1),
  // which can only overcome ~1.2 miles of distance difference.
  const qualityBonus = reviews >= 5 ? rating * Math.log(reviews + 1) : 0;
  return -dist * 10 + qualityBonus;
}

function getDistanceNm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 3440.065;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getDistanceMiles(lat1: number, lng1: number, lat2: number, lng2: number) {
  return getDistanceNm(lat1, lng1, lat2, lng2) * 1.15078;
}

function formatFlightTime(nm: number, speedKts: number): string {
  const hours = nm / speedKts;
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}


const FUEL_LABELS: Record<string, string> = { A: 'Jet A', 'A+': 'Jet A+', B: 'Jet B' };
function formatFuel(fuel: string): string {
  return fuel.split(',').map(f => FUEL_LABELS[f.trim()] ?? f.trim()).join(' / ');
}

// ─── Courtesy Car helpers ─────────────────────────────────────────────────────

/** Map the legacy available bool + optional status text → display status string */
/** Returns true when the crew car record has a pilot-written note (not a default string). */
function hasCustomNote(cc: any): boolean {
  if (!cc?.notes) return false;
  const n = cc.notes;
  const defaults = ['Crew car available', 'Not available', 'Rental car available'];
  return !defaults.includes(n) && n !== deriveStatus(cc);
}

function deriveStatus(cc: any): string {
  if (!cc) return 'Unknown';
  if (cc.status) return cc.status;
  if (cc.available === true)  return 'Available';
  if (cc.available === false) return 'Not Available';
  return 'Unknown';
}

function statusColor(status: string): string {
  if (status === 'Available')     return '#22C55E';
  if (status === 'Call Ahead')    return '#F59E0B';
  if (status === 'Not Available') return '#EF4444';
  return '#6B83A0';
}

function formatCrewCarAge(reportedAt: string | null | undefined): string {
  if (!reportedAt) return 'Tap to report';
  const diffMs = Math.max(0, Date.now() - new Date(reportedAt).getTime());
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Last reported today';
  if (diffDays === 1) return 'Last reported yesterday';
  if (diffDays < 7) return `Last reported ${diffDays} days ago`;
  const d = new Date(reportedAt);
  const mon = d.toLocaleString('en-US', { month: 'short' });
  return `Last reported ${mon} ${d.getDate()}`;
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function AirportScreen() {
  const {
    icao, name, city, state, lat, lng, elevation, fuel,
    runways: runwaysParam, description, tab: initialTab,
  } = useLocalSearchParams();

  const [weatherExpanded, setWeatherExpanded] = useState(false);
  const [runwaysExpanded, setRunwaysExpanded] = useState(false);
  const [showAllReports, setShowAllReports] = useState(false);
  const [activeTab, setActiveTab] = useState(
    typeof initialTab === 'string' && ['info','do','eat','stay','golf'].includes(initialTab) ? initialTab : 'info'
  );
  const [weather, setWeather] = useState<any>(null);
  const [weatherLoading, setWeatherLoading] = useState(true);
  const [weatherError, setWeatherError] = useState(false);
  const [weatherSource, setWeatherSource] = useState<{ icao: string; nm: number } | null>(null);
  const [places, setPlaces] = useState<any>({ restaurants: [], hotels: [], golf: [], things: [] });
  const [placesLoading, setPlacesLoading] = useState(true);
  const [placesErrorTabs, setPlacesErrorTabs] = useState<Set<string>>(new Set());
  const [runways, setRunways] = useState<any[]>([]);
  const [heroPhoto, setHeroPhoto] = useState<string | null>(null);
  const [inBucketList, setInBucketList] = useState(false);
  const [saveToast, setSaveToast] = useState(false);
  const saveToastAnim = useRef(new Animated.Value(0)).current;
  const [inLogBook, setInLogBook] = useState(false);
  const [pilotFlownCount, setPilotFlownCount] = useState<number | null>(null);
  const [flownBadgeExpanded, setFlownBadgeExpanded] = useState(false);
  const flownBadgeAnim = useRef(new Animated.Value(0)).current;
  const [logBookRowId, setLogBookRowId] = useState<string | null>(null);
  const [loggedStats, setLoggedStats] = useState<{
    airports: number; states: number; longestNm: number; achievements: string[];
  } | null>(null);
  const [logFlightError, setLogFlightError] = useState<string | null>(null);
  const [dogFriendly, setDogFriendly] = useState<{ dog_notes: string | null; dog_features: string[] } | null>(null);
  const [crewCar, setCrewCar] = useState<any>(null);
  const [crewCarLoaded, setCrewCarLoaded] = useState(false);
  const [crewCarModal, setCrewCarModal] = useState(false);
  const [crewCarReports, setCrewCarReports] = useState<any[]>([]);
  const [crewCarFormView, setCrewCarFormView] = useState(false);
  const [carStatusPick, setCarStatusPick] = useState('Available');
  const [carNotes, setCarNotes] = useState('');
  const [carSubmitting, setCarSubmitting] = useState(false);
  const [reporterDisplayName, setReporterDisplayName] = useState<string>('');
  const [signInPrompt, setSignInPrompt] = useState(false);
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [editingReview, setEditingReview] = useState<import('../components/AirportReviewModal').ExistingReview | null>(null);
  const [airportInsights, setAirportInsights] = useState<{
    avgFboRating: number | null; ratingCount: number;
    latestFuelPrice: number | null; latestFuelPrices: Record<string, number>; fuelReportedAt: string | null; fuelConsensus: boolean | null; pilotFuelTypes: string[];
    courtesyCar: string | null; carVoteCount: number;
    reviewCount: number; lastReportedAt: string | null;
    // Aggregated V2 intel
    feeConsensus: string | null;
    afterHoursConsensus: string | null;
    topTransport: string[];
    fuelServiceConsensus: string | null;
    reviews: {
      id: string; user_id: string; user_name: string | null;
      courtesy_car: string | null; fuel_available: boolean | null;
      fuel_prices: Record<string, number> | null; fuel_price: number | null; fuel_service_type: string | null;
      fbo_name: string | null; fbo_rating: number | null;
      fee_status: string | null; after_hours_access: string | null;
      transport_options: string[] | null; overnight_friendly: string | null;
      food_access: string | null;
      visit_reason: string | null; notes: string | null;
      created_at: string;
    }[];
    userReview: import('../components/AirportReviewModal').ExistingReview | null;
    fboIntel: { name: string; avgRating: number | null; count: number; lastReportedAt: string }[];
  } | null>(null);
  const [reportModal, setReportModal] = useState(false);
  const [reportTab, setReportTab] = useState('eat');
  const [reportName, setReportName] = useState('');
  const [reportNotes, setReportNotes] = useState('');

  function openReportModal(tab: string) {
    setReportTab(tab);
    setReportName('');
    setReportNotes('');
    setReportModal(true);
  }

  async function submitPlaceReport() {
    if (!user?.id) { setSignInPrompt(true); return; }
    const name = reportName.trim();
    if (!name) return;
    try {
      await supabase.from('user_place_reports').insert({
        icao: String(icao).toUpperCase(),
        category: reportTab,
        place_name: name,
        notes: reportNotes.trim() || null,
        user_id: user?.id ?? 'anonymous',
      });
      if (__DEV__) console.log(`[ReportPlace] submitted: icao=${String(icao).toUpperCase()} cat=${reportTab} name="${name}"`);
    } catch (err) {
      if (__DEV__) console.warn('[ReportPlace] insert error:', err);
    }
    setReportModal(false);
  }
  const [airportInfo, setAirportInfo] = useState<{ ctaf?: string; tower?: string; atis?: string; phone?: string } | null>(null);
  const [nearbyEvents, setNearbyEvents] = useState<any[]>([]);
  const [flyTripEvent, setFlyTripEvent] = useState<any | null>(null);
  const [homeIcao, setHomeIcao] = useState<string | null>(null);
  const [distFromHome, setDistFromHome] = useState<{ nm: number; time: string } | null>(null);
  const isHomeAirport = homeIcao != null && homeIcao === (icao as string)?.toUpperCase();
  const propAnim = useRef(new Animated.Value(1)).current;
  const scrollRef = useRef<any>(null);
  const crewCarY = useRef<number>(0);
  const placeFetchInProgress = useRef(false);
  const router = useRouter();
  const { user } = useAuth();

  // Resolve full airport record from the master dataset first, then build the
  // display object from it — nav params are only a fallback for fields not in
  // the dataset (e.g. a custom tab hint).
  const fullAirport = airports.find(
    (a: any) => (a.icao || a.faa || a.id)?.toUpperCase() === (icao as string)?.toUpperCase()
  );

  if (__DEV__) {
    if (__DEV__) console.log('[airport] nav params received:', { icao, name, city, state, lat, lng, elevation, fuel });
    if (__DEV__) console.log('[airport] fullAirport found:', fullAirport ? 'YES' : 'NO',
      fullAirport ? { name: fullAirport.name, city: fullAirport.city, state: fullAirport.state } : null);
  }

  const resolvedCity  = fullAirport?.city  || (city  as string) || '';
  const resolvedState = fullAirport?.state || (state as string) || '';

  const airport = {
    icao:      (icao as string) || fullAirport?.icao || fullAirport?.faa || fullAirport?.id || '',
    name:      fullAirport?.name || (name as string) || '',
    city:      [resolvedCity, resolvedState].filter(Boolean).join(', '),
    elevation: fullAirport?.elevation != null
      ? `${fullAirport.elevation} ft MSL`
      : (elevation ? `${elevation} ft MSL` : '—'),
    fuel:      fullAirport?.fuel
      ? formatFuel(fullAirport.fuel)
      : ((fuel as string) ? formatFuel(fuel as string) : '—'),
  };

  if (__DEV__) console.log('[airport] final airport object:', airport);

  // ── Canonical fuel display — single source of truth for all fuel UI ────────
  // Pilot reports override static airport data when they exist.
  const fuelDisplay: { available: boolean; label: string; color: string } = (() => {
    const fc = airportInsights?.fuelConsensus;
    const fp = airportInsights?.latestFuelPrices ?? {};
    const ft = airportInsights?.pilotFuelTypes ?? [];
    const hasPilotFuelData = fc !== null && fc !== undefined;
    const staticFuel = airport.fuel && airport.fuel !== '—';

    if (hasPilotFuelData && fc === false) {
      // Pilot says no fuel — override static
      if (__DEV__) console.log('[fuel] pilot override: NOT available');
      return { available: false, label: 'Fuel Unavailable', color: '#EF4444' };
    }
    if (hasPilotFuelData && fc === true) {
      // Pilot says fuel available — show per-type prices if available
      if (Object.keys(fp).length > 0) {
        const parts = Object.entries(fp).map(([t, p]) => `${t} $${Number(p).toFixed(2)}`);
        if (__DEV__) console.log('[fuel] pilot override: per-type prices', parts);
        return { available: true, label: parts.join(' · '), color: '#22C55E' };
      }
      if (ft.length > 0) {
        if (__DEV__) console.log('[fuel] pilot override: types only', ft);
        return { available: true, label: ft.join(' / '), color: '#22C55E' };
      }
      if (__DEV__) console.log('[fuel] pilot override: available (no type detail)');
      return { available: true, label: staticFuel ? airport.fuel : 'Fuel Available', color: '#22C55E' };
    }
    // No pilot fuel data — fall back to static
    if (staticFuel) {
      return { available: true, label: airport.fuel, color: '#22C55E' };
    }
    return { available: false, label: 'No Fuel Data', color: '#6B83A0' };
  })();

  const airportLat = fullAirport?.lat  ?? (lat  ? parseFloat(lat  as string) : null);
  const airportLng = fullAirport?.lng  ?? (lng  ? parseFloat(lng  as string) : null);
  const hasPlacesData = !placesLoading && (
    places.restaurants.length > 0 || places.hotels.length > 0 ||
    places.golf.length > 0 || places.things.length > 0
  );
  const whyItems: WhyItem[] = getWhyFlyHere(
    fullAirport ?? {
      fuel, runways: runwaysParam ? (() => { try { return JSON.parse(runwaysParam as string); } catch { return []; } })() : [],
    },
    hasPlacesData ? places : undefined,
  );

  // ── Effects ───────────────────────────────────────────────────────────────

  useEffect(() => {
    fetchWeather();
    fetchRunways();
    fetchAirportPhoto();
    fetchCrewCar();
    fetchAirportInfo();
    fetchAirportInsights();
    // Pilot flown count — unique pilots who've logged this airport
    supabase
      .from('visited_airports')
      .select('user_id')
      .eq('icao', (icao as string).toUpperCase())
      .then(({ data }) => {
        if (data) setPilotFlownCount(new Set(data.map(r => r.user_id)).size);
      });
    // Dog-friendly data
    supabase
      .from('dog_friendly_airports')
      .select('dog_notes, dog_features')
      .eq('airport_icao', (icao as string).toUpperCase())
      .maybeSingle()
      .then(({ data }) => setDogFriendly(data ? { dog_notes: data.dog_notes, dog_features: data.dog_features ?? [] } : null));
    if (airportLat && airportLng) {
      fetchPlaces(airportLat, airportLng);
      fetchNearbyEvents(airportLat, airportLng, String(icao));
    } else {
      fetchAirportCoords();
    }
  }, [icao]);

  // Lazy-load places data when user taps a tab
  useEffect(() => {
    if (activeTab !== 'info' && airportLat && airportLng) {
      fetchPlacesForTab(activeTab);
    }
  }, [activeTab]);

  useEffect(() => {
    supabase
      .from('bucket_list')
      .select('icao')
      .eq('user_id', user?.id ?? '')
      .eq('icao', (icao as string).toUpperCase())
      .maybeSingle()
      .then(({ data }) => { if (data) setInBucketList(true); });
  }, [icao]);

  useEffect(() => {
    supabase
      .from('visited_airports')
      .select('id')
      .eq('user_id', user?.id ?? '')
      .eq('icao', (icao as string).toUpperCase())
      .maybeSingle()
      .then(({ data }) => { if (data) { setInLogBook(true); setLogBookRowId(data.id); } });
  }, [icao]);

  // Load home airport and calculate distance
  useEffect(() => {
    AsyncStorage.getItem(`userProfile:${user?.id ?? 'guest'}`).then((data) => {
      if (!data) return;
      const profile = JSON.parse(data);
      const speed = profile.cruise_speed ? Number(profile.cruise_speed) : 120;
      if (__DEV__) console.log('[time calc] airport.tsx — home dist uses speed:', speed, 'kts');
      // Resolve a display name for courtesy car reports
      const displayName = profile.username
        ? `@${profile.username}`
        : profile.name
          ? profile.name
          : user?.email?.split('@')[0] ?? 'Pilot';
      setReporterDisplayName(displayName);
      if (profile.home_airport) {
        setHomeIcao(profile.home_airport.toUpperCase());
        const homeApt = airports.find(
          (a: any) => (a.icao || a.id)?.toUpperCase() === profile.home_airport.toUpperCase()
        );
        if (homeApt?.lat && homeApt?.lng && airportLat && airportLng) {
          const nm = Math.round(getDistanceNm(homeApt.lat, homeApt.lng, airportLat, airportLng));
          setDistFromHome({ nm, time: formatFlightTime(nm, speed) });
        }
      }
    });
  }, [airportLat, airportLng]);

  // ── Data fetching ──────────────────────────────────────────────────────────

  function showSaveToast() {
    setSaveToast(true);
    saveToastAnim.setValue(0);
    Animated.sequence([
      Animated.timing(saveToastAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.delay(1400),
      Animated.timing(saveToastAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start(() => setSaveToast(false));
  }

  function handleBucketList() {
    Animated.sequence([
      Animated.timing(propAnim, { toValue: 0.85, duration: 80, useNativeDriver: true }),
      Animated.spring(propAnim, { toValue: 1, friction: 4, useNativeDriver: true }),
    ]).start();
    if (!inBucketList) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showSaveToast();
    } else {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    toggleBucketList();
  }

  async function toggleBucketList() {
    if (!user?.id) { setSignInPrompt(true); return; }
    const upperIcao = (icao as string).toUpperCase();
    if (inBucketList) {
      const { error } = await supabase
        .from('bucket_list')
        .delete()
        .eq('user_id', user.id)
        .eq('icao', upperIcao);
      if (error) { console.error('[BucketList] delete error:', error.message); return; }
      setInBucketList(false);
    } else {
      const { error } = await supabase.from('bucket_list').upsert({
        user_id: user.id,
        icao: upperIcao,
        name: airport.name,
        city: fullAirport?.city ?? (city as string) ?? '',
        state: fullAirport?.state ?? (state as string) ?? '',
        lat: airportLat,
        lng: airportLng,
        elevation: fullAirport?.elevation ?? (elevation ? parseInt(elevation as string) : null),
        fuel: fullAirport?.fuel ?? (fuel as string) ?? '',
      }, { onConflict: 'user_id,icao' });
      if (error) { console.error('[BucketList] upsert error:', error.message, error.code); return; }
      setInBucketList(true);
    }
  }

  async function logFlight() {
    if (!user?.id) { setSignInPrompt(true); return; }
    setLogFlightError(null);
    const upperIcao = (icao as string).toUpperCase();

    // ── Unlog: confirm then delete ────────────────────────────────────────────
    if (inLogBook) {
      Alert.alert(
        'Remove Flight Log',
        `Remove ${(icao as string).toUpperCase()} from your logbook?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove', style: 'destructive',
            onPress: async () => {
              const query = logBookRowId
                ? supabase.from('visited_airports').delete().eq('id', logBookRowId)
                : supabase.from('visited_airports').delete().eq('user_id', user?.id ?? '').eq('icao', upperIcao);
              const { error } = await query;
              if (error) { setLogFlightError('Could not remove flight log. Try again.'); return; }
              setInLogBook(false);
              setLogBookRowId(null);
              setLoggedStats(null);
            },
          },
        ]
      );
      return;
    }

    // ── Log: insert a new row ─────────────────────────────────────────────────
    const { data: inserted, error } = await supabase.from('visited_airports').insert({
      user_id: user?.id ?? 'anonymous',
      icao: upperIcao,
      name: name as string,
      city: city as string,
      state: state as string,
      lat: airportLat,
      lng: airportLng,
    }).select('id').single();
    if (inserted?.id) setLogBookRowId(inserted.id);
    if (error) {
      if (__DEV__) console.error('[LogFlight] insert error:', error.message, error.code);
      if (error.message?.includes('schema cache') || error.code === 'PGRST204' || error.code === '42P01') {
        setLogFlightError('Table not set up yet. Run docs/supabase_visited_airports.sql in Supabase.');
      } else {
        setLogFlightError('Could not log flight. Check your connection and try again.');
      }
      return;
    }
    setInLogBook(true);
    setPilotFlownCount(prev => (prev ?? 0) + 1);

    // Fetch updated stats to show the success panel
    const { data: allVisits } = await supabase
      .from('visited_airports')
      .select('icao, state, lat, lng')
      .eq('user_id', user?.id ?? '');

    if (allVisits) {
      const uniqueIcaos = new Set(allVisits.map(r => r.icao));
      const uniqueStates = new Set(allVisits.filter(r => r.state).map(r => r.state));

      const HOME_LAT = 38.66, HOME_LNG = -90.65;
      let longestNm = 0;
      for (const r of allVisits) {
        if (r.icao !== 'KSUS' && r.lat && r.lng) {
          const nm = Math.round(getDistanceNm(HOME_LAT, HOME_LNG, r.lat, r.lng));
          if (nm > longestNm) longestNm = nm;
        }
      }

      const airports = uniqueIcaos.size;
      const states = uniqueStates.size;

      // Check milestone achievements hit by this exact count
      const achievements: string[] = [];
      if (airports === 1) achievements.push('🏅 First Flight Logged!');
      if (airports === 5) achievements.push('🛬 5 Airports Visited');
      if (airports === 10) achievements.push('✈️ 10 Airports Visited');
      if (airports === 20) achievements.push('🌎 20 Airports Visited');
      if (states === 1) achievements.push('🗺️ First State Conquered');
      if (states === 5) achievements.push('🌟 5 States Flown');

      setLoggedStats({ airports, states, longestNm, achievements });
    }

    // Open review modal after logging
    setReviewModalOpen(true);
  }

  async function fetchAirportInsights() {
    const emptyInsights = { avgFboRating: null, ratingCount: 0, latestFuelPrice: null, latestFuelPrices: {} as Record<string, number>, fuelReportedAt: null, fuelConsensus: null as boolean | null, pilotFuelTypes: [] as string[], courtesyCar: null, carVoteCount: 0, reviewCount: 0, lastReportedAt: null, feeConsensus: null, afterHoursConsensus: null, topTransport: [] as string[], fuelServiceConsensus: null, reviews: [] as any[], userReview: null, fboIntel: [] as any[] };
    const upperIcao = (icao as string).toUpperCase();
    try {
      // Try full query first; if V2 columns don't exist, retry with core columns only
      let data: any[] | null = null;
      let error: any = null;
      ({ data, error } = await supabase
        .from('airport_reviews')
        .select('id, user_id, courtesy_car, fuel_available, fuel_types, fuel_prices, fuel_price, fuel_service_type, fbo_name, fbo_rating, fee_status, fee_amount_text, after_hours_access, transport_options, overnight_friendly, food_access, visit_reason, notes, created_at')
        .eq('airport_icao', upperIcao)
        .order('created_at', { ascending: false })
        .limit(50));
      if (error && error.message?.includes('column')) {
        if (__DEV__) console.warn('[Insights] V2 columns missing, retrying with core fields');
        ({ data, error } = await supabase
          .from('airport_reviews')
          .select('id, user_id, courtesy_car, fuel_available, fuel_price, fbo_rating, visit_reason, notes, created_at')
          .eq('airport_icao', upperIcao)
          .order('created_at', { ascending: false })
          .limit(50));
      }

      if (error || !data || data.length === 0) {
        if (__DEV__ && error) console.warn('[Insights] fetch error:', error.message);
        setAirportInsights(emptyInsights);
        return;
      }

      // Fetch reviewer names
      const userIds = [...new Set(data.map(r => r.user_id))];
      const { data: profiles } = await supabase
        .from('pilot_profiles')
        .select('user_id, name')
        .in('user_id', userIds);
      const profileMap = new Map((profiles ?? []).map(p => [p.user_id, p]));

      // Aggregation — FBO rating: mean of all non-null values
      const ratings = data.filter(r => r.fbo_rating != null).map(r => r.fbo_rating!);
      const ratingCount = ratings.length;
      const avgFboRating = ratingCount > 0 ? Math.round(ratings.reduce((a, b) => a + b, 0) / ratingCount * 10) / 10 : null;

      // Fuel price: most recent per-type prices, falling back to legacy single price
      const latestPricesReport = data.find(r => r.fuel_prices && Object.keys(r.fuel_prices).length > 0);
      const latestFuelPrices: Record<string, number> = latestPricesReport?.fuel_prices ?? {};
      const latestFuelReport = latestPricesReport ?? data.find(r => r.fuel_price != null && r.fuel_price > 0);
      const latestFuelPrice = latestFuelReport?.fuel_price ?? null;
      const fuelReportedAt = latestFuelReport?.created_at ?? null;
      if (__DEV__ && latestFuelReport) {
        console.log('[Insights:fuel] per-type:', JSON.stringify(latestFuelPrices), '| legacy:', latestFuelPrice);
      }

      // Fuel availability: majority vote from pilot reports
      const fuelVotes = data.filter(r => r.fuel_available === true || r.fuel_available === false);
      const fuelYes = fuelVotes.filter(r => r.fuel_available === true).length;
      const fuelConsensus: boolean | null = fuelVotes.length >= 1
        ? fuelYes > fuelVotes.length / 2 ? true : fuelYes < fuelVotes.length / 2 ? false : null
        : null;

      // Fuel types: union of all reported types (most recent first)
      const reportedFuelTypes = new Set<string>();
      for (const r of data) {
        if (r.fuel_types) for (const t of r.fuel_types) reportedFuelTypes.add(t);
      }
      const pilotFuelTypes = [...reportedFuelTypes];

      // Courtesy car: majority vote, but only if 2+ non-unknown votes
      const carVotes = data.filter(r => r.courtesy_car === 'yes' || r.courtesy_car === 'no');
      const carVoteCount = carVotes.length;
      const yesCount = carVotes.filter(r => r.courtesy_car === 'yes').length;
      const courtesyCar = carVoteCount >= 2
        ? (yesCount > carVoteCount / 2 ? 'yes' : yesCount < carVoteCount / 2 ? 'no' : 'mixed')
        : carVoteCount === 1 ? carVotes[0].courtesy_car : null;

      const lastReportedAt = data[0].created_at;

      // Sort: own report first, then newest
      const currentUserId = user?.id;
      const sorted = [...data].sort((a, b) => {
        if (currentUserId) {
          if (a.user_id === currentUserId && b.user_id !== currentUserId) return -1;
          if (b.user_id === currentUserId && a.user_id !== currentUserId) return 1;
        }
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });

      const reviews = sorted.slice(0, 10).map(r => ({
        ...r,
        user_name: profileMap.get(r.user_id)?.name ?? null,
      }));

      // Find the current user's most recent review for edit
      const ownRow = currentUserId ? data.find(r => r.user_id === currentUserId) : null;
      const userReview: import('../components/AirportReviewModal').ExistingReview | null = ownRow ? {
        id: ownRow.id,
        courtesy_car: ownRow.courtesy_car, fuel_available: ownRow.fuel_available,
        fuel_types: ownRow.fuel_types, fuel_prices: ownRow.fuel_prices, fuel_price: ownRow.fuel_price, fuel_service_type: ownRow.fuel_service_type,
        fbo_name: ownRow.fbo_name, fbo_rating: ownRow.fbo_rating,
        fee_status: ownRow.fee_status, fee_amount_text: ownRow.fee_amount_text,
        after_hours_access: ownRow.after_hours_access,
        transport_options: ownRow.transport_options,
        overnight_friendly: ownRow.overnight_friendly,
        food_access: ownRow.food_access,
        visit_reason: ownRow.visit_reason, notes: ownRow.notes,
      } : null;

      // V2 aggregation
      const feeVotes = data.filter(r => r.fee_status && r.fee_status !== 'not_sure');
      const feeConsensus = feeVotes.length > 0 ? mostCommon(feeVotes.map(r => r.fee_status!)) : null;

      const ahVotes = data.filter(r => r.after_hours_access === 'yes' || r.after_hours_access === 'no');
      const ahYes = ahVotes.filter(r => r.after_hours_access === 'yes').length;
      const afterHoursConsensus = ahVotes.length >= 1 ? (ahYes > ahVotes.length / 2 ? 'yes' : ahYes < ahVotes.length / 2 ? 'no' : 'mixed') : null;

      const transportCounts = new Map<string, number>();
      for (const r of data) {
        if (!r.transport_options) continue;
        for (const t of r.transport_options) transportCounts.set(t, (transportCounts.get(t) ?? 0) + 1);
      }
      const topTransport = [...transportCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([t]) => t);

      const fsVotes = data.filter(r => r.fuel_service_type && r.fuel_service_type !== 'not_sure');
      const fuelServiceConsensus = fsVotes.length > 0 ? mostCommon(fsVotes.map(r => r.fuel_service_type!)) : null;

      // FBO Intel — group by fbo_name, compute per-FBO stats
      const fboMap = new Map<string, { ratings: number[]; count: number; latest: string }>();
      for (const r of data) {
        if (!r.fbo_name) continue;
        const entry = fboMap.get(r.fbo_name) ?? { ratings: [] as number[], count: 0, latest: r.created_at };
        entry.count++;
        if (r.fbo_rating != null) entry.ratings.push(r.fbo_rating);
        if (r.created_at > entry.latest) entry.latest = r.created_at;
        fboMap.set(r.fbo_name, entry);
      }
      const fboIntel = [...fboMap.entries()]
        .map(([name, e]) => ({
          name,
          avgRating: e.ratings.length > 0 ? Math.round(e.ratings.reduce((a, b) => a + b, 0) / e.ratings.length * 10) / 10 : null,
          count: e.count,
          lastReportedAt: e.latest,
        }))
        .sort((a, b) => b.count - a.count || new Date(b.lastReportedAt).getTime() - new Date(a.lastReportedAt).getTime());

      setAirportInsights({ avgFboRating, ratingCount, latestFuelPrice, latestFuelPrices, fuelReportedAt, fuelConsensus, pilotFuelTypes, courtesyCar, carVoteCount, reviewCount: data.length, lastReportedAt, feeConsensus, afterHoursConsensus, topTransport, fuelServiceConsensus, reviews, userReview, fboIntel });
      if (__DEV__) console.log('[Insights]', upperIcao, '— reviews:', data.length, '| ownReview:', !!userReview);
    } catch (e: any) {
      if (__DEV__) console.warn('[Insights] exception:', e?.message);
    }
  }

  async function fetchAirportPhoto() {
    const cacheKey = `heroPhoto:${(icao as string).toUpperCase()}`;
    // Show cached URL immediately so offline visits work
    try {
      const cached = await AsyncStorage.getItem(cacheKey);
      if (cached) setHeroPhoto(cached);
    } catch {}
    // Attempt live fetch; update + re-cache if successful
    try {
      const url = await fetchAirportHeroPhoto({
        icao: (icao as string).toUpperCase(),
        lat: airportLat,
        lng: airportLng,
        heroImage: fullAirport?.heroImage,
      });
      if (url) {
        setHeroPhoto(url);
        AsyncStorage.setItem(cacheKey, url).catch(() => {});
      }
    } catch {}
  }

  async function fetchCrewCar() {
    try {
      const { data: reports, error } = await supabase
        .from('crew_cars')
        .select('*')
        .eq('icao', icao)
        .order('reported_at', { ascending: false })
        .limit(3);
      if (error) throw error;
      if (reports && reports.length > 0) {
        setCrewCar(reports[0]);
        setCrewCarReports(reports);
      }
    } catch (e: any) {
      if (__DEV__) console.warn('[CourtesyCar] fetchCrewCar error:', e?.message);
      setCrewCar(null);
    } finally {
      setCrewCarLoaded(true);
    }
  }

  async function submitCourtesyCarReport() {
    if (!user?.id) { setSignInPrompt(true); return; }
    setCarSubmitting(true);
    const available = carStatusPick === 'Available' || carStatusPick === 'Call Ahead';
    const notes = carNotes.trim() || carStatusPick;

    // Try full insert with new columns first.
    // If columns don't exist yet (migration not run), fall back to the legacy schema.
    let result = await supabase.from('crew_cars').insert({
      icao,
      user_id: user?.id ?? 'anonymous',
      reporter_name: reporterDisplayName || null,
      available,
      status: carStatusPick,
      notes,
    });

    if (result.error) {
      if (__DEV__) console.warn('[CourtesyCar] full insert failed, retrying without new columns:', result.error.message);
      result = await supabase.from('crew_cars').insert({
        icao,
        user_id: user?.id ?? 'anonymous',
        available,
        notes,
      });
    }

    if (result.error) {
      if (__DEV__) console.error('[CourtesyCar] insert failed:', result.error.message);
      Alert.alert('Error', 'Could not save your report. Please try again.');
    } else {
      const newRecord = {
        available, status: carStatusPick, notes,
        reporter_name: reporterDisplayName || null,
        reported_at: new Date().toISOString(),
      };
      setCrewCar(newRecord);
      setCrewCarReports(prev => [newRecord, ...prev].slice(0, 3));
    }

    setCarSubmitting(false);
    setCrewCarFormView(false);
    setCrewCarModal(false);
  }

  async function fetchNearbyEvents(aptLat: number, aptLng: number, aptIcao: string) {
    const today = new Date().toISOString().split('T')[0];
    const upper = aptIcao.toUpperCase();
    const { data } = await supabase.from('events').select('*').gte('start_date', today).order('start_date', { ascending: true });
    const supabaseEvents = (data || []).filter((e: any) => {
      if ((e.nearest_airport || '').toUpperCase() === upper) return true;
      return false;
    });
    const curated = fetchCuratedEvents().filter(e => {
      if (e.nearest_airport === upper) return true;
      // ~30 mi driving ≈ 26 nm straight-line
      return getDistanceNm(aptLat, aptLng, e.lat, e.lng) <= 26;
    });
    // Merge — supabase wins on duplicate event_name+start_date
    const seen = new Set<string>();
    const merged: any[] = [];
    for (const e of supabaseEvents) { seen.add(`${(e.event_name||'').trim().toLowerCase()}_${e.start_date}`); merged.push(e); }
    for (const e of curated) { const k = `${e.event_name.trim().toLowerCase()}_${e.start_date}`; if (!seen.has(k)) { seen.add(k); merged.push(e); } }
    merged.sort((a, b) => a.start_date.localeCompare(b.start_date));
    setNearbyEvents(merged.slice(0, 10));
  }

  async function fetchAirportInfo() {
    try {
      const id = (icao || 'KSBA').toString().toUpperCase();
      const res = await fetch(`https://aviationweather.gov/api/data/airport?ids=${id}&format=json`);
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        const raw = data[0];
        // Parse the semicolon-delimited freqs field: "LCL/P,118.45;ATIS,133.925"
        const freqMap: Record<string, string> = {};
        if (raw.freqs) {
          raw.freqs.split(';').forEach((entry: string) => {
            const comma = entry.indexOf(',');
            if (comma > 0) {
              const type = entry.slice(0, comma).trim().toUpperCase();
              const freq = entry.slice(comma + 1).trim();
              freqMap[type] = freq;
            }
          });
        }
        if (__DEV__) console.log('[airportInfo] raw API freqs:', raw.freqs, '→ parsed:', freqMap);
        // LCL/P = tower frequency; CTAF/UNIC = self-announce; ATIS = ATIS
        const towerFreq = freqMap['LCL/P'] || freqMap['LCL'] || undefined;
        const ctafFreq  = freqMap['CTAF']  || freqMap['UNIC'] || towerFreq || undefined;
        const atisFreq  = freqMap['ATIS']  || freqMap['D-ATIS'] || undefined;
        const phoneVal  = typeof raw.phone === 'string' && raw.phone.length > 4 ? raw.phone : undefined;
        setAirportInfo({ ctaf: ctafFreq, tower: towerFreq, atis: atisFreq, phone: phoneVal });
        if (__DEV__) console.log('[airportInfo] final:', { ctaf: ctafFreq, tower: towerFreq, atis: atisFreq, phone: phoneVal });
      }
    } catch {}
  }

  async function fetchWeather() {
    setWeatherLoading(true);
    setWeatherError(false);
    setWeatherSource(null);
    try {
      const id = (fullAirport?.icao || fullAirport?.faa || fullAirport?.id || 'KSBA').toString().toUpperCase();
      let data = null;

      // Try to fetch METAR for the current airport
      try {
        const res = await fetch(`https://tgftp.nws.noaa.gov/data/observations/metar/stations/${id}.TXT`, {
          headers: { 'User-Agent': 'LeftSeatApp/1.0' }
        });
        const text = await res.text();
        if (text.includes(id) && text.trim().split('\n').length >= 2) {
          const lines = text.trim().split('\n');
          const metarString = lines[1];
          
          // Parse METAR components
          const vrbWindMatch = metarString.match(/VRB(\d{2,3})(?:G(\d{2,3}))?KT/);
          let wdir: number | string | null = null;
          let wspd: number | null = null;
          let wgst: number | null = null;

          if (vrbWindMatch) {
            wdir = "VRB";
            wspd = parseInt(vrbWindMatch[1]);
            wgst = vrbWindMatch[2] ? parseInt(vrbWindMatch[2]) : null;
          } else {
            const windMatch = metarString.match(/(\d{3})(\d{2,3})(?:G(\d{2,3}))?KT/);
            if (windMatch) {
              wdir = parseInt(windMatch[1]);
              wspd = parseInt(windMatch[2]);
              wgst = windMatch[3] ? parseInt(windMatch[3]) : null;
            }
          }
          
          const visMatch = metarString.match(/(\d+)SM/);
          const tempDewpMatch = metarString.match(/(M?\d+)\/(M?\d+)/);
          const altMatch = metarString.match(/A(\d{4})/);
          
          // Parse clouds: FEW060, SCT120, etc.
          const cloudMatches = [...metarString.matchAll(/(FEW|SCT|BKN|OVC)(\d{3})/g)];
          const clouds = cloudMatches.map(match => ({
            cover: match[1],
            base: parseInt(match[2]) * 100 // Convert to feet
          }));
          
          const temp = tempDewpMatch ? (tempDewpMatch[1].startsWith('M') ? -parseInt(tempDewpMatch[1].slice(1)) : parseInt(tempDewpMatch[1])) : null;
          const dewp = tempDewpMatch ? (tempDewpMatch[2].startsWith('M') ? -parseInt(tempDewpMatch[2].slice(1)) : parseInt(tempDewpMatch[2])) : null;
          
          const parsedData = {
            station_id: id,
            raw_text: metarString,
            observation_time: new Date().toISOString(),
            wdir: wdir,
            wspd: wspd,
            wgst: wgst,
            elev: fullAirport?.elevation ?? 0,
            visib: visMatch ? parseInt(visMatch[1]) : 10,
            temp: temp,
            dewp: dewp,
            altim: altMatch ? parseFloat(altMatch[1].slice(0, 2) + '.' + altMatch[1].slice(2)) : null,
            clouds: clouds,
            rawOb: metarString,
            flight_category: "VFR" // Will be calculated in parseMetar
          };
          
          data = [parsedData];
        }
      } catch (e) {
        // Current airport METAR fetch failed, will try fallback
        if (__DEV__) console.warn(`[Weather] Failed to fetch METAR for ${id}:`, e);
      }

      // If no direct METAR, attempt nearest-reporting-airport fallback within 50 nm
      if ((!data || data.length === 0) && airportLat != null && airportLng != null) {
        // build candidate list of airports with coords and identifier
        const nearbyAll = airports
          .filter((a: any) => (a.icao || a.faa || a.id) && a.lat != null && a.lng != null)
          .map((a: any) => {
            const aid = (a.icao || a.faa || a.id).toString().toUpperCase();
            const lat = Number(a.lat);
            const lng = Number(a.lng);
            const nm = getDistanceNm(airportLat, airportLng, lat, lng);
            return { id: aid, lat, lng, nm, hasIcao: Boolean(a.icao) };
          })
          .filter((c: any) => c.nm > 0 && c.nm <= 50)
          .sort((a: any, b: any) => a.nm - b.nm);

        // Prefer reporting stations (hasIcao) when available. Try reporting stations first in distance order,
        // then non-reporting stations.
        const reporting = nearbyAll.filter((c: any) => c.hasIcao);
        const nonReporting = nearbyAll.filter((c: any) => !c.hasIcao);

        let found = false;
        for (const c of reporting.concat(nonReporting)) {
          try {
            const res2 = await fetch(`https://tgftp.nws.noaa.gov/data/observations/metar/stations/${c.id}.TXT`, {
              headers: { 'User-Agent': 'LeftSeatApp/1.0' }
            });
            const text = await res2.text();
            if (text.includes(c.id) && text.trim().split('\n').length >= 2) {
              const lines = text.trim().split('\n');
              const metarString = lines[1];
              
              // Parse METAR components
              const vrbWindMatch = metarString.match(/VRB(\d{2,3})(?:G(\d{2,3}))?KT/);
              let wdir: number | string | null = null;
              let wspd: number | null = null;
              let wgst: number | null = null;

              if (vrbWindMatch) {
                wdir = "VRB";
                wspd = parseInt(vrbWindMatch[1]);
                wgst = vrbWindMatch[2] ? parseInt(vrbWindMatch[2]) : null;
              } else {
                const windMatch = metarString.match(/(\d{3})(\d{2,3})(?:G(\d{2,3}))?KT/);
                if (windMatch) {
                  wdir = parseInt(windMatch[1]);
                  wspd = parseInt(windMatch[2]);
                  wgst = windMatch[3] ? parseInt(windMatch[3]) : null;
                }
              }
              
              const visMatch = metarString.match(/(\d+)SM/);
              const tempDewpMatch = metarString.match(/(M?\d+)\/(M?\d+)/);
              const altMatch = metarString.match(/A(\d{4})/);
              
              // Parse clouds: FEW060, SCT120, etc.
              const cloudMatches = [...metarString.matchAll(/(FEW|SCT|BKN|OVC)(\d{3})/g)];
              const clouds = cloudMatches.map(match => ({
                cover: match[1],
                base: parseInt(match[2]) * 100 // Convert to feet
              }));
              
              const temp = tempDewpMatch ? (tempDewpMatch[1].startsWith('M') ? -parseInt(tempDewpMatch[1].slice(1)) : parseInt(tempDewpMatch[1])) : null;
              const dewp = tempDewpMatch ? (tempDewpMatch[2].startsWith('M') ? -parseInt(tempDewpMatch[2].slice(1)) : parseInt(tempDewpMatch[2])) : null;
              
              const parsedData = {
                station_id: c.id,
                raw_text: metarString,
                observation_time: new Date().toISOString(),
                wdir: wdir,
                wspd: wspd,
                wgst: wgst,
                elev: fullAirport?.elevation ?? 0,
                visib: visMatch ? parseInt(visMatch[1]) : 10,
                temp: temp,
                dewp: dewp,
                altim: altMatch ? parseFloat(altMatch[1].slice(0, 2) + '.' + altMatch[1].slice(2)) : null,
                clouds: clouds,
                rawOb: metarString,
                flight_category: "VFR" // Will be calculated in parseMetar
              };
              
              data = [parsedData];
              setWeatherSource({ icao: c.id, nm: Math.round(c.nm) });
              found = true;
              break;
            }
          } catch (e) {
            if (__DEV__) console.warn(`[Weather] Failed to fetch METAR for ${c.id}:`, e);
            // Continue to next candidate
          }
        }
        if (!found) {
          // leave data as null
        }
      }

      if (data && data.length > 0) {
        setWeather(parseMetar(data[0]));
      } else {
        setWeatherError(true);
      }
    } catch { setWeatherError(true); }
    finally { setWeatherLoading(false); }
  }

  function isHelipad(id: string) { return /^H\d/i.test((id || '').trim()); }

  async function fetchRunways() {
    try {
      // Prefer nav param (e.g. from search results that already have runway data)
      if (runwaysParam) {
        const parsed = JSON.parse(runwaysParam as string);
        const real = parsed?.filter((r: any) => r.id && !isHelipad(r.id)) ?? [];
        if (__DEV__) console.log('[runways] nav param raw:', parsed, '→ filtered:', real);
        if (real.length > 0) { setRunways(real); return; }
      }
      // Fall back to the full airport record from the master dataset
      if (fullAirport?.runways && fullAirport.runways.length > 0) {
        const real = fullAirport.runways.filter((r: any) => r.id && !isHelipad(r.id));
        if (__DEV__) console.log('[runways] dataset raw:', fullAirport.runways, '→ filtered:', real);
        if (real.length > 0) { setRunways(real); return; }
      }
      if (__DEV__) console.log('[runways] no runway data found for', fullAirport?.icao || icao);
      setRunways([]);
    } catch { setRunways([]); }
  }

  async function fetchAirportCoords() {
    try {
      const id = (icao || 'KSBA').toString().toUpperCase();
      const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${id}+airport&format=json&limit=1`, { headers: { 'User-Agent': 'LeftSeatApp/1.0' } });
      const data = await res.json();
      if (data && data.length > 0) { fetchPlaces(parseFloat(data[0].lat), parseFloat(data[0].lon)); }
      else { setPlacesLoading(false); }
    } catch { setPlacesLoading(false); }
  }

  // Track which tabs have been fetched this session to avoid re-fetching
  const fetchedTabs = useRef(new Set<string>());

  /**
   * Lazy tab fetch — only loads data for one tab at a time.
   * Checks Supabase cache first, then calls Google Places only if needed.
   * Saves ~75% of API calls vs the old approach of fetching all 4 tabs at once.
   */
  async function fetchPlacesForTab(tab: string) {
    const icaoStr = (icao as string).toUpperCase();
    if (!airportLat || !airportLng) return;

    // Map tab name → cache category
    const tabToCat: Record<string, string> = { eat: 'restaurants', stay: 'hotels', golf: 'golf', do: 'things' };
    const cat = tabToCat[tab];
    if (!cat) return;

    // Already fetched this session? Skip.
    if (fetchedTabs.current.has(tab)) return;
    fetchedTabs.current.add(tab);

    setPlacesLoading(true);
    try {
      // Check cache first
      const cached = await getCachedCategory(icaoStr, cat as any);
      // Treat empty golf cache as miss (legacy broken fetches)
      const validCache = (tab === 'golf' && cached?.length === 0) ? null : cached;

      if (validCache) {
        if (__DEV__) console.log(`[Places:lazy] ${icaoStr}/${tab} — cache HIT (${validCache.length} items)`);
        setPlaces((prev: any) => ({ ...prev, [cat]: validCache }));
        setPlacesLoading(false);
        return;
      }

      // Pre-check rate limiter — if blocked, mark as error without wasting a call
      const source = `airport_detail_${tab}`;
      if (!canCallPlaces('nearbysearch', source, 'high')) {
        if (__DEV__) console.log(`[Places:lazy] ${icaoStr}/${tab} — rate limited, skipping`);
        setPlacesErrorTabs(prev => new Set(prev).add(tab));
        fetchedTabs.current.delete(tab); // allow retry next session
        setPlacesLoading(false);
        return;
      }

      // Live fetch — single tab only
      if (__DEV__) console.log(`[Places:lazy] ${icaoStr}/${tab} — cache MISS, fetching live`);
      const fresh = await fetchGooglePlacesTab(airportLat, airportLng, tab as any, icaoStr, tab === 'eat' ? airport.name : '', source);

      if (fresh && fresh.length > 0) {
        setPlaces((prev: any) => ({ ...prev, [cat]: fresh }));
        setCachedCategory(icaoStr, cat as any, fresh); // fire and forget
        if (__DEV__) console.log(`[Places:lazy] ${icaoStr}/${tab} — fetched ${fresh.length} results`);
      } else {
        // Genuine empty result — show "No X found" (not "unavailable")
        if (__DEV__) console.log(`[Places:lazy] ${icaoStr}/${tab} — no results`);
      }
    } catch (err) {
      if (__DEV__) console.warn(`[Places:lazy] ${icaoStr}/${tab} — error:`, err);
      setPlacesErrorTabs(prev => new Set(prev).add(tab));
    }
    setPlacesLoading(false);
  }

  // Legacy wrapper for the initial info tab load (Why Fly Here needs restaurant data)
  async function fetchPlaces(lat: number, lng: number) {
    // Only fetch eat tab initially for Why Fly Here bullets
    await fetchPlacesForTab('eat');
  }

  function parseMetar(raw: any) {
    const windDir = raw.wdir === "VRB" ? "Variable" : (typeof raw.wdir === 'number' ? `${raw.wdir}°` : '—');
    const windSpd = raw.wspd ?? '—';
    const windGust = raw.wgst ? ` - ${raw.wgst}` : '';
    const vis = raw.visib ?? '—';
    const tempF = raw.temp != null ? Math.round(raw.temp * 9 / 5 + 32) : null;
    const temp = raw.temp != null ? `${raw.temp}°C (${tempF}°F)` : '—';
    const dewpF = raw.dewp != null ? Math.round(raw.dewp * 9 / 5 + 32) : null;
    const dewpoint = raw.dewp != null ? `${raw.dewp}°C (${dewpF}°F)` : '—';
    const altimeter = raw.altim != null ? `${raw.altim.toFixed(2)} inHg` : '—';
    const clouds = raw.clouds?.length > 0
      ? raw.clouds.map((c: any) => `${c.cover} ${c.base ? c.base.toLocaleString() + ' ft' : ''}`).join(', ')
      : 'Sky clear';
    const visNum = parseFloat(raw.visib) || 10;
    // Ceiling = lowest OVC or BKN layer (base is in feet); FEW/SCT don't count as ceiling
    const ceilingLayer = raw.clouds?.find((c: any) => c.cover === 'OVC' || c.cover === 'BKN');
    const cloudBase = ceilingLayer ? (ceilingLayer.base ?? 0) : 99900;
    // Standard FAA flight categories
    let flightCat = 'VFR';
    if (cloudBase < 500 || visNum < 1) flightCat = 'LIFR';
    else if (cloudBase < 1000 || visNum < 3) flightCat = 'IFR';
    else if (cloudBase <= 3000 || visNum <= 5) flightCat = 'MVFR';
    const metar = raw.rawOb || '—';
    const catColor = flightCat === 'VFR' ? '#22c55e' : flightCat === 'MVFR' ? '#3b82f6' : flightCat === 'IFR' ? '#ef4444' : '#a855f7';
    // Observation time: parse DDHHMMz token from raw METAR, convert to local time
    let obsTime = '—';
    const timeMatch = metar.match(/\b\d{2}(\d{2})(\d{2})Z\b/);
    if (timeMatch) {
      const now = new Date();
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), parseInt(timeMatch[1]), parseInt(timeMatch[2]), 0));
      obsTime = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
    }
    // Humidity via Magnus formula
    let humidity = '—';
    if (raw.temp != null && raw.dewp != null) {
      const rh = 100 * Math.exp((17.625 * raw.dewp) / (243.04 + raw.dewp)) / Math.exp((17.625 * raw.temp) / (243.04 + raw.temp));
      humidity = `${Math.round(rh)}%`;
    }
    // Density altitude: pressure altitude + ISA deviation correction
    let densityAlt = '—';
    if (raw.temp != null && raw.altim != null) {
      const elev = raw.elev ?? 0;
      const pa = (29.92 - raw.altim) * 1000 + elev;
      const isaTempC = 15 - 1.98 * (pa / 1000);
      const da = Math.round(pa + 118.8 * (raw.temp - isaTempC));
      densityAlt = `${da.toLocaleString()}'`;
    }
    if (__DEV__) {
      if (__DEV__) console.log('[weather] raw METAR:', metar);
      if (__DEV__) console.log('[weather] parsed wind:', { wdir: raw.wdir, wspd: raw.wspd, wgst: raw.wgst });
      if (__DEV__) console.log('[weather] parsed visibility:', raw.visib, 'SM →', visNum);
      if (__DEV__) console.log('[weather] parsed cloud groups:', raw.clouds);
      if (__DEV__) console.log('[weather] ceiling layer:', ceilingLayer, '→', cloudBase, 'ft');
      if (__DEV__) console.log('[weather] derived flight category:', flightCat);
    }
    return { windDir, windSpd, windGust, vis, temp, dewpoint, altimeter, clouds, flightCat, catColor, metar, obsTime, humidity, densityAlt };
  }

  function flightConditionLabel(cat: string) {
    if (cat === 'VFR')  return '✅  VFR — Good flying weather';
    if (cat === 'MVFR') return '🔵  MVFR — Marginal conditions';
    if (cat === 'IFR')  return '🔴  IFR — Instrument conditions';
    if (cat === 'LIFR') return '🟣  LIFR — Very low ceilings';
    return cat;
  }

  // Returns the preferred runway end with headwind/crosswind components.
  // windDirStr is like "160°" or "Variable"; windSpd is a number or '—'.
  function getWindComponents(rwyId: string, windDirStr: any, windSpd: any) {
    const wdir = parseInt(String(windDirStr)); // strips "°"
    const wspd = typeof windSpd === 'number' ? windSpd : parseInt(windSpd);
    if (isNaN(wdir) || isNaN(wspd) || wspd <= 0) return null;
    // Parse both ends of the runway (e.g. "14/32", "08L/26R")
    const parts = (rwyId || '').split('/');
    if (parts.length < 2) return null;
    const ends = parts
      .map(p => ({ label: p, hdg: parseInt(p.replace(/[LRClrc]/g, '')) * 10 }))
      .filter(e => !isNaN(e.hdg) && e.hdg >= 0 && e.hdg <= 360);
    if (ends.length < 2) return null;
    // Calculate headwind (+) / tailwind (–) and crosswind for each end
    const results = ends.map(e => {
      const angle = ((wdir - e.hdg) + 360) % 360;
      const rad = angle * Math.PI / 180;
      const hdwnd = Math.round(wspd * Math.cos(rad));
      const xwnd  = Math.abs(Math.round(wspd * Math.sin(rad)));
      return { label: e.label, hdwnd, xwnd };
    });
    // Prefer the end with the most headwind (least tailwind)
    results.sort((a, b) => b.hdwnd - a.hdwnd);
    return results[0];
  }

  function openMap() {
    if (!airportLat || !airportLng) return;
    Linking.openURL(`maps://?ll=${airportLat},${airportLng}&q=${encodeURIComponent(String(airport.name))}`);
  }

  function openDirections() {
    if (!airportLat || !airportLng) return;
    Linking.openURL(`maps://?daddr=${airportLat},${airportLng}`);
  }

  const tabs = ['info', 'do', 'eat', 'stay', 'golf'];
  const tabLabels: Record<string, string> = { info: 'Info', do: 'Do', eat: 'Eat', stay: 'Stay', golf: 'Golf' };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>

      {/* Hero */}
      <View style={styles.hero}>
        {heroPhoto
          ? <Image
              source={{ uri: heroPhoto }}
              style={styles.heroImage}
              resizeMode="cover"
              onError={() => {
                if (__DEV__) console.warn('[AirportHero] image failed to load for', icao, '— showing fallback');
                setHeroPhoto(null);
              }}
            />
          : <View style={[styles.heroImage, styles.heroImageFallback]}>
              <Text style={styles.heroFallbackIcao}>{airport.icao}</Text>
            </View>
        }
        {/* Top scrim — darkens status bar area */}
        <LinearGradient
          colors={['rgba(3,7,16,0.96)', 'rgba(3,7,16,0.62)', 'rgba(3,7,16,0.0)']}
          locations={[0, 0.28, 0.54]}
          style={styles.heroScrimTop}
        />
        {/* Bottom scrim — anchors text block with strong cinematic base */}
        <LinearGradient
          colors={['rgba(3,7,16,0)', 'rgba(3,7,16,0.52)', 'rgba(3,7,16,0.88)', 'rgba(3,7,16,0.98)']}
          locations={[0, 0.38, 0.72, 1]}
          style={styles.heroScrimBottom}
        />
        {/* Left/right vignette — draws eye to center */}
        <LinearGradient
          colors={['rgba(3,7,16,0.38)', 'rgba(3,7,16,0)', 'rgba(3,7,16,0)', 'rgba(3,7,16,0.38)']}
          locations={[0, 0.22, 0.78, 1]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={styles.heroScrimBottom}
        />
        {/* Cool blue top atmosphere — cinematic depth, brand-consistent */}
        <LinearGradient
          colors={['rgba(0,140,255,0.04)', 'rgba(0,140,255,0)']}
          locations={[0, 0.42]}
          style={styles.heroScrimTop}
        />
        <View style={styles.heroOverlay}>
          <View style={styles.heroTopRow}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
              <Text style={styles.backText}>← Back</Text>
            </TouchableOpacity>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {pilotFlownCount != null && pilotFlownCount > 0 && (
                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={() => {
                    const expanding = !flownBadgeExpanded;
                    setFlownBadgeExpanded(expanding);
                    Animated.spring(flownBadgeAnim, {
                      toValue: expanding ? 1 : 0,
                      tension: 200, friction: 20, useNativeDriver: false,
                    }).start();
                    if (expanding) setTimeout(() => {
                      setFlownBadgeExpanded(false);
                      Animated.spring(flownBadgeAnim, { toValue: 0, tension: 200, friction: 20, useNativeDriver: false }).start();
                    }, 3000);
                  }}
                >
                  <Animated.View style={[styles.flownCountBadge, {
                    paddingHorizontal: flownBadgeAnim.interpolate({ inputRange: [0, 1], outputRange: [10, 14] }),
                  }]}>
                    <Feather name="users" size={11} color="#C8D8EE" />
                    <Text style={styles.flownCountBadgeText}>{pilotFlownCount}</Text>
                    <Animated.View style={{
                      overflow: 'hidden',
                      maxWidth: flownBadgeAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 150] }),
                      opacity: flownBadgeAnim,
                    }}>
                      <Text style={styles.flownCountBadgeLabel} numberOfLines={1}>
                        pilot{pilotFlownCount !== 1 ? 's' : ''} flew here
                      </Text>
                    </Animated.View>
                  </Animated.View>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={styles.heroShareBtn}
                activeOpacity={0.7}
                onPress={() => {
                  Share.share({
                    message: `Check out ${airport.name} (${airport.icao}) on Left Seat!\n${airport.city}\nDownload Left Seat on the App Store to explore airports near you.`,
                  });
                }}
              >
                <Feather name="share" size={14} color="#F0F4FF" />
              </TouchableOpacity>
            </View>
          </View>
          <Text style={styles.icao}>{airport.icao}</Text>
          <Text style={styles.airportName}>{airport.name}</Text>
          <Text style={styles.city}>{airport.city}</Text>
          {distFromHome && homeIcao && (
            <View style={styles.distPill}>
              <Text style={styles.distLine}>
                {distFromHome.nm.toLocaleString()} nm · {distFromHome.time} from {homeIcao}
              </Text>
            </View>
          )}
          <View style={styles.heroMeta}>
            <View style={[styles.metaPill, { flexDirection: 'row', alignItems: 'center', gap: 5 }]}>
              <MaterialCommunityIcons name="gas-station" size={13} color={fuelDisplay.available ? '#38BDF8' : '#EF4444'} />
              <Text style={[styles.metaText, !fuelDisplay.available && { color: '#EF4444' }]}>{fuelDisplay.label}</Text>
            </View>
            <View style={styles.metaPill}><Text style={styles.metaText}>📏 {airport.elevation}</Text></View>
          </View>
          {!isHomeAirport && (
            <TouchableOpacity
              style={styles.planRouteBtn}
              activeOpacity={0.8}
              onPress={() => {
                const routeParams: Record<string, string> = { to: airport.icao };
                if (homeIcao) routeParams.from = homeIcao;
                router.push({ pathname: '/route', params: routeParams });
              }}
            >
              <MaterialCommunityIcons name="airplane-takeoff" size={14} color="#0D1421" />
              <Text style={styles.planRouteTxt}>Plan Route</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Tab bar */}
      <View style={styles.tabBar}>
        {tabs.map(tab => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, activeTab === tab && styles.tabActive]}
            onPress={() => setActiveTab(tab)}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>{tabLabels[tab]}</Text>
              {tab === 'do' && nearbyEvents.length > 0 && (
                <View style={styles.tabEventBadge}>
                  <Text style={styles.tabEventBadgeText}>{nearbyEvents.length}</Text>
                </View>
              )}
            </View>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView ref={scrollRef} style={styles.content} showsVerticalScrollIndicator={false} keyboardDismissMode="on-drag">
        {activeTab === 'info' && (
          <View>

            {/* ═══════ TIER 1: DESTINATION / DECISION ═══════ */}

            {/* ── SECTION 1: Why Fly Here ──────────────────────── */}
            <Text style={[styles.sectionTitle, styles.sectionTitleWhy]}>✦  Why Fly Here</Text>
            <View style={styles.whyCard}>
              {description ? (
                <Text style={styles.whyDescription}>{description as string}</Text>
              ) : null}
              {whyItems.map((item, i) => (
                <View key={i} style={[styles.whyRow, i === whyItems.length - 1 && { marginBottom: 0 }]}>
                  <View style={[styles.whyAccentLine, item.priority === 1 && styles.whyAccentStrong]} />
                  <View style={styles.whyRowInner}>
                    <View style={styles.whyCategoryRow}>
                      <MaterialCommunityIcons name={item.icon as any} size={14} color={item.priority === 1 ? '#38BDF8' : '#5A7A98'} />
                      <Text style={[styles.whyCategoryLabel, item.priority === 1 && styles.whyCategoryLabelStrong]}>
                        {item.category.toUpperCase()}
                      </Text>
                    </View>
                    <Text style={[styles.whyText, item.priority >= 3 && styles.whyTextMuted]}>{item.text}</Text>
                  </View>
                </View>
              ))}
            </View>

            {/* ── SECTION 2: Quick Intel ───────────────────────── */}
            <View style={styles.quickIntelSection}>
              <View style={styles.quickIntelGrid}>
                {/* Courtesy Car */}
                {(() => {
                  const hasPilotData = airportInsights && airportInsights.carVoteCount > 0;
                  let carLabel = 'Unknown';
                  let carColor = '#6B83A0';
                  if (hasPilotData) {
                    const cc = airportInsights!.courtesyCar;
                    carLabel = cc === 'yes' ? 'Available' : cc === 'mixed' ? 'Mixed' : 'No';
                    carColor = cc === 'yes' ? '#22C55E' : cc === 'mixed' ? '#F59E0B' : '#EF4444';
                  } else if (crewCar) {
                    carLabel = deriveStatus(crewCar);
                    carColor = statusColor(carLabel);
                  }
                  return (
                    <TouchableOpacity style={styles.quickIntelItem} activeOpacity={0.7}
                      onPress={() => { setCrewCarFormView(false); setCrewCarModal(true); }}>
                      <MaterialCommunityIcons name="car" size={16} color={carColor} />
                      <Text style={styles.quickIntelLabel}>Crew Car</Text>
                      <Text style={[styles.quickIntelValue, { color: carColor }]}>{carLabel}</Text>
                    </TouchableOpacity>
                  );
                })()}

                {/* Fuel — uses canonical fuelDisplay model */}
                {fuelDisplay.label !== 'No Fuel Data' && (() => {
                  return (
                    <View style={styles.quickIntelItem}>
                      <MaterialCommunityIcons name={fuelDisplay.available ? 'gas-station' : 'gas-station-off-outline'} size={16} color={fuelDisplay.color} />
                      <Text style={styles.quickIntelLabel}>Fuel</Text>
                      <Text style={[styles.quickIntelValue, { color: fuelDisplay.color }]}>{fuelDisplay.label}</Text>
                    </View>
                  );
                })()}

                {/* FBO Rating (from pilot reports) */}
                {airportInsights?.avgFboRating != null && (
                  <View style={styles.quickIntelItem}>
                    <MaterialCommunityIcons name="star" size={16} color="#FBBF24" />
                    <Text style={styles.quickIntelLabel}>FBO</Text>
                    <Text style={styles.quickIntelValue}>{airportInsights.avgFboRating}/5</Text>
                  </View>
                )}

                {/* Dog Friendly */}
                {dogFriendly && (
                  <View style={styles.quickIntelItem}>
                    <MaterialCommunityIcons name="dog-side" size={16} color="#0D9488" />
                    <Text style={styles.quickIntelLabel}>Dogs</Text>
                    <Text style={[styles.quickIntelValue, { color: '#0D9488' }]}>Friendly</Text>
                  </View>
                )}
              </View>

              {/* Dog notes expanded inline if present */}
              {dogFriendly?.dog_notes && (
                <View style={styles.quickIntelDogNote}>
                  <Text style={styles.quickIntelDogNoteText}>{dogFriendly.dog_notes}</Text>
                  {dogFriendly.dog_features.length > 0 && (
                    <View style={styles.dogTagsRow}>
                      {dogFriendly.dog_features.slice(0, 4).map(tag => (
                        <View key={tag} style={styles.dogTag}><Text style={styles.dogTagText}>{tag}</Text></View>
                      ))}
                    </View>
                  )}
                </View>
              )}
            </View>

            {/* Quick Action Buttons */}
            <View style={styles.actionRow}>
              <TouchableOpacity style={styles.actionBtn} activeOpacity={0.65} onPress={openMap}>
                <Feather name="map" size={22} color="#F0F4FF" />
                <Text style={styles.actionBtnText} numberOfLines={1}>View on Map</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionBtn} activeOpacity={0.65} onPress={openDirections}>
                <Feather name="map-pin" size={22} color="#F0F4FF" />
                <Text style={styles.actionBtnText} numberOfLines={1}>Directions</Text>
              </TouchableOpacity>
            </View>

            {/* ── Flight Logged Success Panel ──────────────── */}
            {inLogBook && loggedStats && (
              <View style={styles.flightSuccessPanel}>
                <View style={styles.flightSuccessHeader}>
                  <Feather name="check-circle" size={15} color="#34C77B" />
                  <Text style={styles.flightSuccessTitle}>Flight Logged!</Text>
                  <Text style={styles.flightSuccessIcao}>{(icao as string).toUpperCase()}</Text>
                </View>
                <View style={styles.flightSuccessStats}>
                  <View style={styles.flightSuccessStat}>
                    <Text style={styles.flightSuccessStatValue}>{loggedStats.airports}</Text>
                    <Text style={styles.flightSuccessStatLabel}>Airports</Text>
                  </View>
                  <View style={styles.flightSuccessStatDivider} />
                  <View style={styles.flightSuccessStat}>
                    <Text style={styles.flightSuccessStatValue}>{loggedStats.states}</Text>
                    <Text style={styles.flightSuccessStatLabel}>States</Text>
                  </View>
                  <View style={styles.flightSuccessStatDivider} />
                  <View style={styles.flightSuccessStat}>
                    <Text style={styles.flightSuccessStatValue}>
                      {loggedStats.longestNm > 0 ? `${loggedStats.longestNm}` : '—'}
                    </Text>
                    <Text style={styles.flightSuccessStatLabel}>Longest nm</Text>
                  </View>
                </View>
                {loggedStats.achievements.length > 0 && (
                  <View style={styles.flightSuccessAchievements}>
                    <Text style={styles.flightSuccessAchievementsLabel}>MILESTONE UNLOCKED</Text>
                    {loggedStats.achievements.map((a, i) => (
                      <Text key={i} style={styles.flightSuccessAchievementItem}>{a}</Text>
                    ))}
                  </View>
                )}
              </View>
            )}

            {/* ── Pilot Reports ────────────────────────────────── */}
            {airportInsights && (
              <View style={styles.insightsSection}>
                <Text style={styles.sectionTitle}>◈  Pilot Reports</Text>

                {airportInsights.reviewCount === 0 ? (
                  <View style={styles.insightEmpty}>
                    <MaterialCommunityIcons name="clipboard-text-outline" size={28} color="#2A3A52" />
                    <Text style={styles.insightEmptyText}>No pilot reports yet. Be the first to share what it's like flying here.</Text>
                  </View>
                ) : (
                  <>
                    {/* Community snapshot */}
                    <View style={styles.insightsCountRow}>
                      <Text style={styles.insightsCount}>{airportInsights.reviewCount} pilot{airportInsights.reviewCount !== 1 ? 's' : ''} reported</Text>
                      {airportInsights.lastReportedAt && (
                        <Text style={styles.insightsLastReported}>Last {formatRelativeDate(airportInsights.lastReportedAt)}</Text>
                      )}
                    </View>
                    <View style={styles.insightsGrid}>
                      {airportInsights.avgFboRating != null && (
                        <View style={styles.insightCard}>
                          <MaterialCommunityIcons name="star" size={16} color="#FBBF24" />
                          <Text style={styles.insightValue}>{airportInsights.avgFboRating}</Text>
                          <Text style={styles.insightLabel}>FBO Rating</Text>
                          <Text style={styles.insightMeta}>{airportInsights.ratingCount} report{airportInsights.ratingCount !== 1 ? 's' : ''}</Text>
                        </View>
                      )}
                      {(Object.keys(airportInsights.latestFuelPrices).length > 0 || airportInsights.latestFuelPrice != null) && (
                        <View style={styles.insightCard}>
                          <MaterialCommunityIcons name="gas-station" size={16} color="#F97316" />
                          {Object.keys(airportInsights.latestFuelPrices).length > 0
                            ? Object.entries(airportInsights.latestFuelPrices).map(([type, price]) => (
                                <Text key={type} style={styles.insightValue}>{type} ${Number(price).toFixed(2)}</Text>
                              ))
                            : <Text style={styles.insightValue}>${airportInsights.latestFuelPrice!.toFixed(2)}</Text>
                          }
                          <Text style={styles.insightLabel}>Fuel / gal</Text>
                          {airportInsights.fuelReportedAt && (
                            <Text style={styles.insightMeta}>{formatRelativeDate(airportInsights.fuelReportedAt)}</Text>
                          )}
                        </View>
                      )}
                      {airportInsights.courtesyCar != null && (
                        <View style={styles.insightCard}>
                          <MaterialCommunityIcons name="car" size={16} color={airportInsights.courtesyCar === 'yes' ? '#34D399' : airportInsights.courtesyCar === 'mixed' ? '#F59E0B' : '#6B83A0'} />
                          <Text style={styles.insightValue}>
                            {airportInsights.courtesyCar === 'yes' ? 'Available' : airportInsights.courtesyCar === 'mixed' ? 'Mixed' : 'No'}
                          </Text>
                          <Text style={styles.insightLabel}>Crew Car</Text>
                          <Text style={styles.insightMeta}>{airportInsights.carVoteCount} report{airportInsights.carVoteCount !== 1 ? 's' : ''}</Text>
                        </View>
                      )}
                    </View>

                    {/* V2 Intel chips — fees, after-hours, transport, fuel service */}
                    {(airportInsights.feeConsensus || airportInsights.afterHoursConsensus || airportInsights.topTransport.length > 0 || airportInsights.fuelServiceConsensus) && (
                      <View style={styles.intelChipsSection}>
                        {airportInsights.feeConsensus && (
                          <View style={styles.intelChip}>
                            <MaterialCommunityIcons name="cash" size={13} color={airportInsights.feeConsensus === 'none' ? '#34D399' : '#F59E0B'} />
                            <Text style={styles.intelChipText}>
                              {airportInsights.feeConsensus === 'none' ? 'No fees' : `Fees: ${airportInsights.feeConsensus.replace(/_/g, ' ')}`}
                            </Text>
                          </View>
                        )}
                        {airportInsights.afterHoursConsensus && (
                          <View style={styles.intelChip}>
                            <MaterialCommunityIcons name="clock-outline" size={13} color={airportInsights.afterHoursConsensus === 'yes' ? '#34D399' : airportInsights.afterHoursConsensus === 'mixed' ? '#F59E0B' : '#6B83A0'} />
                            <Text style={styles.intelChipText}>
                              After hours: {airportInsights.afterHoursConsensus === 'yes' ? 'Yes' : airportInsights.afterHoursConsensus === 'mixed' ? 'Mixed' : 'No'}
                            </Text>
                          </View>
                        )}
                        {airportInsights.fuelServiceConsensus && (
                          <View style={styles.intelChip}>
                            <MaterialCommunityIcons name="gas-station" size={13} color="#F97316" />
                            <Text style={styles.intelChipText}>{airportInsights.fuelServiceConsensus.replace(/_/g, ' ')}</Text>
                          </View>
                        )}
                        {airportInsights.topTransport.map(t => (
                          <View key={t} style={styles.intelChip}>
                            <MaterialCommunityIcons name="road-variant" size={13} color="#6B83A0" />
                            <Text style={styles.intelChipText}>{t.replace(/_/g, ' ')}</Text>
                          </View>
                        ))}
                      </View>
                    )}

                    {/* FBO Intel */}
                    {airportInsights.fboIntel.length > 0 && (
                      <View style={styles.fboIntelSection}>
                        <Text style={styles.insightsNotesTitle}>FBO INTEL</Text>
                        {airportInsights.fboIntel.map(fbo => (
                          <View key={fbo.name} style={styles.fboIntelRow}>
                            <View style={styles.fboIntelLeft}>
                              <Text style={styles.fboIntelName}>{fbo.name}</Text>
                              <Text style={styles.fboIntelMeta}>
                                {fbo.avgRating != null && <Text style={styles.fboIntelStar}>{fbo.avgRating} ★  </Text>}
                                {fbo.count} report{fbo.count !== 1 ? 's' : ''}
                                {'  ·  last '}
                                {formatRelativeDate(fbo.lastReportedAt)}
                              </Text>
                            </View>
                            {fbo.avgRating != null && (
                              <View style={styles.fboIntelRating}>
                                <MaterialCommunityIcons name="star" size={14} color="#FBBF24" />
                                <Text style={styles.fboIntelRatingText}>{fbo.avgRating}</Text>
                              </View>
                            )}
                          </View>
                        ))}
                      </View>
                    )}

                    {/* Report cards — own first, then newest */}
                    <Text style={styles.insightsNotesTitle}>RECENT REPORTS</Text>
                    {airportInsights.reviews.slice(0, showAllReports ? undefined : 3).map(r => {
                      const isOwn = user?.id === r.user_id;
                      const ago = formatRelativeDate(r.created_at);
                      return (
                        <View key={r.id} style={[styles.reportCard, isOwn && styles.reportCardOwn]}>
                          <View style={styles.reportHeader}>
                            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                              <Text style={styles.reportName}>{r.user_name ?? 'Pilot'}</Text>
                              {isOwn && (
                                <View style={styles.reportOwnBadge}>
                                  <Text style={styles.reportOwnBadgeText}>Your Report</Text>
                                </View>
                              )}
                            </View>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                              <Text style={styles.reportDate}>{ago}</Text>
                              {isOwn && (
                                <TouchableOpacity
                                  onPress={() => {
                                    setEditingReview(airportInsights.userReview);
                                    setReviewModalOpen(true);
                                  }}
                                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                  activeOpacity={0.7}
                                >
                                  <Feather name="edit-2" size={13} color="#38BDF8" />
                                </TouchableOpacity>
                              )}
                              {isOwn && (
                                <TouchableOpacity
                                  onPress={() => {
                                    Alert.alert(
                                      'Delete Report',
                                      'Are you sure you want to delete your pilot report for this airport?',
                                      [
                                        { text: 'Cancel', style: 'cancel' },
                                        {
                                          text: 'Delete', style: 'destructive',
                                          onPress: async () => {
                                            const { error } = await supabase.from('airport_reviews').delete().eq('id', r.id);
                                            if (error) {
                                              if (__DEV__) console.warn('[Review] delete error:', error.message);
                                              Alert.alert('Error', 'Could not delete report. Try again.');
                                            } else {
                                              fetchAirportInsights();
                                            }
                                          },
                                        },
                                      ],
                                    );
                                  }}
                                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                  activeOpacity={0.7}
                                >
                                  <Feather name="trash-2" size={13} color="#EF4444" />
                                </TouchableOpacity>
                              )}
                            </View>
                          </View>

                          {r.visit_reason && (
                            <View style={styles.reportReasonChip}>
                              <Text style={styles.reportReasonText}>{r.visit_reason.replace('_', ' ')}</Text>
                            </View>
                          )}

                          <View style={styles.reportIntelRow}>
                            {r.courtesy_car && r.courtesy_car !== 'unknown' && (
                              <View style={styles.reportIntelItem}>
                                <MaterialCommunityIcons name="car" size={13} color={r.courtesy_car === 'yes' ? '#34D399' : '#6B83A0'} />
                                <Text style={styles.reportIntelText}>{r.courtesy_car === 'yes' ? 'Crew car' : 'No crew car'}</Text>
                              </View>
                            )}
                            {r.fuel_available != null && (() => {
                              const fp = r.fuel_prices as Record<string, number> | null;
                              const hasPrices = fp && Object.keys(fp).length > 0;
                              return (
                                <View style={styles.reportIntelItem}>
                                  <MaterialCommunityIcons name="gas-station" size={13} color={r.fuel_available ? '#F97316' : '#6B83A0'} />
                                  <Text style={styles.reportIntelText}>
                                    {r.fuel_available
                                      ? hasPrices
                                        ? Object.entries(fp!).map(([t, p]) => `${t} $${Number(p).toFixed(2)}`).join(' · ')
                                        : r.fuel_price ? `$${r.fuel_price}/gal` : 'Fuel'
                                      : 'No fuel'}
                                  </Text>
                                </View>
                              );
                            })()}
                            {r.fbo_name && (
                              <View style={styles.reportIntelItem}>
                                <MaterialCommunityIcons name="office-building" size={13} color="#6B83A0" />
                                <Text style={styles.reportIntelText}>{r.fbo_name}</Text>
                              </View>
                            )}
                            {r.fbo_rating != null && (
                              <View style={styles.reportIntelItem}>
                                <MaterialCommunityIcons name="star" size={13} color="#FBBF24" />
                                <Text style={styles.reportIntelText}>{r.fbo_rating}/5</Text>
                              </View>
                            )}
                            {r.fee_status && r.fee_status !== 'not_sure' && (
                              <View style={styles.reportIntelItem}>
                                <MaterialCommunityIcons name="cash" size={13} color={r.fee_status === 'none' ? '#34D399' : '#F59E0B'} />
                                <Text style={styles.reportIntelText}>{r.fee_status === 'none' ? 'No fees' : r.fee_status.replace(/_/g, ' ')}</Text>
                              </View>
                            )}
                            {r.after_hours_access && r.after_hours_access !== 'not_sure' && (
                              <View style={styles.reportIntelItem}>
                                <MaterialCommunityIcons name="clock-outline" size={13} color={r.after_hours_access === 'yes' ? '#34D399' : '#6B83A0'} />
                                <Text style={styles.reportIntelText}>After hrs: {r.after_hours_access === 'yes' ? 'Yes' : 'No'}</Text>
                              </View>
                            )}
                          </View>

                          {r.notes?.trim() && (
                            <Text style={styles.reportNotes}>{r.notes}</Text>
                          )}
                        </View>
                      );
                    })}
                    {!showAllReports && airportInsights.reviews.length > 3 && (
                      <TouchableOpacity style={styles.viewAllReportsBtn} onPress={() => setShowAllReports(true)} activeOpacity={0.7}>
                        <Text style={styles.viewAllReportsText}>View all {airportInsights.reviews.length} reports</Text>
                        <Feather name="chevron-down" size={14} color="#38BDF8" />
                      </TouchableOpacity>
                    )}
                  </>
                )}

                {/* CTA */}
                {user?.id ? (
                  <TouchableOpacity
                    style={styles.reportCta}
                    onPress={() => {
                      if (airportInsights.userReview) {
                        setEditingReview(airportInsights.userReview);
                      } else {
                        setEditingReview(null);
                      }
                      setReviewModalOpen(true);
                    }}
                    activeOpacity={0.7}
                  >
                    <MaterialCommunityIcons name="clipboard-edit-outline" size={16} color={SKY} />
                    <Text style={styles.reportCtaText}>
                      {airportInsights.userReview ? 'Update My Report' : 'Add Pilot Report'}
                    </Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={styles.reportCta}
                    onPress={() => setSignInPrompt(true)}
                    activeOpacity={0.7}
                  >
                    <Feather name="log-in" size={15} color={SKY} />
                    <Text style={styles.reportCtaText}>Sign in to add a pilot report</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {/* ═══════ TIER 2: OPERATIONAL ═══════ */}

            {/* ── Weather (collapsible) ──────────────────────── */}
            <TouchableOpacity style={styles.collapsibleHeader} onPress={() => setWeatherExpanded(!weatherExpanded)} activeOpacity={0.7}>
              <Text style={styles.sectionTitle}>◈  Weather</Text>
              {weather && !weatherLoading && (
                <View style={[styles.collapsibleSummary]}>
                  <View style={[styles.catBadgeInline, { backgroundColor: weather.catColor + '22', borderColor: weather.catColor + '55' }]}>
                    <Text style={[styles.catBadgeText, { color: weather.catColor }]}>{weather.flightCat}</Text>
                  </View>
                  <Text style={styles.collapsibleHint}>
                    {weather.vis} sm · {weather.windDir}@{weather.windSpd}{weather.windGust} kts
                  </Text>
                </View>
              )}
              <Feather name={weatherExpanded ? 'chevron-up' : 'chevron-down'} size={16} color="#4A5B73" />
            </TouchableOpacity>
            {weatherLoading && (
              <View style={styles.loadingBox}>
                <ActivityIndicator color="#38BDF8" />
                <Text style={styles.loadingText}>Fetching live weather...</Text>
              </View>
            )}
            {weatherError && !weatherLoading && (
              <View style={styles.errorBox}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Feather name="alert-triangle" size={13} color="#F59E0B" />
                  <Text style={styles.errorText}>Could not load weather</Text>
                </View>
                <TouchableOpacity onPress={fetchWeather} style={styles.retryBtn}><Text style={styles.retryText}>Retry</Text></TouchableOpacity>
              </View>
            )}
            {weatherExpanded && weather && !weatherLoading && (
              <View style={styles.weatherCard}>
                <WeatherWidget weather={weather} />
                <View style={[styles.flightCatBanner, { borderColor: weather.catColor }]}>
                  <Text style={[styles.flightCatText, { color: weather.catColor }]}>{flightConditionLabel(weather.flightCat)}</Text>
                </View>
                {weatherSource && (
                  <Text style={styles.weatherDisclaimer}>Weather from {weatherSource.icao} ({weatherSource.nm} nm away)</Text>
                )}
                <View style={styles.weatherRow}><Text style={styles.weatherLabel}>Time</Text><Text style={styles.weatherValue}>{weather.obsTime}</Text></View>
                <View style={styles.weatherRow}><Text style={styles.weatherLabel}>Wind</Text><Text style={styles.weatherValue}>{weather.windDir} at {weather.windSpd}{weather.windGust} kts</Text></View>
                <View style={styles.weatherRow}><Text style={styles.weatherLabel}>Visibility</Text><Text style={styles.weatherValue}>{weather.vis} sm</Text></View>
                <View style={styles.weatherRow}><Text style={styles.weatherLabel}>Clouds</Text><Text style={styles.weatherValue}>{weather.clouds}</Text></View>
                <View style={styles.weatherRow}><Text style={styles.weatherLabel}>Temperature</Text><Text style={styles.weatherValue}>{weather.temp}</Text></View>
                <View style={styles.weatherRow}><Text style={styles.weatherLabel}>Dewpoint</Text><Text style={styles.weatherValue}>{weather.dewpoint}</Text></View>
                <View style={styles.weatherRow}><Text style={styles.weatherLabel}>Altimeter</Text><Text style={styles.weatherValue}>{weather.altimeter}</Text></View>
                <View style={styles.weatherRow}><Text style={styles.weatherLabel}>Humidity</Text><Text style={styles.weatherValue}>{weather.humidity}</Text></View>
                <View style={styles.weatherRow}><Text style={styles.weatherLabel}>Density Altitude</Text><Text style={styles.weatherValue}>{weather.densityAlt}</Text></View>
                <View style={[styles.metarBox, { marginBottom: 0, marginTop: 8 }]}>
                  <Text style={styles.metarLabel}>RAW METAR</Text>
                  <Text style={styles.metarText}>{weather.metar}</Text>
                </View>
              </View>
            )}

            {/* ── Runways (collapsible) ─────────────────────── */}
            <TouchableOpacity style={styles.collapsibleHeader} onPress={() => setRunwaysExpanded(!runwaysExpanded)} activeOpacity={0.7}>
              <Text style={styles.sectionTitle}>▸  Runways</Text>
              {!runwaysExpanded && runways.length > 0 && (() => {
                // Show best runway summary when collapsed
                const best = weather ? runways.reduce((best: any, rwy: any) => {
                  const wc = getWindComponents(rwy.id, weather.windDir, weather.windSpd);
                  if (!wc) return best;
                  if (!best || wc.hdwnd > best.hdwnd) return { ...wc, length: rwy.length };
                  return best;
                }, null) : null;
                return best ? (
                  <Text style={styles.collapsibleHint}>
                    Best: {best.label} · {best.hdwnd >= 0 ? `${best.hdwnd} kt hdwnd` : `${Math.abs(best.hdwnd)} kt tail`}
                    {best.xwnd > 0 ? ` · ${best.xwnd} kt xwnd` : ''}
                  </Text>
                ) : (
                  <Text style={styles.collapsibleHint}>{runways.length} runway{runways.length !== 1 ? 's' : ''}</Text>
                );
              })()}
              <Feather name={runwaysExpanded ? 'chevron-up' : 'chevron-down'} size={16} color="#4A5B73" />
            </TouchableOpacity>
            {runwaysExpanded && (runways.length > 0 ? (
              <View style={styles.runwayGrid}>
                {runways.map((rwy: any, i: number) => (
                  <View key={i} style={styles.runwayCard}>
                    <MaterialCommunityIcons name="airplane-landing" size={20} color="#38BDF8" />
                    <View style={styles.runwayInfo}>
                      <Text style={styles.runwayId}>{rwy.id}</Text>
                      <Text style={styles.runwayMeta}>
                        {rwy.length ? `${Number(rwy.length).toLocaleString()} ft` : '—'}
                        {rwy.surface ? ` • ${rwy.surface}` : ''}
                      </Text>
                      {(() => {
                        const wc = weather ? getWindComponents(rwy.id, weather.windDir, weather.windSpd) : null;
                        if (!wc) return null;
                        const hdLabel = wc.hdwnd >= 0 ? `${wc.hdwnd} kt headwind` : `${Math.abs(wc.hdwnd)} kt tailwind`;
                        const xLabel = wc.xwnd > 0 ? `  •  ${wc.xwnd} kt crosswind` : '';
                        return <Text style={styles.runwayWind}>Rwy {wc.label}  •  {hdLabel}{xLabel}</Text>;
                      })()}
                    </View>
                  </View>
                ))}
              </View>
            ) : (
              <View style={styles.emptyCard}><Text style={styles.emptyText}>Runway data unavailable</Text></View>
            ))}

            {/* ═══════ TIER 3: REFERENCE ═══════ */}

            {/* ── Airport Contact (compact) ────────────────────── */}
            <Text style={styles.sectionTitleMuted}>◎  Reference</Text>
            <View style={styles.refCard}>
              <View style={styles.contactChips}>
                <View style={styles.contactChip}>
                  <Text style={styles.contactChipLabel}>TYPE</Text>
                  <Text style={styles.contactChipValue}>{fullAirport?.has_tower?.startsWith('ATCT') ? 'Towered' : 'Non-Towered'}</Text>
                </View>
                {fuelDisplay.label !== 'No Fuel Data' && (
                  <View style={styles.contactChip}>
                    <Text style={styles.contactChipLabel}>FUEL</Text>
                    <Text style={[styles.contactChipValue, !fuelDisplay.available && { color: '#EF4444' }]}>{fuelDisplay.label}</Text>
                  </View>
                )}
              </View>
              {(airportInfo?.ctaf || airportInfo?.tower || airportInfo?.atis || airportInfo?.phone) ? (
                <View style={styles.contactFreqs}>
                  {airportInfo.ctaf && (
                    <View style={styles.freqRow}>
                      <Text style={styles.freqLabel}>{fullAirport?.has_tower?.startsWith('ATCT') ? 'TOWER' : 'CTAF'}</Text>
                      <Text style={styles.freqValue}>{airportInfo.ctaf}</Text>
                    </View>
                  )}
                  {airportInfo.tower && airportInfo.tower !== airportInfo.ctaf && (
                    <View style={styles.freqRow}>
                      <Text style={styles.freqLabel}>TOWER</Text>
                      <Text style={styles.freqValue}>{airportInfo.tower}</Text>
                    </View>
                  )}
                  {airportInfo.atis && (
                    <View style={styles.freqRow}>
                      <Text style={styles.freqLabel}>ATIS</Text>
                      <Text style={styles.freqValue}>{airportInfo.atis}</Text>
                    </View>
                  )}
                  {airportInfo.phone && (
                    <TouchableOpacity style={styles.freqRow} onPress={() => Linking.openURL(`tel:${airportInfo!.phone}`).catch(() => {})}>
                      <Text style={styles.freqLabel}>PHONE</Text>
                      <Text style={[styles.freqValue, { color: '#38BDF8' }]}>{airportInfo.phone}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ) : (
                <Text style={styles.fboDetail}>Check ForeFlight or AOPA for FBO contact and frequencies</Text>
              )}
            </View>

          </View>
        )}

        {activeTab === 'eat' && (
          <>
            <PlacesTabHeader icao={airport.icao} name={airport.name} label="Local Food Nearby" onAdd={() => openReportModal('eat')} />
            {isHomeAirport ? <EmptyPlaces label="local spots" unavailable={false} homeAirport /> : placesLoading ? <LoadingPlaces /> : (() => { const r = places.restaurants.filter((r: any) => r.photoRef && (!r.distanceMiles || r.distanceMiles <= 12)); return r.length > 0 ? r.map((r: any, i: number) => <PlaceCard key={i} place={r} priority={i < 3} tab="eat" />) : <EmptyPlaces label="local spots" unavailable={placesErrorTabs.has(activeTab)} />; })()}
          </>
        )}
        {activeTab === 'stay' && (
          <>
            <PlacesTabHeader icao={airport.icao} name={airport.name} label="Hotels & Lodging Nearby" onAdd={() => openReportModal('stay')} />
            {isHomeAirport ? <EmptyPlaces label="hotels" unavailable={false} homeAirport /> : placesLoading ? <LoadingPlaces /> : (() => { const r = places.hotels.filter((r: any) => r.photoRef && (!r.distanceMiles || r.distanceMiles <= 12)); return r.length > 0 ? r.map((r: any, i: number) => <PlaceCard key={i} place={r} priority={i < 3} tab="stay" />) : <EmptyPlaces label="hotels" unavailable={placesErrorTabs.has(activeTab)} />; })()}
          </>
        )}
        {activeTab === 'golf' && (
          <>
            <PlacesTabHeader icao={airport.icao} name={airport.name} label="Golf Courses Nearby" onAdd={() => openReportModal('golf')} />
            {isHomeAirport ? <EmptyPlaces label="golf courses" unavailable={false} homeAirport /> : placesLoading ? <LoadingPlaces /> : (() => { const r = places.golf.filter((r: any) => r.photoRef && (!r.distanceMiles || r.distanceMiles <= 20)); return r.length > 0 ? r.map((r: any, i: number) => <PlaceCard key={i} place={r} priority={i < 3} tab="golf" />) : <EmptyPlaces label="golf courses" unavailable={placesErrorTabs.has(activeTab)} />; })()}
          </>
        )}
        {activeTab === 'do' && (
          <>
            {/* ── Upcoming Events at this Airport ──────────────── */}
            {nearbyEvents.length > 0 && (
              <View style={{ paddingTop: 4, paddingBottom: 4 }}>
                <View style={styles.doEventsHeader}>
                  <View style={styles.doEventsAccent} />
                  <Text style={styles.doEventsTitle}>UPCOMING EVENTS</Text>
                  <View style={styles.doEventsBadge}>
                    <Text style={styles.doEventsBadgeText}>{nearbyEvents.length}</Text>
                  </View>
                </View>
                {nearbyEvents.map((event: any) => {
                  const today = new Date(); today.setHours(0,0,0,0);
                  const evDate = new Date(event.start_date + 'T12:00:00');
                  const diff = Math.ceil((evDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
                  const countdown = diff < 0 ? null : diff === 0 ? 'Today!' : diff === 1 ? 'Tomorrow' : `In ${diff} days`;
                  const isToday = diff === 0;
                  const dateStr = evDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                  const endStr = event.end_date && event.end_date !== event.start_date
                    ? ` – ${new Date(event.end_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                    : '';
                  const isAviation = ['Fly-In','Airshow','Pancake Breakfast','Poker Run','EAA Event','AOPA Event','Other'].includes(event.category);
                  const accent = event.category === 'Airshow' ? '#38BDF8' : isAviation ? '#FF4D00' : event.category === 'Food Festival' ? '#F59E0B' : '#9B77F5';
                  const catIcon = event.category === 'Pancake Breakfast' || event.category === 'Food Festival'
                    ? 'silverware-fork-knife'
                    : event.category === 'Festival'
                    ? 'music'
                    : 'airplane';
                  return (
                    <TouchableOpacity
                      key={event.id}
                      style={styles.doEventCard}
                      onPress={() => setFlyTripEvent(event)}
                      activeOpacity={0.78}
                    >
                      {/* Category icon thumbnail — same footprint as PlaceCard thumb */}
                      <View style={[styles.doEventThumb, { backgroundColor: accent + '22', borderColor: accent + '30' }]}>
                        <MaterialCommunityIcons name={catIcon as any} size={22} color={accent} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                          <Text style={[styles.doEventBadgeTxt, { color: accent }]}>{event.category.toUpperCase()}</Text>
                          {countdown && (
                            <View style={[styles.doEventCountdown, isToday && { borderColor: '#22C55E', backgroundColor: '#0A1F0A' }]}>
                              <Text style={[styles.doEventCountdownTxt, isToday && { color: '#22C55E' }]}>{countdown}</Text>
                            </View>
                          )}
                        </View>
                        <Text style={styles.doEventName} numberOfLines={2}>{event.event_name}</Text>
                        <Text style={styles.doEventDate}>{dateStr}{endStr}</Text>
                      </View>
                      <Feather name="chevron-right" size={14} color="rgba(255,255,255,0.25)" style={{ marginLeft: 8 }} />
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            {/* ── Things To Do ─────────────────────────────────── */}
            <PlacesTabHeader icao={airport.icao} name={airport.name} label="Things To Do Nearby" onAdd={() => openReportModal('do')} />
            {isHomeAirport ? <EmptyPlaces label="attractions" unavailable={false} homeAirport /> : placesLoading ? <LoadingPlaces /> : (() => { const r = places.things.filter((r: any) => r.photoRef && (!r.distanceMiles || r.distanceMiles <= 12)); return r.length > 0 ? r.map((r: any, i: number) => <PlaceCard key={i} place={r} priority={i < 3} tab="do" />) : <EmptyPlaces label="attractions" unavailable={placesErrorTabs.has(activeTab)} />; })()}
          </>
        )}

        <View style={{ height: 110 }} />
      </ScrollView>

      {/* Fly This Trip modal — opened from DO tab events */}
      {flyTripEvent && (
        <FlyThisTrip
          event={flyTripEvent}
          onClose={() => setFlyTripEvent(null)}
          location={airportLat && airportLng ? { latitude: airportLat, longitude: airportLng } : null}
          userId={user?.id ?? null}
          saved={false}
          onSave={() => {}}
        />
      )}

      {/* Log flight error banner */}
      {logFlightError && (
        <View style={[styles.logErrorBanner, { flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
          <Feather name="alert-triangle" size={13} color="#F59E0B" />
          <Text style={styles.logErrorText}>{logFlightError}</Text>
        </View>
      )}

      {/* Save confirmation toast */}
      {saveToast && (
        <Animated.View
          style={[styles.saveToast, {
            opacity: saveToastAnim,
            transform: [{ translateY: saveToastAnim.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
          }]}
          pointerEvents="none"
        >
          <MaterialCommunityIcons name="star" size={14} color="#22c55e" />
          <Text style={styles.saveToastText}>Added to Bucket List</Text>
        </Animated.View>
      )}

      {/* Bottom CTAs */}
      <View style={styles.bottomCtaRow}>
        <Animated.View style={[{ transform: [{ scale: propAnim }] }, styles.bottomCtaFlex]}>
          <TouchableOpacity
            style={[styles.saveBtn, inBucketList && styles.saveBtnActive]}
            onPress={handleBucketList}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <MaterialCommunityIcons name={inBucketList ? 'star' : 'star-outline'} size={16} color={inBucketList ? '#0D1421' : '#F0F4FF'} />
              <Text style={[styles.saveBtnText, inBucketList && styles.saveBtnTextActive]}>
                {inBucketList ? 'Saved' : 'Bucket List'}
              </Text>
            </View>
          </TouchableOpacity>
        </Animated.View>
        <TouchableOpacity
          style={[styles.flownBtn, inLogBook && styles.flownBtnActive]}
          activeOpacity={0.65}
          onPress={inLogBook ? undefined : logFlight}
          onLongPress={inLogBook ? logFlight : undefined}
          delayLongPress={600}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
            {inLogBook
              ? <><Feather name="check-circle" size={15} color="#34C77B" /><Text style={styles.flownBtnText}>Logged</Text></>
              : <>
                  <MaterialCommunityIcons name="airplane-landing" size={16} color="#F0F4FF" />
                  <Text style={styles.flownBtnText}>I've Flown Here</Text>
                </>
            }
          </View>
          {inLogBook && (
            <Text style={styles.flownBtnHint}>hold to remove</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* ── Courtesy Car Detail + Report Sheet ───────────── */}
      <Modal
        visible={crewCarModal}
        transparent
        animationType="slide"
        onRequestClose={() => { setCrewCarModal(false); setCrewCarFormView(false); }}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <TouchableOpacity
            style={styles.crewCarOverlay}
            activeOpacity={1}
            onPress={() => { setCrewCarModal(false); setCrewCarFormView(false); }}
          >
            <TouchableOpacity style={styles.crewCarSheet} activeOpacity={1} onPress={() => {}}>
              <View style={styles.crewCarHandle} />

              {/* ── DETAIL VIEW ────────────────────────────────── */}
              {!crewCarFormView && (
                <>
                  <Text style={styles.reportSheetTitle}>Courtesy Car</Text>
                  <Text style={styles.reportSheetSub}>{String(icao).toUpperCase()}{name ? ` · ${String(name)}` : ''}</Text>

                  {/* Status badge */}
                  <View style={[
                    styles.carStatusBadge,
                    { backgroundColor: statusColor(deriveStatus(crewCar)) + '18', borderColor: statusColor(deriveStatus(crewCar)) + '40' },
                  ]}>
                    <Text style={[styles.carStatusBadgeText, { color: statusColor(deriveStatus(crewCar)) }]}>
                      {deriveStatus(crewCar)}
                    </Text>
                  </View>

                  {/* Notes / description */}
                  {crewCar?.notes &&
                    crewCar.notes !== 'Crew car available' &&
                    crewCar.notes !== 'Not available' &&
                    crewCar.notes !== 'Rental car available' &&
                    crewCar.notes !== deriveStatus(crewCar) && (
                    <Text style={styles.carNoteText}>{crewCar.notes}</Text>
                  )}

                  {/* Last reported */}
                  {crewCar ? (
                    <Text style={styles.carLastReported}>{formatCrewCarAge(crewCar.reported_at)}</Text>
                  ) : (
                    <Text style={styles.carLastReported}>No reports yet for this airport</Text>
                  )}

                  {/* Recent reports (up to 3) */}
                  {crewCarReports.length > 0 && (
                    <>
                      <Text style={styles.carReportsHeader}>RECENT REPORTS</Text>
                      {crewCarReports.map((r, i) => (
                        <View key={i} style={styles.carReportItem}>
                          <View style={[styles.carReportDot, { backgroundColor: statusColor(deriveStatus(r)) }]} />
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.carReportStatus, { color: statusColor(deriveStatus(r)) }]}>
                              {deriveStatus(r)}
                            </Text>
                            {r.notes &&
                              r.notes !== 'Crew car available' &&
                              r.notes !== 'Not available' &&
                              r.notes !== 'Rental car available' &&
                              r.notes !== deriveStatus(r) && (
                              <Text style={styles.carReportNotes} numberOfLines={2}>{r.notes}</Text>
                            )}
                            {r.reporter_name ? (
                              <Text style={styles.carReportReporter}>{r.reporter_name}</Text>
                            ) : null}
                          </View>
                          <Text style={styles.carReportAge}>{formatCrewCarAge(r.reported_at)}</Text>
                        </View>
                      ))}
                    </>
                  )}

                  {/* Submit new report button */}
                  <TouchableOpacity
                    style={styles.carSubmitNewBtn}
                    onPress={() => { setCarStatusPick('Available'); setCarNotes(''); setCrewCarFormView(true); }}
                  >
                    <Text style={styles.carSubmitNewBtnText}>Submit New Report</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.modalCancel}
                    onPress={() => setCrewCarModal(false)}
                  >
                    <Text style={styles.modalCancelText}>Close</Text>
                  </TouchableOpacity>
                </>
              )}

              {/* ── FORM VIEW ──────────────────────────────────── */}
              {crewCarFormView && (
                <>
                  <Text style={styles.reportSheetTitle}>Report Status</Text>
                  <Text style={styles.reportSheetSub}>{String(icao).toUpperCase()}</Text>

                  {/* Status picker — 4 options in 2×2 grid */}
                  <View style={styles.carStatusPicker}>
                    {(['Available', 'Call Ahead', 'Not Available', 'Unknown'] as const).map(s => (
                      <TouchableOpacity
                        key={s}
                        style={[
                          styles.carStatusOption,
                          carStatusPick === s && { borderColor: statusColor(s), backgroundColor: statusColor(s) + '18' },
                        ]}
                        onPress={() => setCarStatusPick(s)}
                      >
                        <Text style={[styles.carStatusOptionText, carStatusPick === s && { color: statusColor(s) }]}>
                          {s}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  {/* Reporter identity */}
                  {reporterDisplayName ? (
                    <View style={styles.carReporterRow}>
                      <MaterialCommunityIcons name="account-circle" size={14} color="#4A5F77" />
                      <Text style={styles.carReporterName}>Reporting as {reporterDisplayName}</Text>
                    </View>
                  ) : null}

                  {/* Comment about the car */}
                  <Text style={styles.carNotesLabel}>Comment (optional)</Text>
                  <TextInput
                    style={[styles.reportInput, { height: 72, textAlignVertical: 'top' }]}
                    placeholder="e.g. '2019 Civic, key at front desk, back by 5pm'"
                    placeholderTextColor="#4A5F77"
                    value={carNotes}
                    onChangeText={setCarNotes}
                    multiline
                  />

                  {/* Submit */}
                  <TouchableOpacity
                    style={[styles.reportSubmitBtn, carSubmitting && styles.reportSubmitBtnOff]}
                    onPress={submitCourtesyCarReport}
                    disabled={carSubmitting}
                  >
                    <Text style={styles.reportSubmitBtnText}>
                      {carSubmitting ? 'Submitting…' : 'Submit Report'}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity style={styles.modalCancel} onPress={() => setCrewCarFormView(false)}>
                    <Text style={styles.modalCancelText}>← Back</Text>
                  </TouchableOpacity>
                </>
              )}
            </TouchableOpacity>
          </TouchableOpacity>
        </KeyboardAvoidingView>
      </Modal>

      <SignInPrompt
        visible={signInPrompt}
        onClose={() => setSignInPrompt(false)}
        title="Build Your Bucket List"
        body="Create a free account to save airports, track flights you've flown, and plan your next adventure — all in one place."
      />

      {/* ── Airport Review Modal ──────────────────────────── */}
      {user?.id && (
        <AirportReviewModal
          visible={reviewModalOpen}
          onClose={() => { setReviewModalOpen(false); setEditingReview(null); fetchAirportInsights(); }}
          airportIcao={(icao as string).toUpperCase()}
          userId={user.id}
          existingReview={editingReview}
        />
      )}

      {/* ── Report a Place Bottom Sheet ──────────────────── */}
      <Modal
        visible={reportModal}
        transparent
        animationType="slide"
        onRequestClose={() => setReportModal(false)}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <TouchableOpacity style={styles.crewCarOverlay} activeOpacity={1} onPress={() => setReportModal(false)}>
            <TouchableOpacity style={[styles.crewCarSheet, { paddingBottom: 36 }]} activeOpacity={1} onPress={() => {}}>
              <View style={styles.crewCarHandle} />

              {/* Header */}
              <Text style={styles.reportSheetTitle}>Report a Place</Text>
              <Text style={styles.reportSheetSub}>{String(icao).toUpperCase()}</Text>

              {/* Category chips — 2×2 grid */}
              <View style={styles.reportCatGrid}>
                {(['eat', 'stay', 'golf', 'do'] as const).map(cat => (
                  <TouchableOpacity
                    key={cat}
                    style={[styles.reportCatChip, reportTab === cat && styles.reportCatChipOn]}
                    onPress={() => setReportTab(cat)}
                  >
                    <Text style={[styles.reportCatChipText, reportTab === cat && styles.reportCatChipTextOn]}>
                      {REPORT_CAT_LABELS[cat]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Place name */}
              <TextInput
                style={styles.reportInput}
                placeholder="Place name"
                placeholderTextColor="#4A5B73"
                value={reportName}
                onChangeText={setReportName}
                autoCapitalize="words"
                returnKeyType="next"
              />

              {/* Pilot notes */}
              <TextInput
                style={[styles.reportInput, { height: 68, textAlignVertical: 'top', marginBottom: 8 }]}
                placeholder="Pilot notes (optional)"
                placeholderTextColor="#4A5B73"
                value={reportNotes}
                onChangeText={setReportNotes}
                multiline
                returnKeyType="done"
              />

              {/* Quick-tap chips */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 7, paddingBottom: 2 }} style={{ marginBottom: 18 }}>
                {['Walkable', 'On field', 'Breakfast', 'Worth the stop', 'Courtesy car needed'].map(chip => {
                  const on = reportNotes.includes(chip);
                  return (
                    <TouchableOpacity
                      key={chip}
                      style={[styles.reportChip, on && styles.reportChipOn]}
                      onPress={() => setReportNotes(prev =>
                        on
                          ? prev.replace(chip, '').replace(/^[,\s]+|[,\s]+$/g, '').trim()
                          : (prev.trim() ? `${prev.trim()}, ${chip}` : chip)
                      )}
                    >
                      <Text style={[styles.reportChipText, on && styles.reportChipTextOn]}>{chip}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {/* Submit */}
              <TouchableOpacity
                style={[styles.reportSubmitBtn, !reportName.trim() && styles.reportSubmitBtnOff]}
                onPress={submitPlaceReport}
                disabled={!reportName.trim()}
              >
                <Text style={[styles.reportSubmitBtnText, !reportName.trim() && { color: '#6B83A0' }]}>Submit Report</Text>
              </TouchableOpacity>

              {/* Cancel */}
              <TouchableOpacity style={styles.modalCancel} onPress={() => setReportModal(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          </TouchableOpacity>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

// ─── Report category labels ───────────────────────────────────────────────────
const REPORT_CAT_LABELS: Record<string, string> = {
  eat:  'Eat & Drink',
  stay: 'Hotel',
  golf: 'Golf',
  do:   'Activity',
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function buildFallbackSummary(place: any, tab: string, priceLevel?: string | null): string {
  const numRating = parseFloat((place.rating || '').toString()) || 0;

  let phrase: string;
  if (tab === 'eat') {
    if (numRating >= 4.3) phrase = 'Well-rated spot for a post-flight meal';
    else if (numRating >= 3.8) phrase = 'Popular local dining option';
    else if (numRating > 0) phrase = 'Local fly-in food stop';
    else phrase = 'Casual fly-in food stop';
  } else if (tab === 'stay') {
    if (numRating >= 4.3) phrase = 'Well-rated hotel for an overnight stay';
    else if (numRating >= 3.8) phrase = 'Reliable overnight option near the field';
    else phrase = 'Comfortable stay close to the airport';
  } else if (tab === 'golf') {
    phrase = 'Golf Course';
  } else {
    if (numRating >= 4.3) phrase = 'Well-rated local attraction close to the field';
    else if (numRating >= 3.8) phrase = 'Popular local stop close to the airport';
    else phrase = 'Worth a quick visit after landing';
  }

  const parts = [phrase];
  if (priceLevel) parts.push(priceLevel);
  return parts.join(' · ');
}

function buildDetailDescription(place: any, details: any, tab: string): string {
  if (details?.editorial_summary?.overview) return details.editorial_summary.overview;
  const numRating = details?.rating || parseFloat((place.rating || '').toString()) || 0;
  const reviews = details?.user_ratings_total || 0;
  const dist = place.distanceMiles ? `${place.distanceMiles} mi from the field` : 'near the airport';
  const reviewStr = reviews >= 100 ? 'strong reviews' : reviews >= 20 ? 'solid reviews' : 'decent reviews';
  const ratingStr = numRating >= 4.3 ? 'well-rated' : numRating >= 3.8 ? 'well-reviewed' : 'local';
  if (tab === 'eat') {
    if (numRating >= 4.3) return `A ${ratingStr} dining option ${dist}, with ${reviewStr} — a solid fly-in food stop worth the short drive from the airport.`;
    if (numRating >= 3.8) return `Popular local restaurant ${dist} with ${reviewStr}. A casual post-flight meal option close to the field.`;
    return `Local dining option ${dist}. A convenient stop after landing.`;
  }
  if (tab === 'stay') {
    if (numRating >= 4.3) return `A ${ratingStr} hotel ${dist} — good for an overnight stop with quick access back to the field.`;
    if (numRating >= 3.8) return `Reliable overnight option ${dist} with ${reviewStr}. Convenient for a quick layover stay.`;
    return `Lodging option ${dist}. A practical overnight stop near the airport.`;
  }
  if (tab === 'golf') {
    if (numRating >= 4.3) return `A ${ratingStr} course ${dist} with ${reviewStr}. Worth the easy detour for a fly-in round.`;
    if (numRating >= 3.8) return `Solid local course ${dist}. A good option for a round before or after your flight.`;
    return `Public course ${dist}. An easy golf stop on a fly-in day.`;
  }
  if (numRating >= 4.3) return `A ${ratingStr} local attraction ${dist} with ${reviewStr}. An easy post-flight stop worth visiting.`;
  if (numRating >= 3.8) return `Popular local stop ${dist}. Makes for a good outing after landing.`;
  return `Local attraction ${dist}. A convenient stop close to the field.`;
}

function PlaceCard({ place, priority, tab = 'eat' }: { place: any; priority?: boolean; tab?: string }) {
  const { top: topInset } = useSafeAreaInsets();
  const [modalVisible, setModalVisible] = useState(false);
  const [details, setDetails] = useState<any>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  function dismissModal() { setModalVisible(false); }

  // Use static fallback summary — no auto Places API call on mount
  // Full details are fetched only when user taps to open the modal
  useEffect(() => {
    setSummary(buildFallbackSummary(place, tab));
  }, [place.placeId]);

  async function openPlaceDetails() {
    setModalVisible(true);
    if (details) return;
    // OSM places have no placeId — show modal with data already in place object
    if (!place.placeId) return;
    setLoadingDetails(true);
    try {
      if (!canCallPlaces('details', 'placecard_details', 'low')) {
        setLoadingDetails(false);
        return;
      }
      const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place.placeId}&fields=name,formatted_phone_number,website,opening_hours,rating,user_ratings_total,price_level,formatted_address,photos,editorial_summary&key=${GOOGLE_KEY}`;
      const res = await fetch(url);
      recordPlacesCall('details', 'placecard_details');
      const data = await res.json();
      if (data.result) setDetails(data.result);
    } catch {}
    setLoadingDetails(false);
  }

  function openInMaps(app: 'apple' | 'google') {
    if (app === 'apple') {
      const addr = details?.formatted_address ? encodeURIComponent(details.formatted_address) : '';
      const nm = encodeURIComponent(place.name);
      Linking.openURL(`maps://?q=${nm}&address=${addr}&ll=${place.lat},${place.lng}`);
    } else {
      Linking.openURL(`comgooglemaps://?q=${encodeURIComponent(place.name)}&center=${place.lat},${place.lng}`);
    }
  }

  const priceLevel = details?.price_level ? '$'.repeat(details.price_level) : null;
  const isOpen = details?.opening_hours?.open_now;
  const todayHours = details?.opening_hours?.weekday_text?.[new Date().getDay() === 0 ? 6 : new Date().getDay() - 1];

  const thumbUri = place.photoRef
    ? `https://maps.googleapis.com/maps/api/place/photo?maxwidth=120&photoreference=${place.photoRef}&key=${GOOGLE_KEY}`
    : null;

  const heroPhotoRef = details?.photos?.[0]?.photo_reference ?? place.photoRef ?? null;
  const heroUri = heroPhotoRef
    ? `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photoreference=${heroPhotoRef}&key=${GOOGLE_KEY}`
    : null;

  const TAB_META: Record<string, { tint: string }> = {
    eat:  { tint: '#1A0D00' },
    stay: { tint: '#00101A' },
    golf: { tint: '#071A00' },
    do:   { tint: '#12001A' },
  };
  const meta = TAB_META[tab] ?? { tint: '#0D1421' };

  function PlaceThumbIcon({ tab }: { tab: string }) {
    if (tab === 'eat')  return <MaterialCommunityIcons name="silverware-fork-knife" size={20} color="#F0F4FF" />;
    if (tab === 'stay') return <MaterialCommunityIcons name="bed" size={20} color="#F0F4FF" />;
    if (tab === 'golf') return <MaterialCommunityIcons name="golf" size={20} color="#F0F4FF" />;
    if (tab === 'do')   return <MaterialCommunityIcons name="flag-variant" size={20} color="#F0F4FF" />;
    return <Feather name="map-pin" size={20} color="#F0F4FF" />;
  }

  return (
    <>
      <TouchableOpacity style={styles.placeCard} onPress={openPlaceDetails}>
        {thumbUri ? (
          <Image source={{ uri: thumbUri }} style={styles.placeThumb} resizeMode="cover" />
        ) : (
          <View style={[styles.placeThumbFallback, { backgroundColor: meta.tint }]}>
            <PlaceThumbIcon tab={tab} />
          </View>
        )}
        <View style={styles.placeInfo}>
          <Text style={styles.placeName}>{place.name}</Text>
          <Text style={styles.placeType}>{summary ?? buildFallbackSummary(place, tab)}</Text>
        </View>
        <View style={styles.placeMeta}>
          <Text style={styles.placeRating}>{place.rating}</Text>
          <Text style={styles.placeDistance}>{place.distanceMiles ? `${place.distanceMiles} mi` : place.distance}</Text>
        </View>
      </TouchableOpacity>

      <Modal visible={modalVisible} animationType="slide" transparent statusBarTranslucent>
        <View style={styles.placeModalBackdrop}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={dismissModal} />
          <View style={styles.placeModal}>
            <View style={styles.placeModalHero}>
              {heroUri ? (
                <Image source={{ uri: heroUri }} style={styles.placeModalHeroImg} resizeMode="cover" />
              ) : (
                <View style={[styles.placeModalHeroFallback, { backgroundColor: meta.tint, alignItems: 'center', justifyContent: 'center' }]}>
                  <PlaceThumbIcon tab={tab} />
                </View>
              )}
              <View style={styles.placeModalHeroOverlay} />
              <TouchableOpacity style={[styles.placeModalCloseBtn, { top: 14, right: 14 }]} onPress={dismissModal}>
                <Feather name="x" size={18} color="#F0F4FF" />
              </TouchableOpacity>
            </View>
          <ScrollView contentContainerStyle={styles.placeModalBody} keyboardDismissMode="on-drag">
            {loadingDetails ? (
              <ActivityIndicator color="#38BDF8" size="large" style={{ marginTop: 40 }} />
            ) : (
              <>
                <Text style={styles.placeModalName}>{details?.name || place.name}</Text>
                {(details?.formatted_address || place.address) ? (
                  <Text style={styles.placeModalAddress}>{details?.formatted_address || place.address}</Text>
                ) : null}
                <Text style={styles.placeModalDescription}>{buildDetailDescription(place, details, tab)}</Text>
                {!details && !loadingDetails && place.placeId && (
                  <Text style={{ fontSize: 12, color: '#4A5B73', fontStyle: 'italic', marginBottom: 10 }}>
                    More details unavailable right now. Try again shortly.
                  </Text>
                )}
                <View style={styles.placeModalPills}>
                  {details?.rating && (
                    <View style={[styles.pill, { flexDirection: 'row', alignItems: 'center', gap: 4 }]}>
                      <MaterialCommunityIcons name="star" size={13} color="#F59E0B" />
                      <Text style={styles.pillText}>{details.rating} ({details.user_ratings_total})</Text>
                    </View>
                  )}
                  {priceLevel && <View style={styles.pill}><Text style={styles.pillText}>{priceLevel}</Text></View>}
                  {isOpen !== undefined && (
                    <View style={[styles.pill, { backgroundColor: isOpen ? '#14532D' : '#450A0A' }]}>
                      <Text style={[styles.pillText, { color: isOpen ? '#22C55E' : '#EF4444' }]}>{isOpen ? '✓ Open Now' : '✗ Closed'}</Text>
                    </View>
                  )}
                  {place.distanceMiles && (
                    <View style={[styles.pill, { flexDirection: 'row', alignItems: 'center', gap: 4 }]}>
                      <Feather name="map-pin" size={13} color="#6B83A0" />
                      <Text style={styles.pillText}>{place.distanceMiles} mi from airport</Text>
                    </View>
                  )}
                </View>
                {todayHours && <View style={styles.placeDetailRow}><Text style={styles.placeDetailIcon}>🕐</Text><Text style={styles.placeDetailText}>{todayHours}</Text></View>}
                {(details?.formatted_phone_number || place.phone) && (
                  <TouchableOpacity style={styles.placeDetailRow} onPress={() => Linking.openURL(`tel:${details?.formatted_phone_number || place.phone}`)}>
                    <Text style={styles.placeDetailIcon}>📞</Text>
                    <Text style={[styles.placeDetailText, styles.placeDetailLink]}>{details?.formatted_phone_number || place.phone}</Text>
                  </TouchableOpacity>
                )}
                {(details?.website || place.website) && (
                  <TouchableOpacity style={styles.placeDetailRow} onPress={() => Linking.openURL(details?.website || place.website)}>
                    <Text style={styles.placeDetailIcon}>🌐</Text>
                    <Text style={[styles.placeDetailText, styles.placeDetailLink]} numberOfLines={1}>{(details?.website || place.website).replace(/^https?:\/\//, '')}</Text>
                  </TouchableOpacity>
                )}
                <Text style={styles.placeModalSectionLabel}>OPEN IN MAPS</Text>
                <View style={styles.mapsRow}>
                  <TouchableOpacity style={styles.mapsBtn} onPress={() => openInMaps('apple')}><Text style={styles.mapsBtnText}>🍎 Apple Maps</Text></TouchableOpacity>
                  <TouchableOpacity style={[styles.mapsBtn, { flexDirection: 'row', alignItems: 'center', gap: 6 }]} onPress={() => openInMaps('google')}>
                    <Feather name="map" size={14} color="#F0F4FF" />
                    <Text style={styles.mapsBtnText}>Google Maps</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

function LoadingPlaces() {
  return (
    <View style={styles.loadingBox}>
      <ActivityIndicator color="#38BDF8" />
      <Text style={styles.loadingText}>Finding nearby places...</Text>
    </View>
  );
}

function EmptyPlaces({ label, unavailable, homeAirport }: { label: string; unavailable?: boolean; homeAirport?: boolean }) {
  return (
    <View style={styles.errorBox}>
      {unavailable ? (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <Feather name="cloud-off" size={16} color="#6B83A0" />
            <Text style={[styles.errorText, { marginBottom: 0 }]}>Nearby {label} temporarily unavailable</Text>
          </View>
          <Text style={{ fontSize: 12, color: '#4A5B73', lineHeight: 18 }}>
            Visit this airport's page again shortly to load fresh results. Previously loaded data will appear automatically.
          </Text>
        </>
      ) : (
        <Text style={styles.errorText}>
          {homeAirport
            ? "This is your home airport — explore destinations to fly to instead."
            : `No ${label} found nearby`}
        </Text>
      )}
    </View>
  );
}

function PlacesTabHeader({ icao, name, label, onAdd }: { icao: string; name: string; label: string; onAdd?: () => void }) {
  return (
    <View style={styles.placesTabHeader}>
      <Text style={styles.placesTabHeaderIcao}>{icao}  ·  {name}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={styles.placesTabHeaderLabel}>{label}</Text>
        {onAdd && (
          <TouchableOpacity onPress={onAdd} activeOpacity={0.7} style={styles.tabSectionAddBtn}>
            <Feather name="plus" size={13} color="#38BDF8" />
            <Text style={styles.tabSectionAddText}>Suggest</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#060B16' },

  // Hero
  hero: { minHeight: 285, backgroundColor: '#03070F', borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.07)' },
  heroImage: { position: 'absolute', width: '100%', height: '100%' },
  heroImageFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#050A14' },
  heroFallbackIcao: { fontSize: 52, fontWeight: '900', color: 'rgba(56,189,248,0.08)', letterSpacing: 10 },
  heroScrimTop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  heroScrimBottom: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  heroOverlay: { paddingTop: 60, paddingHorizontal: 22, paddingBottom: 16 },
  heroWatermarkWrap: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center' },
  heroWatermark: { fontWeight: '900', color: 'rgba(255,255,255,0.06)', letterSpacing: 8, textAlign: 'center' },
  heroTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  backBtn: {},
  backText: { color: 'rgba(56,189,248,0.9)', fontSize: 14, fontWeight: '600', textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  heroAddBtn: { backgroundColor: 'rgba(5,10,20,0.65)', borderRadius: 16, width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(56,189,248,0.4)' },
  heroAddBtnText: { color: '#38BDF8', fontSize: 22, fontWeight: '300', lineHeight: 26 },
  icao: { fontSize: 11, fontWeight: '800', color: '#38BDF8', letterSpacing: 3.5, marginBottom: 6, textShadowColor: 'rgba(0,168,255,0.5)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 8 },
  airportName: { fontSize: 23, fontWeight: '800', color: '#F5F9FF', marginBottom: 4, lineHeight: 28, letterSpacing: -0.3, textShadowColor: 'rgba(0,0,0,0.75)', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 10 },
  city: { fontSize: 13, color: '#8FAACC', marginBottom: 0, letterSpacing: 0.2, textShadowColor: 'rgba(0,0,0,0.55)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 5 },
  // distPill anchors the bottom group — marginTop:auto pushes both distPill + heroMeta to the bottom together
  distPill: { backgroundColor: 'rgba(0,168,255,0.10)', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7, alignSelf: 'flex-start', borderWidth: 1, borderColor: 'rgba(0,168,255,0.42)', borderTopColor: 'rgba(120,210,255,0.28)', marginTop: 'auto', marginBottom: 8, shadowColor: '#00A8FF', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.18, shadowRadius: 7, elevation: 3 },
  distLine: { fontSize: 13, color: '#60CDFF', fontWeight: '700', letterSpacing: 0.2, textShadowColor: 'rgba(0,168,255,0.25)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  // heroMeta follows immediately below distPill with fixed gap — no auto needed here
  heroMeta: { flexDirection: 'row', gap: 8, marginTop: 0, marginBottom: 8 },
  planRouteBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: ORANGE, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, alignSelf: 'flex-start' },
  planRouteTxt: { color: '#0D1421', fontSize: 13, fontWeight: '700', letterSpacing: 0.2 },
  metaPill: { backgroundColor: 'rgba(3,7,16,0.72)', borderRadius: 8, paddingHorizontal: 11, paddingVertical: 6, borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)', borderTopColor: 'rgba(255,255,255,0.16)', flex: 0 },
  metaText: { fontSize: 11, color: '#C4D8F0', fontWeight: '600', letterSpacing: 0.2 },

  // Tabs
  tabBar: { flexDirection: 'row', backgroundColor: '#060A12', borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.07)', paddingTop: 4 },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabActive: { borderBottomWidth: 2.5, borderBottomColor: '#38BDF8' },
  tabText: { fontSize: 11, color: 'rgba(255,255,255,0.3)', fontWeight: '600', letterSpacing: 0.3 },
  tabTextActive: { color: '#F0F4FF', fontWeight: '700' },
  content: { flex: 1, padding: 20, paddingTop: 24 },

  // Section label
  sectionTitle: { fontSize: 10, fontWeight: '800', color: '#566D88', letterSpacing: 2.2, textTransform: 'uppercase', marginBottom: 14, marginTop: 10 },
  sectionTitleWhy: { fontSize: 10, color: '#38BDF8', letterSpacing: 2.4, opacity: 0.85 },

  // Quick actions
  actionRow: { flexDirection: 'row', gap: 10, marginBottom: 28, marginTop: 4, flexShrink: 0 },
  actionBtn: { flex: 1, flexShrink: 0, minWidth: 80, minHeight: 72, backgroundColor: 'rgba(10,18,36,0.97)', borderRadius: 14, paddingVertical: 13, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', borderTopColor: 'rgba(255,255,255,0.13)', shadowColor: '#001533', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.28, shadowRadius: 10, elevation: 4, gap: 5 },
  actionIcon: { fontSize: 22 },
  actionBtnText: { fontSize: 11, color: '#D8E4F0', fontWeight: '800', textAlign: 'center' },
  actionBtnSub: { fontSize: 9, color: '#5A7494', fontWeight: '600', textAlign: 'center' },

  // Flight logged success panel
  flightSuccessPanel: {
    backgroundColor: '#0A1F14', borderRadius: 14, padding: 16,
    marginBottom: 24, borderWidth: 1, borderColor: '#1E5C35',
  },
  flightSuccessHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  flightSuccessTitle: { fontSize: 15, fontWeight: '800', color: '#34C77B' },
  flightSuccessIcao: { fontSize: 12, fontWeight: '700', color: '#34C77B', opacity: 0.6, letterSpacing: 1.5 },
  flightSuccessStats: { flexDirection: 'row', backgroundColor: '#071510', borderRadius: 10, overflow: 'hidden', marginBottom: 12 },
  flightSuccessStat: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  flightSuccessStatDivider: { width: 1, backgroundColor: '#1E5C35' },
  flightSuccessStatValue: { fontSize: 20, fontWeight: '700', color: '#34C77B', marginBottom: 2 },
  flightSuccessStatLabel: { fontSize: 10, color: '#4A7A5B', fontWeight: '600', letterSpacing: 0.5 },
  flightSuccessAchievements: { borderTopWidth: 1, borderTopColor: '#1E5C35', paddingTop: 12, gap: 6 },
  flightSuccessAchievementsLabel: { fontSize: 9, fontWeight: '700', color: '#4A7A5B', letterSpacing: 1.5, marginBottom: 4 },
  flightSuccessAchievementItem: { fontSize: 13, fontWeight: '700', color: '#FFD700' },

  // Pilot Reports
  insightsSection: { marginBottom: 24 },
  insightsCountRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, marginTop: -4 },
  insightsCount: { fontSize: 12, color: '#6B83A0' },
  insightsLastReported: { fontSize: 11, color: '#4A5B73' },
  insightsGrid: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  insightCard: {
    flex: 1, backgroundColor: 'rgba(10,18,36,0.97)', borderRadius: 12, padding: 14,
    alignItems: 'center', gap: 4,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)',
  },
  insightValue: { fontSize: 18, fontWeight: '700', color: '#F0F4FF' },
  insightLabel: { fontSize: 10, color: '#6B83A0', fontWeight: '600', letterSpacing: 0.5 },
  insightMeta:  { fontSize: 9, color: '#3D5068', fontWeight: '500', marginTop: 2 },
  insightEmpty: {
    alignItems: 'center', paddingVertical: 28, gap: 10,
    backgroundColor: 'rgba(10,18,36,0.97)', borderRadius: 14,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', marginBottom: 12,
  },
  insightEmptyText: { fontSize: 13, color: '#4A5B73', textAlign: 'center', lineHeight: 20, paddingHorizontal: 24 },
  insightsNotesTitle: { fontSize: 10, fontWeight: '700', color: '#4A5B73', letterSpacing: 1.2, marginBottom: 10 },

  // Quick Intel
  quickIntelSection: { marginBottom: 16 },
  quickIntelGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 8,
  },
  quickIntelItem: {
    flex: 1, minWidth: '45%', backgroundColor: 'rgba(10,18,36,0.97)', borderRadius: 12,
    padding: 12, alignItems: 'center', gap: 4,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)',
  },
  quickIntelLabel: { fontSize: 9, fontWeight: '700', color: '#4A5B73', letterSpacing: 1 },
  quickIntelValue: { fontSize: 14, fontWeight: '700', color: '#F0F4FF' },
  quickIntelDogNote: {
    backgroundColor: 'rgba(13,148,136,0.06)', borderRadius: 10, padding: 10,
    borderWidth: 1, borderColor: 'rgba(13,148,136,0.15)', marginTop: 4,
  },
  quickIntelDogNoteText: { fontSize: 12, color: '#7A90AA', lineHeight: 18, marginBottom: 6 },

  // Collapsible section headers
  collapsibleHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10,
  },
  collapsibleSummary: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  collapsibleHint: { flex: 1, fontSize: 12, color: '#6B83A0', fontWeight: '500' },
  catBadgeInline: {
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6,
    borderWidth: 1,
  },
  catBadgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },

  // Tier 3 reference styles
  sectionTitleMuted: {
    fontSize: 10, fontWeight: '700', color: '#3D5068',
    letterSpacing: 2.4, textTransform: 'uppercase', marginTop: 20, marginBottom: 10,
  },
  refCard: {
    backgroundColor: 'rgba(10,18,36,0.80)', borderRadius: 12, padding: 14, marginBottom: 16,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)',
  },

  // Dog (kept for tags)
  dogCardNotes: { fontSize: 13, color: '#9AABBD', lineHeight: 20, marginBottom: 10 },
  dogTagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  dogTag: {
    backgroundColor: 'rgba(13,148,136,0.12)', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: 'rgba(13,148,136,0.25)',
  },
  dogTagText: { fontSize: 10, fontWeight: '600', color: '#0D9488' },

  // V2 Intel chips
  intelChipsSection: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  intelChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(10,18,36,0.97)', borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 7,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)',
  },
  intelChipText: { fontSize: 12, color: '#8A9BB5', fontWeight: '500', textTransform: 'capitalize' },

  // FBO Intel
  fboIntelSection: { marginBottom: 16 },
  fboIntelRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: 'rgba(10,18,36,0.97)', borderRadius: 12, padding: 14, marginBottom: 8,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)',
  },
  fboIntelLeft: { flex: 1, gap: 3 },
  fboIntelName: { fontSize: 14, fontWeight: '700', color: '#C8D8EE' },
  fboIntelMeta: { fontSize: 11, color: '#6B83A0' },
  fboIntelStar: { color: '#FBBF24', fontWeight: '700' },
  fboIntelRating: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(251,191,36,0.10)', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 4,
  },
  fboIntelRatingText: { fontSize: 15, fontWeight: '700', color: '#FBBF24' },

  // Report cards
  reportCard: {
    backgroundColor: 'rgba(10,18,36,0.97)', borderRadius: 14, padding: 16, marginBottom: 10,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)',
  },
  reportCardOwn: {
    borderColor: 'rgba(56,189,248,0.35)', backgroundColor: 'rgba(10,24,48,0.97)',
    shadowColor: '#38BDF8', shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.06, shadowRadius: 8,
  },
  reportHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  reportName: { fontSize: 14, fontWeight: '700', color: '#C8D8EE' },
  reportOwnBadge: {
    backgroundColor: 'rgba(56,189,248,0.12)', borderRadius: 6,
    paddingHorizontal: 7, paddingVertical: 2,
  },
  reportOwnBadgeText: { fontSize: 9, fontWeight: '700', color: '#38BDF8', letterSpacing: 0.5 },
  reportDate: { fontSize: 11, color: '#4A5B73' },
  reportReasonChip: {
    alignSelf: 'flex-start', backgroundColor: 'rgba(56,189,248,0.08)', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 3, marginBottom: 8,
  },
  reportReasonText: { fontSize: 10, fontWeight: '700', color: '#38BDF8', letterSpacing: 0.5, textTransform: 'capitalize' },
  reportIntelRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 6 },
  reportIntelItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  reportIntelText: { fontSize: 12, color: '#8A9BB5', fontWeight: '500' },
  reportNotes: { fontSize: 13, color: '#B0C4DA', lineHeight: 21, marginTop: 8 },
  viewAllReportsBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, marginTop: 4,
  },
  viewAllReportsText: { fontSize: 13, fontWeight: '600', color: '#38BDF8' },
  reportCta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: '#1E2D42',
    marginTop: 4,
  },
  reportCtaText: { fontSize: 14, fontWeight: '600', color: '#38BDF8' },

  // Weather
  // Places tab header
  placesTabHeader: { paddingHorizontal: 0, paddingTop: 4, paddingBottom: 20 },
  placesTabHeaderIcao: { fontSize: 11, fontWeight: '700', color: '#38BDF8', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 },
  placesTabHeaderLabel: { fontSize: 20, fontWeight: '800', color: '#F0F4FF' },

  loadingBox: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(10,18,36,0.97)', borderRadius: 14, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)', borderTopColor: 'rgba(255,255,255,0.15)', shadowColor: '#001533', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.4, shadowRadius: 14, elevation: 5 },
  loadingText: { color: '#6B83A0', fontSize: 13 },
  errorBox: { backgroundColor: 'rgba(10,18,36,0.97)', borderRadius: 14, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)', borderTopColor: 'rgba(255,255,255,0.15)', shadowColor: '#001533', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.4, shadowRadius: 14, elevation: 5, alignItems: 'center' },
  errorText: { color: '#C8D8EE', fontSize: 13, marginBottom: 10 },
  retryBtn: { backgroundColor: '#1E2D45', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 },
  retryText: { color: '#F0F4FF', fontSize: 12, fontWeight: '600' },
  flightCatBanner: { borderRadius: 10, borderWidth: 1.5, paddingVertical: 14, paddingHorizontal: 16, marginBottom: 14, marginTop: 4, alignItems: 'center' },
  flightCatText: { fontSize: 15, fontWeight: '700' },
  weatherDisclaimer: { fontSize: 12, color: '#C8D8EE', textAlign: 'center', marginBottom: 14, fontStyle: 'italic' },
  weatherCard: { backgroundColor: 'rgba(10,18,36,0.97)', borderRadius: 14, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)', borderTopColor: 'rgba(255,255,255,0.16)', shadowColor: '#001533', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.36, shadowRadius: 14, elevation: 5 },
  weatherRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.07)' },
  weatherLabel: { fontSize: 13, color: '#6B83A0' },
  weatherValue: { fontSize: 13, color: '#F0F4FF', fontWeight: '600', textAlign: 'right', flex: 1, marginLeft: 16 },
  metarBox: { backgroundColor: 'rgba(5,10,20,0.8)', borderRadius: 10, padding: 12, marginBottom: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
  metarLabel: { fontSize: 9, color: '#3A5A78', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 6 },
  metarText: { fontSize: 11, color: '#6B83A0', fontFamily: 'Courier' },

  // Why Fly Here
  whyCard: { backgroundColor: 'rgba(10,18,36,0.97)', borderRadius: 16, padding: 20, marginBottom: 4, borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)', borderTopColor: 'rgba(255,255,255,0.18)', shadowColor: '#001533', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.42, shadowRadius: 18, elevation: 7 },
  whyDescription: { fontSize: 13, color: '#5A7494', lineHeight: 19, marginBottom: 20, fontStyle: 'italic', letterSpacing: 0.2 },
  whyRow: { flexDirection: 'row', alignItems: 'stretch', gap: 12, marginBottom: 12 },
  whyAccentLine: { width: 2, borderRadius: 1, backgroundColor: 'rgba(0,168,255,0.30)', flexShrink: 0 },
  whyAccentStrong: { backgroundColor: 'rgba(56,189,248,0.65)', shadowColor: '#38BDF8', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.3, shadowRadius: 4 },
  whyRowInner: { flex: 1, gap: 3 },
  whyCategoryRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 1 },
  whyCategoryLabel: { fontSize: 9, fontWeight: '800', color: '#4A6580', letterSpacing: 1.6 },
  whyCategoryLabelStrong: { color: '#38BDF8' },
  whyDot: { fontSize: 16, color: '#38BDF8', lineHeight: 20, fontWeight: '700' },
  whyText: { fontSize: 13, color: '#D8E8F6', lineHeight: 20, fontWeight: '500', letterSpacing: 0.1 },
  whyTextMuted: { color: '#7A90AA' },

  // Runways
  runwayGrid: { gap: 10, marginBottom: 4 },
  runwayCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: 'rgba(10,18,36,0.97)', borderRadius: 14, padding: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)', borderTopColor: 'rgba(255,255,255,0.16)', shadowColor: '#001533', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.36, shadowRadius: 14, elevation: 5 },
  runwayIcon: { fontSize: 22 },
  runwayInfo: { flex: 1 },
  runwayId: { fontSize: 15, fontWeight: '700', color: '#F0F4FF', marginBottom: 3 },
  runwayMeta: { fontSize: 13, color: '#6B83A0' },
  runwayWind: { fontSize: 12, color: '#38BDF8', marginTop: 4 },
  emptyCard: { backgroundColor: 'rgba(10,18,36,0.97)', borderRadius: 14, padding: 16, marginBottom: 4, borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)', borderTopColor: 'rgba(255,255,255,0.15)', shadowColor: '#001533', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.4, shadowRadius: 14, elevation: 5, alignItems: 'center' },
  emptyText: { color: '#6B83A0', fontSize: 13 },

  // Airport Contact
  fboCard: { backgroundColor: 'rgba(10,18,36,0.97)', borderRadius: 14, padding: 16, marginBottom: 4, borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)', borderTopColor: 'rgba(255,255,255,0.16)', shadowColor: '#001533', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.36, shadowRadius: 14, elevation: 5 },
  fboRow: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  fboIcon: { fontSize: 24, marginTop: 2 },
  fboInfo: { flex: 1 },
  fboDetail: { fontSize: 13, color: '#6B83A0', lineHeight: 20 },

  // Nearby Events section
  nearbyEventsSection: { marginHorizontal: 16, marginTop: 8, marginBottom: 4, backgroundColor: 'rgba(10,18,36,0.97)', borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)', borderTopColor: 'rgba(255,255,255,0.15)', overflow: 'hidden', shadowColor: '#001533', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.4, shadowRadius: 14, elevation: 5 },
  nearbyEventRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  nearbyEventRowBorder: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.07)' },
  nearbyEventLeft: { width: 52, alignItems: 'center' },
  nearbyEventDate: { fontSize: 12, fontWeight: '700', color: '#C8D8EE', textAlign: 'center' },
  nearbyEventCountdown: { fontSize: 10, fontWeight: '700', color: '#FF4D00', marginTop: 2, textAlign: 'center' },
  nearbyEventInfo: { flex: 1 },
  nearbyEventTitle: { fontSize: 13, fontWeight: '700', color: '#F0F4FF', marginBottom: 2 },
  nearbyEventMeta: { fontSize: 11, color: '#4A5F77', fontWeight: '500' },
  contactChips: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  contactChip: { backgroundColor: 'rgba(10,18,36,0.97)', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)', borderTopColor: 'rgba(255,255,255,0.15)', alignItems: 'center' },
  contactChipLabel: { fontSize: 9, fontWeight: '700', color: '#6B83A0', letterSpacing: 1.4, marginBottom: 3 },
  contactChipValue: { fontSize: 13, fontWeight: '700', color: '#F0F4FF' },
  contactFreqs: { gap: 0, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.07)', marginTop: 4 },
  freqRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.07)' },
  freqLabel: { fontSize: 10, fontWeight: '700', color: '#6B83A0', letterSpacing: 1.2 },
  freqValue: { fontSize: 14, fontWeight: '700', color: '#F0F4FF' },

  // Crew car
  listItem: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(10,18,36,0.97)', borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)', borderTopColor: 'rgba(255,255,255,0.14)', shadowColor: '#001533', shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.36, shadowRadius: 12, elevation: 4 },
  listIcon: { fontSize: 18 },
  listText: { fontSize: 14, color: '#F0F4FF' },
  listSub: { fontSize: 11, color: '#6B83A0', marginTop: 2 },

  // Places
  placeCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: 'rgba(10,18,36,0.97)', borderRadius: 14, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)', borderTopColor: 'rgba(255,255,255,0.15)', shadowColor: '#001533', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.36, shadowRadius: 14, elevation: 5 },
  placeThumb: { width: 64, height: 64, borderRadius: 10, backgroundColor: 'rgba(10,18,36,0.97)', flexShrink: 0 },
  placeThumbFallback: { width: 64, height: 64, borderRadius: 10, backgroundColor: 'rgba(10,18,36,0.97)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)', flexShrink: 0 },
  placeInfo: { flex: 1 },
  placeName: { fontSize: 15, fontWeight: '700', color: '#F0F4FF', marginBottom: 4 },
  placeType: { fontSize: 12, color: '#6B83A0', lineHeight: 17 },
  placeMeta: { alignItems: 'flex-end' },
  placeRating: { fontSize: 13, color: '#F0F4FF', marginBottom: 4 },
  placeDistance: { fontSize: 12, color: '#38BDF8' },
  placeModalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  placeModal: { backgroundColor: '#060B16', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '86%', overflow: 'hidden' },
  placeModalGrabStrip: { position: 'absolute', left: 0, right: 0, alignItems: 'center', paddingVertical: 8 },
  placeModalGrabBar: { width: 38, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.55)' },
  placeModalHero: { height: 160, backgroundColor: '#0D1421', position: 'relative' },
  placeModalHeroImg: { position: 'absolute', width: '100%', height: '100%' },
  placeModalHeroFallback: { position: 'absolute', width: '100%', height: '100%', backgroundColor: '#0D1421' },
  placeModalHeroOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)' },
  placeModalCloseBtn: { position: 'absolute', top: 14, right: 16, width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  placeModalClose: { fontSize: 16, color: '#F0F4FF', lineHeight: 20 },
  placeModalBody: { padding: 20 },
  placeModalName: { fontSize: 26, fontWeight: '800', color: '#F0F4FF', marginBottom: 6 },
  placeModalAddress: { fontSize: 13, color: '#6B83A0', marginBottom: 10, lineHeight: 18 },
  placeModalDescription: { fontSize: 14, color: '#C8D8EE', lineHeight: 21, marginBottom: 16 },
  placeModalPills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  pill: { backgroundColor: 'rgba(10,18,36,0.97)', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)' },
  pillText: { fontSize: 12, color: '#C8D8EE', fontWeight: '600' },
  placeDetailRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.07)' },
  placeDetailIcon: { fontSize: 18, width: 28 },
  placeDetailText: { fontSize: 15, color: '#F0F4FF', flex: 1 },
  placeDetailLink: { color: '#38BDF8' },
  placeModalSectionLabel: { fontSize: 11, fontWeight: '700', color: '#6B83A0', letterSpacing: 1.5, marginTop: 24, marginBottom: 12 },
  mapsRow: { flexDirection: 'row', gap: 12 },
  mapsBtn: { flex: 1, backgroundColor: 'rgba(10,18,36,0.97)', borderRadius: 14, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)' },
  mapsBtnText: { color: '#F0F4FF', fontSize: 14, fontWeight: '700' },

  // Log flight error
  logErrorBanner: { marginHorizontal: 16, marginBottom: 4, backgroundColor: '#1A0E0E', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14, borderWidth: 1, borderColor: '#5C2020' },
  logErrorText: { fontSize: 12, color: '#F87171', fontWeight: '600', lineHeight: 18 },

  // Bottom CTAs
  bottomCtaRow: { flexDirection: 'row', gap: 10, marginHorizontal: 16, marginTop: 10, marginBottom: 22, alignItems: 'center' },
  heroShareBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: 'rgba(5,10,20,0.65)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  bottomCtaFlex: { flex: 1, alignSelf: 'stretch' },
  saveToast: { position: 'absolute', bottom: 100, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(10,20,14,0.94)', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 9, borderWidth: 1, borderColor: 'rgba(34,197,94,0.35)', shadowColor: '#22c55e', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 12 },
  saveToastText: { fontSize: 13, fontWeight: '700', color: '#4ade80', letterSpacing: 0.2 },
  saveBtn: { flex: 1, backgroundColor: 'rgba(56,189,248,0.09)', borderRadius: 16, paddingVertical: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(56,189,248,0.55)', borderTopColor: 'rgba(130,220,255,0.35)', shadowColor: '#38BDF8', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.14, shadowRadius: 10, elevation: 4 },
  saveBtnActive: { backgroundColor: 'rgba(34,197,94,0.08)', borderColor: 'rgba(34,197,94,0.52)', borderTopColor: 'rgba(100,230,160,0.35)', shadowColor: '#22c55e' },
  saveBtnText: { fontSize: 14, fontWeight: '700', color: '#38BDF8', letterSpacing: 0.3 },
  saveBtnTextActive: { color: '#34C77B' },
  flownBtn: { flex: 1, backgroundColor: 'rgba(8,20,15,0.97)', borderRadius: 16, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(52,199,123,0.52)', borderTopColor: 'rgba(100,230,160,0.35)', shadowColor: '#34C77B', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.14, shadowRadius: 10, elevation: 4 },
  flownBtnActive: { backgroundColor: 'rgba(8,28,18,0.99)' },
  flownBtnText: { fontSize: 14, fontWeight: '700', color: '#34C77B', letterSpacing: 0.3 },
  flownBtnHint: { fontSize: 10, color: '#34C77B', opacity: 0.5, marginTop: 3 },
  flownCountBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(5,10,20,0.65)', borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
  },
  flownCountBadgeText: { fontSize: 12, fontWeight: '700', color: '#C8D8EE' },
  flownCountBadgeLabel: { fontSize: 11, color: '#8A9BB5', marginLeft: 2 },

  // Courtesy car detail sheet
  carStatusBadge: {
    alignSelf: 'center', borderRadius: 20, borderWidth: 1,
    paddingHorizontal: 20, paddingVertical: 8,
    marginTop: 4, marginBottom: 14,
  },
  carStatusBadgeText: { fontSize: 17, fontWeight: '800', letterSpacing: 0.4 },
  carNoteText: { fontSize: 13, color: '#94A3B8', textAlign: 'center', lineHeight: 19, marginBottom: 10 },
  carLastReported: { fontSize: 11, color: '#4A5F77', textAlign: 'center', marginBottom: 18 },
  carReportsHeader: { fontSize: 10, fontWeight: '800', color: '#3A5472', letterSpacing: 1.1, marginBottom: 8 },
  carReportItem: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: 'rgba(10,18,36,0.97)', borderRadius: 12,
    padding: 12, marginBottom: 7,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)',
    shadowColor: '#001533', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.22, shadowRadius: 8, elevation: 3,
  },
  carReportDot: { width: 8, height: 8, borderRadius: 4 },
  carReportStatus: { fontSize: 13, fontWeight: '700' },
  carReportNotes: { fontSize: 11, color: '#6B83A0', marginTop: 2 },
  carReportReporter: { fontSize: 10, color: '#3A5472', marginTop: 2 },
  carReportAge: { fontSize: 11, color: '#4A5F77' },
  carCommentStrip: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: 16, marginTop: 6, marginBottom: 2,
    backgroundColor: 'rgba(10,18,36,0.97)', borderRadius: 12,
    paddingVertical: 10, paddingHorizontal: 14,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)',
  },
  carCommentDot: { width: 7, height: 7, borderRadius: 4, flexShrink: 0 },
  carCommentText: { flex: 1, fontSize: 13, color: '#94A3B8', lineHeight: 18 },
  carCommentReporter: { fontSize: 11, color: '#3A5472', flexShrink: 0 },

  carReporterRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 10 },
  carReporterName: { fontSize: 12, color: '#4A5F77', fontStyle: 'italic' },
  carNotesLabel: { fontSize: 11, fontWeight: '700', color: '#4A5F77', letterSpacing: 0.5, marginBottom: 6 },
  carSubmitNewBtn: {
    backgroundColor: '#38BDF8', borderRadius: 12,
    paddingVertical: 14, alignItems: 'center',
    marginTop: 10, marginBottom: 4,
  },
  carSubmitNewBtnText: { color: '#070B14', fontSize: 14, fontWeight: '800' },

  // Courtesy car status picker (form view)
  carStatusPicker: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  carStatusOption: {
    flex: 1, minWidth: '45%', borderRadius: 12, borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)', paddingVertical: 13,
    alignItems: 'center', backgroundColor: 'rgba(10,18,36,0.97)',
  },
  carStatusOptionText: { fontSize: 13, fontWeight: '700', color: '#6B83A0' },

  // Crew car reporting
  reportBtn: { backgroundColor: '#1E2D45', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  reportBtnText: { color: '#38BDF8', fontSize: 12, fontWeight: '700' },
  inlineModal: { backgroundColor: '#0D1421', borderRadius: 16, padding: 20, marginBottom: 16, borderWidth: 1, borderColor: '#1E2D45' },
  crewCarOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' },
  crewCarSheet: { backgroundColor: '#0D1421', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 44, borderTopWidth: 1, borderColor: '#1E2D45' },
  crewCarHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#1E2D45', alignSelf: 'center', marginBottom: 20 },
  reportSheetTitle: { fontSize: 18, fontWeight: '800', color: '#F0F4FF', textAlign: 'center', marginBottom: 4 },
  reportSheetSub: { fontSize: 12, fontWeight: '600', color: '#38BDF8', textAlign: 'center', letterSpacing: 0.5, marginBottom: 14, opacity: 0.8 },
  reportCatRow: { flexDirection: 'row', gap: 8, paddingVertical: 2, marginBottom: 18 },
  reportCatGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 18 },
  reportCatChip: { borderRadius: 20, borderWidth: 1, borderColor: '#1E2D45', paddingVertical: 7, paddingHorizontal: 14, backgroundColor: '#111827', flexBasis: '47%', flexGrow: 1, alignItems: 'center' },
  reportCatChipOn: { borderColor: '#38BDF8', backgroundColor: 'rgba(56,189,248,0.15)' },
  reportCatChipText: { fontSize: 13, color: '#6B83A0', fontWeight: '600' },
  reportCatChipTextOn: { color: '#38BDF8' },
  reportInput: { backgroundColor: '#111827', borderRadius: 10, borderWidth: 1, borderColor: '#1E2D45', color: '#F0F4FF', fontSize: 14, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 10 },
  reportChip: { borderRadius: 20, borderWidth: 1, borderColor: '#1E2D45', paddingVertical: 6, paddingHorizontal: 12, backgroundColor: '#111827' },
  reportChipOn: { borderColor: '#38BDF8', backgroundColor: 'rgba(56,189,248,0.12)' },
  reportChipText: { fontSize: 12, color: '#6B83A0', fontWeight: '600' },
  reportChipTextOn: { color: '#38BDF8' },
  reportSubmitBtn: { backgroundColor: '#38BDF8', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginBottom: 4 },
  reportSubmitBtnOff: { backgroundColor: '#0D1421', borderWidth: 1, borderColor: '#1E2D45' },
  reportSubmitBtnText: { color: '#070B14', fontSize: 15, fontWeight: '800' },

  modalTitle: { fontSize: 16, fontWeight: '700', color: '#F0F4FF', marginBottom: 16, textAlign: 'center' },
  modalBtns: { gap: 10 },
  modalOption: { backgroundColor: '#111827', borderRadius: 10, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: '#1E2D45' },
  modalOptionText: { color: '#F0F4FF', fontWeight: '600', fontSize: 14 },
  modalCancel: { padding: 14, alignItems: 'center' },
  modalCancelText: { color: '#6B83A0', fontSize: 14 },

  tabSectionAddBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10,
    backgroundColor: 'rgba(56,189,248,0.08)', borderWidth: 1, borderColor: 'rgba(56,189,248,0.22)',
  },
  tabSectionAddText: { fontSize: 12, fontWeight: '600', color: '#38BDF8' },
  // Tab bar event badge
  tabEventBadge: { backgroundColor: '#FF4D00', borderRadius: 8, minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  tabEventBadgeText: { color: '#fff', fontSize: 9, fontWeight: '800', lineHeight: 12 },

  // DO tab — upcoming events section
  doEventsHeader: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingBottom: 12 },
  doEventsAccent: { width: 2, height: 14, borderRadius: 1, backgroundColor: '#FF4D00' },
  doEventsTitle: { fontSize: 11, fontWeight: '800', color: '#8BA5BE', letterSpacing: 1.8, textTransform: 'uppercase', flex: 1 },
  doEventsBadge: { backgroundColor: '#0D1829', borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2, borderWidth: 1, borderColor: '#1A2D44' },
  doEventsBadgeText: { fontSize: 11, fontWeight: '700', color: '#38BDF8' },
  doEventCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(10,18,36,0.97)', borderRadius: 14, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)', borderTopColor: 'rgba(255,255,255,0.15)', shadowColor: '#001533', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.36, shadowRadius: 14, elevation: 5 },
  doEventThumb: { width: 56, height: 56, borderRadius: 10, alignItems: 'center', justifyContent: 'center', flexShrink: 0, borderWidth: 1 },
  doEventBadgeTxt: { fontSize: 10, fontWeight: '800', letterSpacing: 0.7 },
  doEventCountdown: { backgroundColor: '#1C1206', borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2, borderWidth: 1, borderColor: ORANGE },
  doEventCountdownTxt: { color: ORANGE, fontSize: 10, fontWeight: '700' },
  doEventName: { fontSize: 15, fontWeight: '700', color: '#E5E7EB', marginBottom: 4, lineHeight: 20 },
  doEventDate: { fontSize: 12, color: '#64748B' },
});
