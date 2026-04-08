import { supabase } from '@/lib/supabase';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../../contexts/AuthContext';
import { ActivityIndicator, Alert, Animated, Linking, Modal, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { saveDestination, unsaveDestination, getSavedDestinations } from '../../utils/bucketListStorage';
import { fetchCuratedEvents } from '@/utils/gaEvents';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import BackgroundWrapper from '../../components/BackgroundWrapper';
import SignInPrompt from '../../components/SignInPrompt';
import FlyThisTrip from '../../components/FlyThisTrip';
import { WebView } from 'react-native-webview';
import { MaterialCommunityIcons, Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

// Full list kept for the submit form; simplified list used in the Aviation filter UI
const EVENT_TYPES = ['All', 'Fly-In', 'Airshow', 'Pancake Breakfast', 'Poker Run', 'EAA Event', 'AOPA Event', 'Other'];
const FILTER_EVENT_TYPES = ['All', 'Fly-In', 'Airshow', 'Pancake Breakfast', 'EAA Event'];
const AVIATION_TYPES = new Set(['Fly-In', 'Airshow', 'Pancake Breakfast', 'Poker Run', 'EAA Event', 'AOPA Event', 'Other']);
const FEST_FILTERS = ['All', 'This Weekend', 'Food', 'Seasonal', 'Nearby'] as const;
type FestFilter = typeof FEST_FILTERS[number];


// Design tokens — imported from central theme
import { ORANGE, SKY, BORDER, TEXT1, TEXT2, TEXT3 } from '../../constants/theme';
const FEST_CAT_ACCENT: Record<string, string> = {
  'Food Festival': '#F59E0B',
  'Festival':      '#9B77F5',
};
function festCatAccent(cat: string) { return FEST_CAT_ACCENT[cat] ?? TEXT3; }

function TypeIcon({ type, size, color }: { type: string; size: number; color: string }) {
  if (type === 'Fly-In')            return <MaterialCommunityIcons name="airplane" size={size} color={color} />;
  if (type === 'Airshow')           return <MaterialCommunityIcons name="airplane" size={size} color={color} />;
  if (type === 'Pancake Breakfast') return <MaterialCommunityIcons name="food" size={size} color={color} />;
  if (type === 'Poker Run')         return <MaterialCommunityIcons name="cards" size={size} color={color} />;
  if (type === 'EAA Event')         return <MaterialCommunityIcons name="wrench" size={size} color={color} />;
  if (type === 'AOPA Event')        return <Feather name="award" size={size} color={color} />;
  return <Feather name="map-pin" size={size} color={color} />;
}

function FestIcon({ type, size, color }: { type: string; size: number; color: string }) {
  if (type === 'Food Festival') return <MaterialCommunityIcons name="silverware-fork-knife" size={size} color={color} />;
  if (type === 'Festival')      return <MaterialCommunityIcons name="music" size={size} color={color} />;
  return <MaterialCommunityIcons name="party-popper" size={size} color={color} />;
}

function getDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

function getDistanceMiles(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 3958.8;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function getDistanceNm(lat1: number, lng1: number, lat2: number, lng2: number) {
  return getDistanceMiles(lat1, lng1, lat2, lng2) / 1.15078;
}

/** Ground distance from airport to event venue in statute miles.
 *  Prefers airport_distance_nm (v3, explicitly in nm) converted to miles.
 *  Falls back to distance_miles (v2, but was stored in nm — convert too).
 */
function groundMiles(event: any): number {
  if (event.airport_distance_nm != null && event.airport_distance_nm > 0) {
    return Math.round(event.airport_distance_nm * 1.15078);
  }
  if (event.distance_miles != null && event.distance_miles > 0) {
    return Math.round(event.distance_miles * 1.15078);
  }
  return 0;
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

/** Returns number of days until the event (0 = today, negative = past). */
function daysUntilCount(dateStr: string): number {
  const today = new Date(); today.setHours(0,0,0,0);
  const event = new Date(dateStr + 'T12:00:00');
  return Math.ceil((event.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function daysUntil(dateStr: string) {
  const diff = daysUntilCount(dateStr);
  if (diff < 0) return null;
  if (diff === 0) return 'Today!';
  if (diff === 1) return 'Tomorrow';
  return `In ${diff} days`;
}

/** Sort events: date ASC → interested_count DESC → distance ASC */
function sortEvents(evts: any[], userLat?: number | null, userLng?: number | null) {
  return [...evts].sort((a, b) => {
    const dateDiff = a.start_date.localeCompare(b.start_date);
    if (dateDiff !== 0) return dateDiff;
    const intDiff = (b.interested_count || 0) - (a.interested_count || 0);
    if (intDiff !== 0) return intDiff;
    if (userLat && userLng && a.lat && b.lat) {
      return getDistanceNm(userLat, userLng, a.lat, a.lng) - getDistanceNm(userLat, userLng, b.lat, b.lng);
    }
    return 0;
  });
}


/** Group a sorted list of events by "Month Year" key */
function groupByMonth(evts: any[]): { month: string; events: any[] }[] {
  const map = new Map<string, any[]>();
  for (const e of evts) {
    const d = new Date(e.start_date + 'T12:00:00');
    const key = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(e);
  }
  return Array.from(map.entries()).map(([month, events]) => ({ month, events }));
}

/** Color for a calendar row's left accent based on category */
function calAccentColor(category: string): string {
  if (category === 'Airshow') return SKY;
  if (AVIATION_TYPES.has(category)) return ORANGE;
  return festCatAccent(category);
}

/** Aviation event card — unified with FestCard glass system */
function EventCard({ event, onCalendar, onAirport, onSave, onFlyTrip, saved, userLat, userLng }: {
  event: any;
  onCalendar: () => void;
  onAirport: () => void;
  onSave: () => void;
  onFlyTrip: () => void;
  saved: boolean;
  userLat?: number | null;
  userLng?: number | null;
}) {
  const accent = event.category === 'Airshow' ? SKY : ORANGE;
  const countdown = daysUntil(event.start_date);
  const isToday = countdown === 'Today!';
  const distNm = (userLat && userLng && event.lat && event.lng)
    ? Math.round(getDistanceNm(userLat, userLng, event.lat, event.lng))
    : null;
  const dateLabel = formatDate(event.start_date);
  const endLabel = event.end_date && event.end_date !== event.start_date
    ? ` – ${formatDate(event.end_date)}`
    : '';

  return (
    <TouchableOpacity style={ecStyles.card} activeOpacity={0.82} onPress={onFlyTrip}>
      <View style={[StyleSheet.absoluteFillObject, ecStyles.glass]} />
      <LinearGradient
        colors={['rgba(255,255,255,0.07)', 'transparent']}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 44 }}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        pointerEvents="none"
      />
      <View style={[StyleSheet.absoluteFillObject, ecStyles.borderGlow, { borderColor: accent + '28' }]} />

      {/* TOP ROW: type badge + countdown + bookmark */}
      <View style={ecStyles.topRow}>
        <View style={[ecStyles.typeBadge, { backgroundColor: accent + '18', borderColor: accent + '38' }]}>
          <TypeIcon type={event.category} size={11} color={accent} />
          <Text style={[ecStyles.typeBadgeText, { color: accent }]}>{event.category.toUpperCase()}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {countdown && (
            <View style={[ecStyles.countdownPill, isToday && { borderColor: '#22C55E', backgroundColor: '#0A1F0A' }]}>
              <Text style={[ecStyles.countdownTxt, isToday && { color: '#22C55E' }]}>{countdown}</Text>
            </View>
          )}
          <TouchableOpacity onPress={onSave} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} activeOpacity={0.7}>
            <MaterialCommunityIcons
              name={saved ? 'bookmark' : 'bookmark-outline'}
              size={20}
              color={saved ? ORANGE : '#3A5472'}
            />
          </TouchableOpacity>
        </View>
      </View>

      {/* AIRPORT ROW: ICAO + location */}
      <View style={ecStyles.airportRow}>
        <Text style={[ecStyles.icao, { color: accent }]}>{event.nearest_airport}</Text>
        {(event.city || event.state) ? (
          <>
            <Text style={ecStyles.dot}>•</Text>
            <Text style={ecStyles.locationTxt} numberOfLines={1}>
              {event.city}{event.state ? `, ${event.state}` : ''}
            </Text>
          </>
        ) : null}
      </View>

      {/* EVENT TITLE */}
      <Text style={ecStyles.title} numberOfLines={2}>{event.event_name}</Text>

      {/* DATE + DISTANCE ROW */}
      <View style={ecStyles.metaRow}>
        <Text style={ecStyles.dateTxt}>{dateLabel}{endLabel}</Text>
        {distNm !== null && (
          <>
            <Text style={ecStyles.dot}>·</Text>
            <MaterialCommunityIcons name="airplane" size={10} color={TEXT3} />
            <Text style={ecStyles.distTxt}>{distNm} nm away</Text>
          </>
        )}
        {groundMiles(event) > 0 && (
          <>
            <Text style={ecStyles.dot}>·</Text>
            <Text style={ecStyles.distGround}>{groundMiles(event)} mi from {event.nearest_airport}</Text>
          </>
        )}
      </View>

      {/* DESCRIPTION */}
      {event.description ? (
        <Text style={ecStyles.desc} numberOfLines={2}>{event.description}</Text>
      ) : null}

      {/* CTA ROW — Fly This Trip first */}
      <View style={ecStyles.ctaRow}>
        <TouchableOpacity
          style={[ecStyles.ctaBtnPrimary, { borderColor: accent + '55', backgroundColor: accent + '12' }]}
          onPress={onFlyTrip}
          activeOpacity={0.75}
        >
          <MaterialCommunityIcons name="airplane-takeoff" size={12} color={accent} />
          <Text style={[ecStyles.ctaBtnTxt, { color: accent }]}>Fly This Trip</Text>
        </TouchableOpacity>

        <TouchableOpacity style={ecStyles.ctaBtn} onPress={onAirport} activeOpacity={0.75}>
          <MaterialCommunityIcons name="office-building" size={12} color={TEXT2} />
          <Text style={ecStyles.ctaBtnTxt}>View Airport</Text>
        </TouchableOpacity>

        <TouchableOpacity style={ecStyles.ctaBtnIcon} onPress={onCalendar} activeOpacity={0.75}>
          <MaterialCommunityIcons name="calendar-plus" size={14} color={TEXT3} />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

const ecStyles = StyleSheet.create({
  // Identical structure to fcStyles — unified card system
  card: {
    borderRadius: 16, borderWidth: 1, borderColor: BORDER,
    overflow: 'hidden', padding: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.32, shadowRadius: 10, elevation: 5,
  },
  glass: { backgroundColor: 'rgba(18,26,46,0.92)' },
  borderGlow: { borderRadius: 16, borderWidth: 1 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  typeBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 8, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 4 },
  typeBadgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  countdownPill: { backgroundColor: '#1C1206', borderRadius: 20, paddingHorizontal: 9, paddingVertical: 3, borderWidth: 1, borderColor: ORANGE },
  countdownTxt: { color: ORANGE, fontSize: 11, fontWeight: '700' },
  airportRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 5, flexWrap: 'wrap' },
  icao: { fontSize: 13, fontWeight: '900', letterSpacing: 0.9, textTransform: 'uppercase' },
  dot: { fontSize: 12, color: TEXT3, marginHorizontal: 2 },
  locationTxt: { fontSize: 12, color: TEXT2, flex: 1 },
  title: { fontSize: 18, fontWeight: '800', color: TEXT1, marginBottom: 8, letterSpacing: -0.3, lineHeight: 24 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 10, flexWrap: 'wrap' },
  dateTxt: { fontSize: 12, color: TEXT3 },
  distTxt: { fontSize: 12, color: TEXT2, fontWeight: '600' },
  distGround: { fontSize: 11, color: TEXT3, fontWeight: '500' },
  desc: { fontSize: 13, color: TEXT2, lineHeight: 19, marginBottom: 14 },
  ctaRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
  ctaBtnPrimary: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12,
    borderWidth: 1,
  },
  ctaBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 10,
    paddingVertical: 8, paddingHorizontal: 12,
    borderWidth: 1, borderColor: BORDER,
  },
  ctaBtnIcon: {
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 10,
    paddingVertical: 8, paddingHorizontal: 10,
    borderWidth: 1, borderColor: BORDER,
  },
  ctaBtnTxt: { fontSize: 12, fontWeight: '600', color: TEXT2 },
});

/** Destination festival card — mirrors EventCard structure exactly */
function FestCard({ event, onAirport, onSave, onFlyTrip, saved, userLat, userLng }: {
  event: any;
  onAirport: () => void;
  onSave: () => void;
  onFlyTrip: () => void;
  saved: boolean;
  userLat?: number | null;
  userLng?: number | null;
}) {
  const accent = festCatAccent(event.category);
  const distNm = (userLat && userLng && event.lat && event.lng)
    ? Math.round(getDistanceNm(userLat, userLng, event.lat, event.lng))
    : null;
  const countdown = daysUntil(event.start_date);
  const isToday = countdown === 'Today!';
  const dateLabel = formatDate(event.start_date);
  const endLabel = event.end_date && event.end_date !== event.start_date
    ? ` – ${formatDate(event.end_date)}`
    : '';

  return (
    <TouchableOpacity style={fcStyles.card} activeOpacity={0.82} onPress={onFlyTrip}>
      <View style={[StyleSheet.absoluteFillObject, fcStyles.glass]} />
      <LinearGradient
        colors={['rgba(255,255,255,0.07)', 'transparent']}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 44 }}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        pointerEvents="none"
      />
      <View style={[StyleSheet.absoluteFillObject, fcStyles.borderGlow, { borderColor: accent + '28' }]} />

      {/* TOP ROW: category badge (with icon) + countdown + bookmark */}
      <View style={fcStyles.topRow}>
        <View style={[fcStyles.typeBadge, { backgroundColor: accent + '18', borderColor: accent + '38' }]}>
          <FestIcon type={event.category} size={11} color={accent} />
          <Text style={[fcStyles.typeBadgeText, { color: accent }]}>{event.category.toUpperCase()}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {countdown && (
            <View style={[fcStyles.countdownPill, isToday && { borderColor: '#22C55E', backgroundColor: '#0A1F0A' }]}>
              <Text style={[fcStyles.countdownTxt, isToday && { color: '#22C55E' }]}>{countdown}</Text>
            </View>
          )}
          <TouchableOpacity onPress={onSave} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} activeOpacity={0.7}>
            <MaterialCommunityIcons
              name={saved ? 'bookmark' : 'bookmark-outline'}
              size={20}
              color={saved ? accent : '#3A5472'}
            />
          </TouchableOpacity>
        </View>
      </View>

      {/* AIRPORT ROW: ICAO (accent) + city/state */}
      <View style={fcStyles.airportRow}>
        <Text style={[fcStyles.icao, { color: accent }]}>{event.nearest_airport}</Text>
        {(event.city || event.state) ? (
          <>
            <Text style={fcStyles.dot}>·</Text>
            <Text style={fcStyles.locationTxt} numberOfLines={1}>
              {event.city}{event.state ? `, ${event.state}` : ''}
            </Text>
          </>
        ) : null}
      </View>

      {/* EVENT TITLE */}
      <Text style={fcStyles.title} numberOfLines={2}>{event.event_name}</Text>

      {/* DATE + DISTANCE ROW */}
      <View style={fcStyles.metaRow}>
        <Text style={fcStyles.dateTxt}>{dateLabel}{endLabel}</Text>
        {distNm !== null && (
          <>
            <Text style={fcStyles.dot}>·</Text>
            <MaterialCommunityIcons name="airplane" size={10} color={TEXT3} />
            <Text style={fcStyles.distTxt}>{distNm} nm away</Text>
          </>
        )}
        {groundMiles(event) > 0 && (
          <>
            <Text style={fcStyles.dot}>·</Text>
            <Text style={fcStyles.distGround}>{groundMiles(event)} mi from {event.nearest_airport}</Text>
          </>
        )}
      </View>

      {/* DESCRIPTION */}
      {event.description ? (
        <Text style={fcStyles.desc} numberOfLines={3}>{event.description}</Text>
      ) : null}

      {/* CTA ROW — Fly This Trip first, then View Airport, then View Festival icon */}
      <View style={fcStyles.ctaRow}>
        <TouchableOpacity
          style={[fcStyles.ctaBtnPrimary, { borderColor: accent + '55', backgroundColor: accent + '12' }]}
          onPress={onFlyTrip}
          activeOpacity={0.75}
        >
          <MaterialCommunityIcons name="airplane-takeoff" size={12} color={accent} />
          <Text style={[fcStyles.ctaBtnTxt, { color: accent }]}>Fly This Trip</Text>
        </TouchableOpacity>
        <TouchableOpacity style={fcStyles.ctaBtn} onPress={onAirport} activeOpacity={0.75}>
          <MaterialCommunityIcons name="office-building" size={12} color={TEXT2} />
          <Text style={fcStyles.ctaBtnTxt}>View Airport</Text>
        </TouchableOpacity>
        {event.event_link ? (
          <TouchableOpacity
            style={fcStyles.ctaBtnIcon}
            onPress={() => Linking.openURL(event.event_link)}
            activeOpacity={0.75}
          >
            <Feather name="external-link" size={14} color={TEXT3} />
          </TouchableOpacity>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

const fcStyles = StyleSheet.create({
  card: {
    borderRadius: 16, borderWidth: 1, borderColor: BORDER,
    overflow: 'hidden', padding: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.32, shadowRadius: 10, elevation: 5,
  },
  glass: { backgroundColor: 'rgba(18,26,46,0.92)' },
  borderGlow: { borderRadius: 16, borderWidth: 1 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  typeBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 8, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 4 },
  typeBadgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  countdownPill: { backgroundColor: '#1C1206', borderRadius: 20, paddingHorizontal: 9, paddingVertical: 3, borderWidth: 1, borderColor: ORANGE },
  countdownTxt: { color: ORANGE, fontSize: 11, fontWeight: '700' },
  airportRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 5, flexWrap: 'wrap' },
  icao: { fontSize: 13, fontWeight: '900', letterSpacing: 0.9, textTransform: 'uppercase' },
  dot: { fontSize: 12, color: TEXT3, marginHorizontal: 2 },
  locationTxt: { fontSize: 12, color: TEXT2, flex: 1 },
  title: { fontSize: 18, fontWeight: '800', color: TEXT1, marginBottom: 8, letterSpacing: -0.3, lineHeight: 24 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 10, flexWrap: 'wrap' },
  dateTxt: { fontSize: 12, color: TEXT3 },
  distTxt: { fontSize: 12, color: TEXT2, fontWeight: '600' },
  distGround: { fontSize: 11, color: TEXT3, fontWeight: '500' },
  desc: { fontSize: 13, color: TEXT2, lineHeight: 19, marginBottom: 14 },
  ctaRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
  ctaBtnPrimary: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12,
    borderWidth: 1,
  },
  ctaBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 10,
    paddingVertical: 8, paddingHorizontal: 12,
    borderWidth: 1, borderColor: BORDER,
  },
  ctaBtnIcon: {
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 10,
    paddingVertical: 8, paddingHorizontal: 10,
    borderWidth: 1, borderColor: BORDER,
  },
  ctaBtnTxt: { fontSize: 12, fontWeight: '600', color: TEXT2 },
});

export default function EventsScreen() {
  const [events, setEvents] = useState<any[]>(() => fetchCuratedEvents());
  const [activeFilter, setActiveFilter] = useState('All');
  const [loading, setLoading] = useState(false);
  const [location, setLocation] = useState<any>(null);
  const [showSubmit, setShowSubmit] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [signInPrompt, setSignInPrompt] = useState(false);
  const [activeTab, setActiveTab] = useState<'Aviation' | 'Festivals' | 'Calendar'>('Aviation');
  const [activeFestFilter, setActiveFestFilter] = useState<FestFilter>('All');
  const [calViewMonth, setCalViewMonth] = useState<Date>(() => {
    const d = new Date(); d.setDate(1); d.setHours(0,0,0,0); return d;
  });
  const todayStr = new Date().toISOString().slice(0, 10);
  const [calSelectedDay, setCalSelectedDay] = useState<string>(todayStr);
  // reset pagination whenever the festival filter changes
  const setFestFilter = (f: FestFilter) => { setActiveFestFilter(f); setVisibleFestCount(10); };
  const setAvFilter = (t: string) => { setActiveFilter(t); setVisibleAviationCount(10); };
  const [webViewUrl, setWebViewUrl] = useState<string | null>(null);
  const [webViewLoading, setWebViewLoading] = useState(true);
  const [webViewError, setWebViewError] = useState(false);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [visibleFestCount, setVisibleFestCount] = useState(10);
  const [visibleAviationCount, setVisibleAviationCount] = useState(10);
  const [flyTripEvent, setFlyTripEvent] = useState<any | null>(null);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const [form, setForm] = useState({ nearest_airport: '', city: '', state: '', event_name: '', category: 'Fly-In', description: '', start_date: '', end_date: '', event_link: '' });

  useEffect(() => {
    // Location
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({});
        setLocation(loc.coords);
      }
    })();

    // Events
    fetchEvents();
  }, []);

  // Refresh saved IDs whenever the tab comes back into focus
  useFocusEffect(useCallback(() => {
    if (user?.id) {
      getSavedDestinations(user.id).then(items => {
        setSavedIds(new Set(items.map(i => i.id)));
      });
    }
  }, [user]));

  async function toggleSave(event: any, type: 'event' | 'festival') {
    if (!user?.id) { setSignInPrompt(true); return; }
    const itemId = String(event.id);
    if (savedIds.has(itemId)) {
      await unsaveDestination(user.id, itemId);
      setSavedIds(prev => { const next = new Set(prev); next.delete(itemId); return next; });
    } else {
      await saveDestination(user.id, {
        id: itemId,
        _type: type,
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

  async function fetchEvents() {
    // Show curated events instantly — no network needed
    const curated = fetchCuratedEvents();
    setEvents(curated);
    setLoading(false);

    // Fetch Supabase events in background and merge in
    const today = new Date().toISOString().split('T')[0];
    const { data } = await supabase.from('events').select('*').gte('start_date', today).order('start_date', { ascending: true });
    const supabaseEvents = data || [];

    if (__DEV__) {
      console.log(`[Events] Supabase: ${supabaseEvents.length} events`);
      console.log(`[Events] Curated: ${curated.length} upcoming events`);
    }

    if (supabaseEvents.length === 0) return; // nothing to merge

    // Merge — Supabase events win on duplicate event_name+start_date
    const seen = new Set<string>();
    const merged: any[] = [];
    for (const e of supabaseEvents) {
      seen.add(`${(e.event_name || '').trim().toLowerCase()}_${e.start_date}`);
      merged.push(e);
    }
    for (const e of curated) {
      const key = `${e.event_name.trim().toLowerCase()}_${e.start_date}`;
      if (!seen.has(key)) { seen.add(key); merged.push(e); }
    }
    merged.sort((a, b) => a.start_date.localeCompare(b.start_date));

    if (__DEV__) {
      console.log(`[Events] After merge/dedupe: ${merged.length} total`);
    }

    setEvents(merged);
    setLoading(false);
  }

  async function addToCalendar(event: any) {
    const startDate = new Date(event.start_date + 'T12:00:00');
    const url = `calshow:${Math.floor(startDate.getTime() / 1000)}`;
    const canOpen = await Linking.canOpenURL(url);
    if (canOpen) {
      await Linking.openURL(url);
    } else {
      Alert.alert('Opens Calendar', 'Could not open the Calendar app.');
    }
  }

  async function submitEvent() {
    if (!form.nearest_airport || !form.event_name || !form.start_date) {
      Alert.alert('Missing info', 'Please fill in Airport ICAO, event name, and start date.');
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.from('events').insert({
      ...form,
      nearest_airport: form.nearest_airport.toUpperCase(),
    });
    setSubmitting(false);
    if (error) { Alert.alert('Error', 'Could not submit event.'); return; }
    setShowSubmit(false);
    setForm({ nearest_airport: '', city: '', state: '', event_name: '', category: 'Fly-In', description: '', start_date: '', end_date: '', event_link: '' });
    fetchEvents();
    Alert.alert('Event submitted! ✈️', 'Your event is now live.');
  }

  async function onRefresh() {
    setRefreshing(true);
    try {
      await fetchEvents().catch(() => {});
    } finally {
      setRefreshing(false);
    }
  }

  const aviationEvents = events.filter(e => AVIATION_TYPES.has(e.category));
  const filtered = (() => {
    let result = aviationEvents;

    // Event type
    if (activeFilter !== 'All') {
      result = result.filter(e => e.category === activeFilter);
    }


    return result;
  })();

  const festFiltered = useMemo(() => {
    const userLat = location?.latitude ?? null;
    const userLng = location?.longitude ?? null;
    let result = events.filter(e => !AVIATION_TYPES.has(e.category));
    if (activeFestFilter === 'This Weekend') {
      // Find the upcoming Friday–Sunday window
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const dow = today.getDay();
      const daysToFri = dow === 0 ? 0 : dow <= 5 ? 5 - dow : 6;
      const friday = new Date(today); friday.setDate(today.getDate() + daysToFri);
      const sunday = new Date(friday); sunday.setDate(friday.getDate() + 2);
      result = result.filter(e => {
        const start = new Date(e.start_date + 'T12:00:00');
        const end   = e.end_date ? new Date(e.end_date + 'T12:00:00') : start;
        return start <= sunday && end >= friday;
      });
    } else if (activeFestFilter === 'Food') {
      result = result.filter(e => e.category === 'Food Festival');
    } else if (activeFestFilter === 'Seasonal') {
      result = result.filter(e => e.category === 'Festival');
    } else if (activeFestFilter === 'Nearby') {
      // Distance-only sort
      return [...result].sort((a, b) => {
        const da = (a.lat && userLat) ? getDistanceNm(userLat, userLng!, a.lat, a.lng) : Infinity;
        const db = (b.lat && userLat) ? getDistanceNm(userLat, userLng!, b.lat, b.lng) : Infinity;
        return da - db;
      });
    }

    // All other filters: composite sort — soonest + closest win.
    // Each 100 nm counts as ~10 days so local events stay near the top.
    if (userLat && userLng) {
      return [...result].sort((a, b) => {
        const daysA = Math.max(0, daysUntilCount(a.start_date));
        const daysB = Math.max(0, daysUntilCount(b.start_date));
        const distA = a.lat ? getDistanceNm(userLat, userLng, a.lat, a.lng) : 9999;
        const distB = b.lat ? getDistanceNm(userLat, userLng, b.lat, b.lng) : 9999;
        return (daysA + distA * 0.1) - (daysB + distB * 0.1);
      });
    }
    // No location yet — fall back to date sort
    return [...result].sort((a, b) => a.start_date.localeCompare(b.start_date));
  }, [events, activeFestFilter, location]);

  // Calendar grid helpers
  const calDayGrid = useMemo(() => {
    const year = calViewMonth.getFullYear();
    const month = calViewMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startOffset = firstDay.getDay(); // 0=Sun
    const totalCells = Math.ceil((startOffset + lastDay.getDate()) / 7) * 7;
    const cells: { dateStr: string; day: number; inMonth: boolean }[] = [];
    for (let i = 0; i < totalCells; i++) {
      const d = new Date(year, month, 1 - startOffset + i);
      cells.push({
        dateStr: d.toISOString().slice(0, 10),
        day: d.getDate(),
        inMonth: d.getMonth() === month,
      });
    }
    return cells;
  }, [calViewMonth]);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const e of events) {
      const key = e.start_date;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    return map;
  }, [events]);

  const selectedDayEvents = useMemo(() => {
    return events
      .filter(e => calSelectedDay >= e.start_date && calSelectedDay <= (e.end_date || e.start_date))
      .sort((a, b) => a.start_date.localeCompare(b.start_date));
  }, [events, calSelectedDay]);

  // Fade event list when selected day changes
  const listFade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    listFade.setValue(0);
    Animated.timing(listFade, { toValue: 1, duration: 200, useNativeDriver: true }).start();
  }, [calSelectedDay]);

  return (
    <BackgroundWrapper>
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerLabel}>{activeTab === 'Aviation' ? 'AVIATION' : activeTab === 'Festivals' ? 'FESTIVALS' : 'CALENDAR'}</Text>
          <Text style={styles.headerTitle}>{activeTab === 'Aviation' ? 'Fly-Ins & Events' : activeTab === 'Festivals' ? 'Destination Festivals' : 'Event Calendar'}</Text>
        </View>
        {activeTab === 'Aviation' && (
          <TouchableOpacity style={styles.addBtn} onPress={() => setShowSubmit(true)}>
            <Text style={styles.addBtnText}>＋ Add</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ── Top segmented tab control ─────────────────────────────────── */}
      <View style={styles.segmentedRow}>
        {(['Aviation', 'Festivals', 'Calendar'] as const).map(tab => (
          <TouchableOpacity
            key={tab}
            style={[styles.segmentedTab, activeTab === tab && styles.segmentedTabActive]}
            onPress={() => setActiveTab(tab)}
          >
            <Text style={[styles.segmentedTabText, activeTab === tab && styles.segmentedTabTextActive]}>{tab}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {activeTab === 'Aviation' && (
        <View style={styles.avFilterBlock}>
          {/* Event Type */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, gap: 6, alignItems: 'center' }} style={{ height: 36, marginBottom: 8 }}>
            {FILTER_EVENT_TYPES.map(t => (
              <TouchableOpacity key={t} style={[styles.chipSm, activeFilter === t && styles.chipSmActive]} onPress={() => setAvFilter(t)}>
                <Text style={[styles.chipSmText, activeFilter === t && styles.chipSmTextActive]}>{t}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {activeTab === 'Festivals' && (
        <View style={styles.filterRow}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, gap: 8, alignItems: 'center' }}>
            {FEST_FILTERS.map(f => (
              <TouchableOpacity key={f} style={[styles.chip, activeFestFilter === f && styles.chipActive]} onPress={() => setFestFilter(f)}>
                <Text style={[styles.chipText, activeFestFilter === f && styles.chipTextActive]}>{f}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#38BDF8" />}
        scrollEventThrottle={200}
        onScroll={({ nativeEvent: { layoutMeasurement, contentOffset, contentSize } }) => {
          const nearBottom = layoutMeasurement.height + contentOffset.y >= contentSize.height - 300;
          if (!nearBottom) return;
          if (activeTab === 'Festivals') {
            setVisibleFestCount(c => {
              const total = festFiltered.length;
              return c < total ? c + 10 : c;
            });
          } else if (activeTab === 'Aviation') {
            setVisibleAviationCount(c => {
              const total = filtered.length;
              return c < total ? c + 10 : c;
            });
          }
        }}
      >

        {/* ── Calendar tab ──────────────────────────────────────────────── */}
        {activeTab === 'Calendar' && (() => {
          const DAYS_OF_WEEK = ['S','M','T','W','T','F','S'];
          const monthLabel = calViewMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
          const selectedFmt = new Date(calSelectedDay + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
          return (
            <View style={{ paddingBottom: 40 }}>
              {/* Month nav header */}
              <View style={styles.calNavRow}>
                <TouchableOpacity
                  style={styles.calNavBtn}
                  onPress={() => setCalViewMonth(m => { const n = new Date(m); n.setMonth(n.getMonth() - 1); return n; })}
                  activeOpacity={0.7}
                >
                  <Feather name="chevron-left" size={20} color={TEXT1} />
                </TouchableOpacity>
                <Text style={styles.calNavTitle}>{monthLabel}</Text>
                <TouchableOpacity
                  style={styles.calNavBtn}
                  onPress={() => setCalViewMonth(m => { const n = new Date(m); n.setMonth(n.getMonth() + 1); return n; })}
                  activeOpacity={0.7}
                >
                  <Feather name="chevron-right" size={20} color={TEXT1} />
                </TouchableOpacity>
              </View>

              {/* Day-of-week header */}
              <View style={styles.calDowRow}>
                {DAYS_OF_WEEK.map((d, i) => (
                  <Text key={i} style={styles.calDowText}>{d}</Text>
                ))}
              </View>

              {/* Day grid */}
              <View style={styles.calGrid}>
                {calDayGrid.map(({ dateStr, day, inMonth }) => {
                  const isToday = dateStr === todayStr;
                  const isSelected = dateStr === calSelectedDay;
                  const dayEvents = eventsByDate.get(dateStr) || [];
                  const dots = dayEvents.slice(0, 3);
                  return (
                    <TouchableOpacity
                      key={dateStr}
                      style={styles.calDayCell}
                      onPress={() => setCalSelectedDay(dateStr)}
                      activeOpacity={0.55}
                    >
                      {/* Halo ring for selected waypoint */}
                      {isSelected && <View style={styles.calDayHalo} />}
                      <View style={[
                        styles.calDayNum,
                        isToday && !isSelected && styles.calDayToday,
                        isSelected && styles.calDaySelected,
                      ]}>
                        <Text style={[
                          styles.calDayNumText,
                          !inMonth && styles.calDayNumFaded,
                          isToday && !isSelected && styles.calDayTodayText,
                          isSelected && styles.calDaySelectedText,
                        ]}>{day}</Text>
                      </View>
                      {dots.length > 0 && (
                        <View style={styles.calDotRow}>
                          {dots.map((e: any, i: number) => (
                            <View key={i} style={[styles.calDot, { backgroundColor: calAccentColor(e.category) }]} />
                          ))}
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Divider + selected day events */}
              <View style={styles.calDivider} />
              <View style={{ paddingHorizontal: 16 }}>
                <Text style={styles.calSelDayLabel}>{selectedFmt.toUpperCase()}</Text>
                <View style={styles.calSelDayRule} />
                <Animated.View style={{ opacity: listFade }}>
                  {selectedDayEvents.length === 0 ? (
                    <Text style={styles.calNoEvents}>Clear skies — nothing scheduled this day</Text>
                  ) : selectedDayEvents.map((event: any) => {
                    const accent = calAccentColor(event.category);
                    return (
                      <TouchableOpacity
                        key={event.id}
                        style={styles.calRow}
                        onPress={() => setFlyTripEvent(event)}
                        activeOpacity={0.72}
                      >
                        <View style={[styles.calAccentBar, { backgroundColor: accent }]} />
                        <View style={styles.calRowContent}>
                          <View style={styles.calRowTop}>
                            <Text style={styles.calEventName} numberOfLines={1}>{event.event_name}</Text>
                            {(() => {
                              const cd = daysUntil(event.start_date);
                              const cdToday = cd === 'Today!';
                              return cd ? (
                                <View style={[styles.countdownPill, cdToday && styles.countdownPillToday]}>
                                  <Text style={[styles.countdownPillText, cdToday && { color: '#22C55E' }]}>{cd}</Text>
                                </View>
                              ) : null;
                            })()}
                          </View>
                          <View style={styles.calRowBottom}>
                            <View style={[styles.calIcaoChip, { borderColor: accent + '66', backgroundColor: accent + '18' }]}>
                              <Text style={[styles.calIcaoText, { color: accent }]}>{event.nearest_airport}</Text>
                            </View>
                            {(event.city || event.state) ? (
                              <Text style={styles.calLocationText} numberOfLines={1}>
                                {event.city}{event.state ? `, ${event.state}` : ''}
                              </Text>
                            ) : null}
                          </View>
                        </View>
                        <Feather name="chevron-right" size={14} color={TEXT2} style={{ marginLeft: 4 }} />
                      </TouchableOpacity>
                    );
                  })}
                </Animated.View>
              </View>
            </View>
          );
        })()}

        {/* ── Destination Festivals tab ─────────────────────────────────── */}
        {activeTab === 'Festivals' && (
          <>
            {loading ? (
              <View style={{ alignItems: 'center', paddingVertical: 60 }}>
                <ActivityIndicator color="#9B77F5" size="large" />
              </View>
            ) : festFiltered.length === 0 ? (
              <View style={{ alignItems: 'center', paddingVertical: 60, gap: 8 }}>
                <Text style={styles.emptyText}>
                  {activeFestFilter === 'Nearby'
                    ? 'No festivals in range — try expanding the filter'
                    : activeFestFilter === 'This Weekend'
                    ? 'Nothing happening this weekend — check back soon'
                    : 'No festivals found in this category'}
                </Text>
                {activeFestFilter !== 'All' && (
                  <TouchableOpacity onPress={() => setActiveFestFilter('All')}>
                    <Text style={styles.emptyAction}>Show all festivals →</Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : (() => {
              const userLat = location?.latitude ?? null;
              const userLng = location?.longitude ?? null;
              // For Nearby filter, list is already sorted — don't split into sections
              if (activeFestFilter === 'Nearby') {
                return (
                  <View style={{ paddingHorizontal: 16, paddingBottom: 24 }}>
                    <View style={styles.sectionHeaderRow}>
                      <View style={styles.sectionHeaderAccent} />
                      <Text style={styles.sectionLabel}>NEAREST FIRST</Text>
                      <View style={styles.sectionCountBadge}><Text style={styles.sectionCountText}>{festFiltered.length}</Text></View>
                    </View>
                    <View style={{ gap: 14 }}>
                      {festFiltered.slice(0, visibleFestCount).map(event => (
                        <FestCard key={event.id} event={event} onAirport={() => router.push({ pathname: '/airport', params: { icao: event.nearest_airport } })} onSave={() => toggleSave(event, 'festival')} onFlyTrip={() => setFlyTripEvent(event)} saved={savedIds.has(String(event.id))} userLat={userLat} userLng={userLng} />
                      ))}
                    </View>
                  </View>
                );
              }
              const thisWeek = festFiltered.filter(e => { const d = daysUntilCount(e.start_date); return d >= 0 && d <= 7; });
              const upcoming = festFiltered.filter(e => daysUntilCount(e.start_date) > 7);
              // paginate across thisWeek first, then upcoming
              const weekVisible = Math.min(visibleFestCount, thisWeek.length);
              const upcomingVisible = Math.max(0, visibleFestCount - thisWeek.length);
              return (
                <View style={{ paddingHorizontal: 16, paddingBottom: 24 }}>
                  {thisWeek.length > 0 && (
                    <>
                      <View style={styles.sectionHeaderRow}>
                        <View style={styles.sectionHeaderAccent} />
                        <Text style={styles.sectionLabel}>THIS WEEKEND</Text>
                        <View style={styles.sectionCountBadge}><Text style={styles.sectionCountText}>{thisWeek.length}</Text></View>
                      </View>
                      <View style={{ gap: 14, marginBottom: 28 }}>
                        {thisWeek.slice(0, weekVisible).map(event => (
                          <FestCard key={event.id} event={event} onAirport={() => router.push({ pathname: '/airport', params: { icao: event.nearest_airport } })} onSave={() => toggleSave(event, 'festival')} onFlyTrip={() => setFlyTripEvent(event)} saved={savedIds.has(String(event.id))} userLat={userLat} userLng={userLng} />
                        ))}
                      </View>
                    </>
                  )}
                  {upcoming.length > 0 && upcomingVisible > 0 && (
                    <>
                      <View style={styles.sectionHeaderRow}>
                        <View style={styles.sectionHeaderAccent} />
                        <Text style={styles.sectionLabel}>UPCOMING</Text>
                        <View style={styles.sectionCountBadge}><Text style={styles.sectionCountText}>{upcoming.length}</Text></View>
                      </View>
                      <View style={{ gap: 14 }}>
                        {upcoming.slice(0, upcomingVisible).map(event => (
                          <FestCard key={event.id} event={event} onAirport={() => router.push({ pathname: '/airport', params: { icao: event.nearest_airport } })} onSave={() => toggleSave(event, 'festival')} onFlyTrip={() => setFlyTripEvent(event)} saved={savedIds.has(String(event.id))} userLat={userLat} userLng={userLng} />
                        ))}
                      </View>
                    </>
                  )}
                </View>
              );
            })()}
          </>
        )}

        {/* ── Aviation Events list ──────────────────────────────────────── */}
        {activeTab === 'Aviation' && (
          <>
            {loading ? (
              <View style={{ alignItems: 'center', paddingVertical: 60 }}>
                <ActivityIndicator color="#38BDF8" size="large" />
              </View>
            ) : filtered.length === 0 ? (
              <View style={{ alignItems: 'center', paddingVertical: 60, gap: 16 }}>
                <Text style={styles.emptyText}>No fly-ins in this window — be the first to post one</Text>
                <TouchableOpacity style={styles.addBtn} onPress={() => setShowSubmit(true)}>
                  <Text style={styles.addBtnText}>＋ Add an event</Text>
                </TouchableOpacity>
              </View>
            ) : (() => {
              const userLat = location?.latitude ?? null;
              const userLng = location?.longitude ?? null;
              const thisWeek = sortEvents(filtered.filter(e => { const d = daysUntilCount(e.start_date); return d >= 0 && d <= 7; }), userLat, userLng);
              const upcoming = sortEvents(filtered.filter(e => daysUntilCount(e.start_date) > 7), userLat, userLng);
              const weekVisible = Math.min(visibleAviationCount, thisWeek.length);
              const upcomingVisible = Math.max(0, visibleAviationCount - thisWeek.length);

              return (
                <View style={{ paddingHorizontal: 16, paddingBottom: 24 }}>
                  {/* ── This Week ───────────────────────────────── */}
                  {thisWeek.length > 0 && (
                    <>
                      <View style={styles.sectionHeaderRow}>
                        <View style={styles.sectionHeaderAccent} />
                        <Text style={styles.sectionLabel}>THIS WEEK</Text>
                        <View style={styles.sectionCountBadge}>
                          <Text style={styles.sectionCountText}>{thisWeek.length}</Text>
                        </View>
                      </View>
                      <View style={{ gap: 12, marginBottom: 28 }}>
                        {thisWeek.slice(0, weekVisible).map(event => (
                          <EventCard
                            key={event.id}
                            event={event}
                            onCalendar={() => addToCalendar(event)}
                            onAirport={() => router.push({ pathname: '/airport', params: { icao: event.nearest_airport } })}
                            onSave={() => toggleSave(event, 'event')}
                            onFlyTrip={() => setFlyTripEvent(event)}
                            saved={savedIds.has(String(event.id))}
                            userLat={userLat}
                            userLng={userLng}
                          />
                        ))}
                      </View>
                    </>
                  )}

                  {/* ── Upcoming ────────────────────────────────── */}
                  {upcoming.length > 0 && upcomingVisible > 0 && (
                    <>
                      <View style={styles.sectionHeaderRow}>
                        <View style={styles.sectionHeaderAccent} />
                        <Text style={styles.sectionLabel}>UPCOMING</Text>
                        <View style={styles.sectionCountBadge}>
                          <Text style={styles.sectionCountText}>{upcoming.length}</Text>
                        </View>
                      </View>
                      <View style={{ gap: 12 }}>
                        {upcoming.slice(0, upcomingVisible).map(event => (
                          <EventCard
                            key={event.id}
                            event={event}
                            onCalendar={() => addToCalendar(event)}
                            onAirport={() => router.push({ pathname: '/airport', params: { icao: event.nearest_airport } })}
                            onSave={() => toggleSave(event, 'event')}
                            onFlyTrip={() => setFlyTripEvent(event)}
                            saved={savedIds.has(String(event.id))}
                            userLat={userLat}
                            userLng={userLng}
                          />
                        ))}
                      </View>
                    </>
                  )}
                </View>
              );
            })()}
          </>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* ── Fly This Trip ─────────────────────────────────────────────────── */}
      {flyTripEvent && (
        <FlyThisTrip
          event={flyTripEvent}
          onClose={() => setFlyTripEvent(null)}
          location={location}
          userId={user?.id ?? null}
          saved={savedIds.has(String(flyTripEvent.id))}
          onSave={() => toggleSave(flyTripEvent, AVIATION_TYPES.has(flyTripEvent.category) ? 'event' : 'festival')}
        />
      )}

      {/* ── In-app article reader ────────────────────────────────────────── */}
      <Modal visible={!!webViewUrl} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => {
        setWebViewUrl(null);
      }}>
        <View style={[styles.webViewContainer, { paddingTop: insets.top }]}>
          {/* Header bar */}
          <View style={styles.webViewHeader}>
            <TouchableOpacity style={styles.webViewBackBtn} onPress={() => {
              setWebViewUrl(null);
                  }}>
              <Text style={styles.webViewBackText}>← Back</Text>
            </TouchableOpacity>
            <Text style={styles.webViewDomain} numberOfLines={1}>{webViewUrl ? getDomain(webViewUrl) : ''}</Text>
            <TouchableOpacity style={styles.webViewOpenBtn} onPress={() => webViewUrl && Linking.openURL(webViewUrl)}>
              <Text style={styles.webViewOpenText}>↗</Text>
            </TouchableOpacity>
          </View>

          {/* Article web content */}
          {webViewError ? (
            <View style={styles.webViewErrorContainer}>
              <Text style={styles.webViewErrorTitle}>Page failed to load</Text>
              <Text style={styles.webViewErrorSub}>This publisher's site may be blocking in-app browsers.</Text>
              <TouchableOpacity style={styles.webViewErrorBtn} onPress={() => webViewUrl && Linking.openURL(webViewUrl)}>
                <Text style={styles.webViewErrorBtnText}>Open in Safari →</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.webViewErrorBtn, { backgroundColor: 'transparent', borderColor: '#1E2D45', marginTop: 10 }]} onPress={() => setWebViewUrl(null)}>
                <Text style={[styles.webViewErrorBtnText, { color: '#6B83A0' }]}>Go Back</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <WebView
                source={{ uri: webViewUrl! }}
                style={styles.webView}
                onLoadStart={() => setWebViewLoading(true)}
                onLoadEnd={() => setWebViewLoading(false)}
                onError={() => { setWebViewError(true); setWebViewLoading(false); }}
                onHttpError={(e) => { if (e.nativeEvent.statusCode >= 400) { setWebViewError(true); setWebViewLoading(false); } }}
                allowsBackForwardNavigationGestures
                sharedCookiesEnabled
                injectedJavaScriptBeforeContentLoaded={webViewUrl?.includes('youtube.com') ? 'true;' : `
                  (function() {
                    var CSS = \`
                      :root { color-scheme: dark !important; }
                      html, body { background-color: #020B18 !important; color: #FFFFFF !important; }
                      div, article, section, main, aside, nav, header, footer {
                        background-color: #020B18 !important;
                        color: #FFFFFF !important;
                      }
                      p, span, li, td, th, blockquote { color: #FFFFFF !important; }
                      h1, h2, h3, h4, h5, h6 { color: #FFFFFF !important; }
                      a { color: #4DA3FF !important; }
                      figcaption, [class*="meta"], [class*="date"], [class*="byline"], [class*="author"], time {
                        color: #BBBBBB !important;
                      }
                      img, video, picture, figure, svg, canvas, iframe {
                        opacity: 1 !important;
                        filter: none !important;
                        background-color: transparent !important;
                      }
                    \`;
                    function inject() {
                      // Always remove and re-append so our style sits last in the cascade,
                      // winning against any publisher stylesheet loaded after us.
                      var old = document.getElementById('ls-dark');
                      if (old) old.remove();
                      var s = document.createElement('style');
                      s.id = 'ls-dark';
                      s.textContent = CSS;
                      (document.head || document.documentElement).appendChild(s);
                    }
                    inject();
                    document.addEventListener('DOMContentLoaded', inject);
                    window.addEventListener('load', inject);
                    new MutationObserver(inject).observe(document.documentElement, { childList: true, subtree: false });
                  })();
                  true;
                `}
              />
              {webViewLoading && (
                <View style={styles.webViewLoadingOverlay}>
                  <ActivityIndicator color="#38BDF8" size="large" />
                </View>
              )}
            </>
          )}
        </View>
      </Modal>

      <Modal visible={showSubmit} animationType="slide" presentationStyle="pageSheet">
        <View style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Submit an Event</Text>
            <TouchableOpacity onPress={() => setShowSubmit(false)}><Feather name="x" size={18} color="#6B83A0" /></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.modalBody} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled">
            <Text style={styles.fieldLabel}>Nearest Airport ICAO *</Text>
            <TextInput style={styles.input} placeholder="e.g. KSUS" placeholderTextColor="#4A5B73" value={form.nearest_airport} onChangeText={v => setForm(f => ({ ...f, nearest_airport: v }))} autoCapitalize="characters" />
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>City</Text>
                <TextInput style={styles.input} placeholder="City" placeholderTextColor="#4A5B73" value={form.city} onChangeText={v => setForm(f => ({ ...f, city: v }))} />
              </View>
              <View style={{ width: 80 }}>
                <Text style={styles.fieldLabel}>State</Text>
                <TextInput style={styles.input} placeholder="MO" placeholderTextColor="#4A5B73" value={form.state} onChangeText={v => setForm(f => ({ ...f, state: v }))} autoCapitalize="characters" />
              </View>
            </View>
            <Text style={styles.fieldLabel}>Event Name *</Text>
            <TextInput style={styles.input} placeholder="e.g. EAA Chapter 54 Pancake Breakfast" placeholderTextColor="#4A5B73" value={form.event_name} onChangeText={v => setForm(f => ({ ...f, event_name: v }))} />
            <Text style={styles.fieldLabel}>Category</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }} contentContainerStyle={{ gap: 8, alignItems: 'center' }}>
              {EVENT_TYPES.filter(t => t !== 'All').map(t => (
                <TouchableOpacity key={t} style={[styles.chip, form.category === t && styles.chipActive, { flexDirection: 'row', alignItems: 'center', gap: 5 }]} onPress={() => setForm(f => ({ ...f, category: t }))}>
                  <TypeIcon type={t} size={12} color={form.category === t ? '#0D1421' : '#6B83A0'} />
                  <Text style={[styles.chipText, form.category === t && styles.chipTextActive]}>{t}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Start Date * (YYYY-MM-DD)</Text>
                <TextInput style={styles.input} placeholder="2026-05-10" placeholderTextColor="#4A5B73" value={form.start_date} onChangeText={v => setForm(f => ({ ...f, start_date: v }))} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>End Date (YYYY-MM-DD)</Text>
                <TextInput style={styles.input} placeholder="2026-05-11" placeholderTextColor="#4A5B73" value={form.end_date} onChangeText={v => setForm(f => ({ ...f, end_date: v }))} />
              </View>
            </View>
            <Text style={styles.fieldLabel}>Event Link</Text>
            <TextInput style={styles.input} placeholder="https://..." placeholderTextColor="#4A5B73" value={form.event_link} onChangeText={v => setForm(f => ({ ...f, event_link: v }))} autoCapitalize="none" keyboardType="url" />
            <Text style={styles.fieldLabel}>Description</Text>
            <TextInput style={[styles.input, { height: 90, textAlignVertical: 'top' }]} placeholder="Tell pilots what to expect..." placeholderTextColor="#4A5B73" value={form.description} onChangeText={v => setForm(f => ({ ...f, description: v }))} multiline numberOfLines={4} />
            <TouchableOpacity style={styles.submitBtn} onPress={submitEvent} disabled={submitting}>
              {submitting ? <ActivityIndicator color="#0D1421" /> : (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <MaterialCommunityIcons name="airplane" size={16} color="#0D1421" />
                  <Text style={styles.submitBtnText}>Submit Event</Text>
                </View>
              )}
            </TouchableOpacity>
            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      </Modal>

      <SignInPrompt
        visible={signInPrompt}
        onClose={() => setSignInPrompt(false)}
        title="Save Events & Fly-Ins"
        body="Create a free account to save fly-ins, airshows, and festivals to your bucket list."
      />
    </SafeAreaView>
    </BackgroundWrapper>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 16 },
  headerLabel: { fontSize: 11, color: '#6B83A0', fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 },
  headerTitle: { fontSize: 28, fontWeight: '800', color: '#F0F4FF' },
  addBtn: { backgroundColor: '#38BDF8', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8 },
  addBtnText: { color: '#0D1421', fontWeight: '700', fontSize: 14 },
  filterRow: { height: 44, marginBottom: 12 },
  chip: { backgroundColor: '#0D1421', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: '#1E2D45', alignSelf: 'center' },
  chipActive: { backgroundColor: '#38BDF8', borderColor: '#38BDF8' },
  chipText: { fontSize: 13, color: '#6B83A0', fontWeight: '600' },
  chipTextActive: { color: '#0D1421' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  emptyText: { color: '#6B83A0', fontSize: 16, textAlign: 'center', paddingHorizontal: 24 },
  emptyAction: { color: '#38BDF8', fontSize: 14, fontWeight: '600', marginTop: 4 },
  card: { backgroundColor: '#0D1421', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#1E2D45' },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  typeBadge: { backgroundColor: '#111827', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: '#1E2D45' },
  typeBadgeText: { color: '#38BDF8', fontSize: 12, fontWeight: '700' },
  countdown: { color: ORANGE, fontSize: 12, fontWeight: '700' },
  cardTitle: { fontSize: 18, fontWeight: '800', color: '#F0F4FF', marginBottom: 6 },
  cardAirport: { fontSize: 13, fontWeight: '700', color: '#38BDF8', marginBottom: 4 },
  cardMeta: { fontSize: 12, color: '#6B83A0', marginBottom: 2 },
  cardDesc: { fontSize: 13, color: '#C8D8EE', marginTop: 8, lineHeight: 18 },
  cardActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#111827', borderRadius: 10, paddingVertical: 10, borderWidth: 1, borderColor: '#1E2D45' },
  actionBtnActive: { backgroundColor: '#38BDF8', borderColor: '#38BDF8' },
  actionBtnText: { color: '#F0F4FF', fontSize: 13, fontWeight: '600' },
  actionBtnTextActive: { color: '#0D1421' },
  actionCount: { color: '#F0F4FF', fontSize: 12, fontWeight: '700', backgroundColor: '#1E2D45', borderRadius: 10, paddingHorizontal: 6, paddingVertical: 1 },
  viewAirportBtn: { marginTop: 8, alignItems: 'center', paddingVertical: 6 },
  viewAirportText: { color: '#6B83A0', fontSize: 12, fontWeight: '600' },

  // Countdown pill
  countdownPill: { backgroundColor: '#1C1206', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: ORANGE },
  countdownPillToday: { backgroundColor: '#14290A', borderColor: '#22C55E' },
  countdownPillText: { color: ORANGE, fontSize: 11, fontWeight: '700' },

  // Action buttons – primary (flex) + secondary (fixed)
  actionBtnPrimary: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#111827', borderRadius: 10, paddingVertical: 10, borderWidth: 1, borderColor: '#1E2D45' },
  actionBtnSecondary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#111827', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16, borderWidth: 1, borderColor: '#1E2D45' },

  // Events section label
  eventsSectionHeader: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12 },
  eventsSectionTitle: { fontSize: 11, fontWeight: '700', color: '#6B83A0', letterSpacing: 1.5 },

  // Section headers: THIS WEEK / UPCOMING
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingTop: 20, paddingBottom: 14 },
  sectionHeaderAccent: { width: 2, height: 14, borderRadius: 1, backgroundColor: ORANGE },
  sectionLabel: { fontSize: 11, fontWeight: '800', color: '#8BA5BE', letterSpacing: 1.8, textTransform: 'uppercase', flex: 1 },
  sectionCountBadge: { backgroundColor: '#0D1829', borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2, borderWidth: 1, borderColor: '#1A2D44' },
  sectionCountText: { fontSize: 11, fontWeight: '700', color: '#38BDF8' },

  modal: { flex: 1, backgroundColor: '#060B16' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: 60, borderBottomWidth: 1, borderBottomColor: '#1E2D45' },
  modalTitle: { fontSize: 22, fontWeight: '800', color: '#F0F4FF' },
  modalClose: { color: '#6B83A0', fontSize: 20 },
  modalBody: { padding: 20 },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: '#6B83A0', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8, marginTop: 4 },
  input: { backgroundColor: '#0D1421', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, color: '#F0F4FF', fontSize: 15, borderWidth: 1, borderColor: '#1E2D45', marginBottom: 16 },
  submitBtn: { backgroundColor: '#38BDF8', borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  submitBtnText: { color: '#0D1421', fontSize: 16, fontWeight: '800' },

  // Segmented tab control
  segmentedRow: { flexDirection: 'row', marginHorizontal: 20, marginBottom: 12, backgroundColor: '#0D1421', borderRadius: 12, padding: 3, borderWidth: 1, borderColor: '#1E2D45' },
  segmentedTab: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 10 },
  segmentedTabActive: { backgroundColor: '#38BDF8' },
  segmentedTabText: { fontSize: 14, fontWeight: '700', color: '#6B83A0' },
  segmentedTabTextActive: { color: '#0D1421' },

  // Aviation tab — multi-row filter block
  avFilterBlock: { gap: 0, marginBottom: 16 },
  avFilterLabel: { fontSize: 9, fontWeight: '800', color: '#4A5F77', letterSpacing: 1.4, textTransform: 'uppercase', paddingHorizontal: 20, marginBottom: 4, marginTop: 6 },
  avFilterHelper: { fontSize: 11, color: '#3A5068', fontWeight: '500', paddingHorizontal: 20, marginTop: 4, marginBottom: 2 },
  tripChip: { backgroundColor: '#0D1421', borderRadius: 20, paddingHorizontal: 18, paddingVertical: 10, borderWidth: 1, borderColor: '#1E2D45', alignSelf: 'center' },
  tripChipActive: { backgroundColor: '#38BDF8', borderColor: '#38BDF8' },
  tripChipText: { fontSize: 14, color: '#6B83A0', fontWeight: '700' },
  tripChipTextActive: { color: '#0D1421' },
  // Event Type secondary chips — smaller, more subtle
  chipSm: { backgroundColor: 'rgba(13,20,33,0.6)', borderRadius: 20, paddingHorizontal: 11, paddingVertical: 5, borderWidth: 1, borderColor: '#182840', alignSelf: 'center' },
  chipSmActive: { backgroundColor: 'rgba(56,189,248,0.15)', borderColor: 'rgba(56,189,248,0.35)' },
  chipSmText: { fontSize: 12, color: '#3A5068', fontWeight: '600' },
  chipSmTextActive: { color: '#38BDF8' },

  // In-app article reader (WebView)
  webViewContainer: { flex: 1, backgroundColor: '#060B16' },
  webViewHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1E2D45', gap: 12 },
  webViewBackBtn: { paddingVertical: 6, paddingHorizontal: 4, minWidth: 64 },
  webViewBackText: { color: '#38BDF8', fontSize: 15, fontWeight: '600' },
  webViewDomain: { flex: 1, textAlign: 'center', fontSize: 13, color: '#C8D8EE', fontWeight: '600' },
  webViewOpenBtn: { minWidth: 32, alignItems: 'flex-end', paddingVertical: 6 },
  webViewOpenText: { color: '#38BDF8', fontSize: 18 },
  webView: { flex: 1, backgroundColor: '#060B16' },
  webViewLoadingOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: '#060B16' },
  webViewErrorContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 12 },
  webViewErrorTitle: { fontSize: 18, fontWeight: '800', color: '#F0F4FF', textAlign: 'center' },
  webViewErrorSub: { fontSize: 14, color: '#6B83A0', textAlign: 'center', lineHeight: 20 },
  webViewErrorBtn: { backgroundColor: '#38BDF8', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 28, alignItems: 'center', borderWidth: 1, borderColor: '#38BDF8', marginTop: 8 },
  webViewErrorBtnText: { color: '#0D1421', fontSize: 15, fontWeight: '700' },

  // Calendar tab — grid
  calNavRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  calNavBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  calNavTitle: { fontSize: 17, fontWeight: '800', color: TEXT1, letterSpacing: -0.3 },
  calDowRow: { flexDirection: 'row', paddingHorizontal: 8, paddingBottom: 6 },
  calDowText: { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '700', color: '#4A5F77', letterSpacing: 0.8 },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 8, paddingBottom: 8 },
  calDayCell: { width: '14.285714%', alignItems: 'center', paddingVertical: 4 },
  // halo ring rendered behind the selected day circle
  calDayHalo: {
    position: 'absolute', width: 42, height: 42, borderRadius: 21,
    borderWidth: 1.5, borderColor: SKY + '55',
    backgroundColor: SKY + '0A',
    shadowColor: SKY, shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.45, shadowRadius: 10,
  },
  calDayNum: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  // today: subtle ring, no fill
  calDayToday: {
    borderWidth: 1.5, borderColor: ORANGE,
    backgroundColor: 'rgba(255,77,0,0.10)',
  },
  // selected waypoint: solid sky fill + glow
  calDaySelected: {
    backgroundColor: SKY,
    shadowColor: SKY, shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7, shadowRadius: 10,
  },
  calDayNumText: { fontSize: 14, fontWeight: '600', color: TEXT1 },
  calDayNumFaded: { color: TEXT3 },
  calDayTodayText: { color: ORANGE, fontWeight: '700' },
  calDaySelectedText: { color: '#030D1A', fontWeight: '900' },
  calDotRow: { flexDirection: 'row', gap: 3, marginTop: 3, height: 6, alignItems: 'center' },
  calDot: { width: 5, height: 5, borderRadius: 3 },
  calDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.06)', marginTop: 14, marginBottom: 0 },
  // selected day heading — flight briefing style
  calSelDayLabel: { fontSize: 10, fontWeight: '900', color: '#8BA5BE', letterSpacing: 2.2, marginTop: 14, marginBottom: 6 },
  calSelDayRule: { height: 1, backgroundColor: 'rgba(255,255,255,0.06)', marginBottom: 12 },
  calNoEvents: { fontSize: 14, color: TEXT3, paddingVertical: 20, textAlign: 'center' },
  calMonthSection: { marginBottom: 24 },
  calMonthHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 16, paddingBottom: 10 },
  calMonthLabel: { fontSize: 11, fontWeight: '800', color: '#4A5F77', letterSpacing: 1.8 },
  calMonthCard: { backgroundColor: '#080F1C', borderRadius: 14, borderWidth: 1, borderColor: '#1A2D44', overflow: 'hidden' },
  // each row is its own glass card
  calRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 14,
    backgroundColor: 'rgba(12,18,32,0.88)',
    borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)',
    marginBottom: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.28, shadowRadius: 8, elevation: 4,
  },
  calAccentBar: { width: 3, height: '100%', borderRadius: 2, marginRight: 12, minHeight: 38 },
  calRowContent: { flex: 1 },
  calRowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, gap: 8 },
  calEventName: { fontSize: 14, fontWeight: '700', color: TEXT1, flex: 1 },
  calRowBottom: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  // avionics-style ICAO tag
  calIcaoChip: {
    borderRadius: 6, borderWidth: 1,
    paddingHorizontal: 8, paddingVertical: 3,
    shadowColor: SKY, shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35, shadowRadius: 6,
  },
  calIcaoText: { fontSize: 11, fontWeight: '900', letterSpacing: 0.9 },
  calLocationText: { fontSize: 12, color: TEXT2, flex: 1 },
  calCatChip: { borderRadius: 6, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 2 },
  calCatText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
});
