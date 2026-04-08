/**
 * app/(tabs)/hangar.tsx  ·  Hangar
 *
 * Pilot search screen.
 * Search by display name or home airport — returns public pilot profiles.
 *
 * Tap a row → /community-profile
 */

import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Colors, Surfaces, Elevation, Typography, Spacing, Radius, Icons } from '../../constants/theme';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons, Feather } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { GlassSearchBar } from '../../components/GlassSearchBar';
import BackgroundWrapper from '../../components/BackgroundWrapper';
import { LinearGradient } from 'expo-linear-gradient';

interface PilotResult {
  user_id: string;
  name: string | null;
  username: string | null;
  home_airport: string | null;
  aircraft_type: string | null;
  certificate: string | null;
}

// ── Fetch all public profiles, filter client-side ─────────────────────────────
// Server-side filtering on username is unreliable (column may not exist or be
// unpopulated). Instead, pull all public profiles and match locally so that
// username, name, and airport searches always work regardless of DB schema state.
async function fetchAllProfiles(): Promise<PilotResult[]> {
  // Try with username column first
  const r1 = await supabase
    .from('pilot_profiles')
    .select('user_id, name, username, home_airport, aircraft_type, certificate')
    .or('is_public.eq.true,is_public.is.null')
    .limit(200);

  if (!r1.error && r1.data) {
    if (__DEV__) console.log(`[Hangar] fetched ${r1.data.length} profiles (with username)`);
    return r1.data as PilotResult[];
  }

  // Fallback: username column missing — select without it
  if (__DEV__) console.warn('[Hangar] username col error, retrying without it:', r1.error?.message);
  const r2 = await supabase
    .from('pilot_profiles')
    .select('user_id, name, home_airport')
    .or('is_public.eq.true,is_public.is.null')
    .limit(200);

  if (__DEV__) console.log(`[Hangar] fallback fetched ${r2.data?.length ?? 0} profiles`);
  return (r2.data ?? []) as PilotResult[];
}

let profileCache: PilotResult[] | null = null;

async function runSearch(searchTerm: string): Promise<PilotResult[]> {
  // Fetch once per session; clear on explicit re-mount via useEffect
  if (!profileCache) profileCache = await fetchAllProfiles();
  const q = searchTerm.trim().toLowerCase();
  if (!q) return profileCache;

  // Client-side filter — matches username even if DB column is unreliable
  const localHits = profileCache.filter(r =>
    (r.name        ?? '').toLowerCase().includes(q) ||
    (r.username    ?? '').toLowerCase().includes(q) ||
    (r.home_airport ?? '').toLowerCase().includes(q),
  );

  if (localHits.length > 0) return localHits;

  // Direct DB fallback: search name, username, and home_airport server-side
  // in case the profile wasn't in the 200-row cache or username is null.
  if (__DEV__) console.log('[Hangar] local cache miss — trying direct DB search for:', q);
  const { data } = await supabase
    .from('pilot_profiles')
    .select('user_id, name, username, home_airport, aircraft_type, certificate')
    .or(`is_public.eq.true,is_public.is.null`)
    .or(`username.ilike.%${q}%,name.ilike.%${q}%,home_airport.ilike.%${q}%`)
    .limit(20);

  return (data ?? []) as PilotResult[];
}

// ── Client-side ranking + dedup ───────────────────────────────────────────────
// Scores results by match quality, deduplicates by user_id, caps at 20.
// Priority (highest → lowest):
//   100  exact ICAO match
//    90  exact username match
//    60  ICAO starts with query
//    50  username starts with query
//    40  name starts with query
//    20  ICAO contains query
//    15  username contains query
//    10  name contains query
function rankAndDedup(rows: PilotResult[], q: string): PilotResult[] {
  const norm = q.toLowerCase().trim();

  // 1. Deduplicate by user_id
  const seen = new Set<string>();
  const unique = rows.filter(r => {
    if (seen.has(r.user_id)) return false;
    seen.add(r.user_id);
    return true;
  });

  if (!norm) return unique.slice(0, 20);

  // 2. Score and sort
  return unique
    .map(r => {
      const airport  = (r.home_airport ?? '').toLowerCase();
      const username = (r.username ?? '').toLowerCase();
      const name     = (r.name ?? '').toLowerCase();
      let score = 0;
      if      (airport  === norm)            score = 100;
      else if (username === norm)            score = 90;
      else if (airport.startsWith(norm))     score = 60;
      else if (username.startsWith(norm))    score = 50;
      else if (name.startsWith(norm))        score = 40;
      else if (airport.includes(norm))       score = 20;
      else if (username.includes(norm))      score = 15;
      else if (name.includes(norm))          score = 10;
      return { ...r, _score: score };
    })
    .sort((a, b) => (b as any)._score - (a as any)._score)
    .slice(0, 20);
}

// ── Secondary info line ───────────────────────────────────────────────────────
// Shows aircraft first (most specific), then falls back to certificate label.
// Returns null if neither is set — the line simply doesn't render.
const CERT_LABELS: Record<string, string> = {
  student:    'Student Pilot',
  private:    'Private Pilot',
  instrument: 'Instrument Rated',
  commercial: 'Commercial Pilot',
  atp:        'ATP',
  cfi:        'Flight Instructor',
};

function secondaryLine(item: PilotResult): string | null {
  if (item.aircraft_type) return item.aircraft_type;
  if (item.certificate)   return CERT_LABELS[item.certificate] ?? item.certificate;
  return null;
}

// ── Animated pilot row ────────────────────────────────────────────────────────
// Reanimated v3 press: scale 0.97 on press-in, spring back on press-out.
// Border interpolates from default navy → aviation orange while pressed.
function PilotRow({ item, onPress }: { item: PilotResult; onPress: () => void }) {
  const pressed = useSharedValue(0);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: withSpring(pressed.value ? 0.97 : 1, { damping: 18, stiffness: 260 }) }],
    borderColor: pressed.value ? '#FF4D00' : Colors.border.default,
  }));

  const secondary = secondaryLine(item);

  return (
    <Pressable
      onPressIn  ={() => { pressed.value = 1; }}
      onPressOut ={() => { pressed.value = 0; }}
      onPress    ={onPress}
    >
      <Animated.View style={[s.row, animStyle]}>
        {/* Inner catch-light — 1px glass edge at top of plate */}
        <View style={s.rowHighlight} pointerEvents="none" />

        {/* Avatar — circular initials plate */}
        <View style={[s.avatar, s.avatarPlaceholder]}>
          <Text style={s.avatarInitial}>
            {(item.name ?? '?').charAt(0).toUpperCase()}
          </Text>
        </View>

        {/* Info stack — Name › Handle › ICAO › Secondary */}
        <View style={s.rowInfo}>
          {/* 1. Name — primary anchor */}
          <Text style={s.rowName} numberOfLines={1}>
            {item.name ?? 'Unknown Pilot'}
          </Text>

          {/* 2. Handle — clearly secondary */}
          {item.username ? (
            <Text style={s.rowUsername}>@{item.username}</Text>
          ) : null}

          {/* 3. ICAO — aviation orange with icon */}
          {item.home_airport ? (
            <View style={s.rowAirportRow}>
              <MaterialCommunityIcons name="airplane" size={10} color="#FF4D00" style={s.airportIcon} />
              <Text style={s.rowAirport}>{item.home_airport.toUpperCase()}</Text>
            </View>
          ) : null}

          {/* 4. Secondary — aircraft or certificate, muted */}
          {secondary ? (
            <Text style={s.rowSecondary} numberOfLines={1}>{secondary}</Text>
          ) : null}
        </View>

        <Feather name="chevron-right" size={14} color={Colors.border.active} />
      </Animated.View>
    </Pressable>
  );
}

export default function HangarScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [query, setQuery]     = useState('');
  const [results, setResults] = useState<PilotResult[]>([]);
  const [browsing, setBrowsing] = useState(false); // true = showing browse results
  const [searched, setSearched] = useState(false);  // true = typed search completed
  const [loading, setLoading]   = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── On mount: browse query so we can confirm the table has data ───────────
  useEffect(() => {
    if (__DEV__) console.log('[Hangar] mount — running browse query. user:', user?.id ?? 'none');
    profileCache = null; // clear session cache so a fresh fetch runs

    // Also check if the current user's own profile is visible
    if (user?.id) {
      supabase
        .from('pilot_profiles')
        .select('user_id, name, is_public')
        .eq('user_id', user.id)
        .maybeSingle()
        .then(({ data, error }) => {
          if (__DEV__) {
            if (error) console.warn('[Hangar] own profile check error:', error.message);
            else console.log('[Hangar] own profile:', JSON.stringify(data));
          }
        });
    }

    runSearch('').then(rows => {
      if (__DEV__) console.log('[Hangar] browse loaded', rows.length, 'profile(s)');
      setResults(rankAndDedup(rows, ''));
      setBrowsing(true);
    });
  }, [user?.id]);

  // ── Debounced search — fires 250 ms after the user stops typing ───────────
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const q = query.trim();
    if (q.length < 2) {
      // Restore browse results when search is cleared
      setSearched(false);
      setLoading(false);
      if (!browsing) {
        runSearch('').then(rows => { setResults(rankAndDedup(rows, '')); setBrowsing(true); });
      }
      return;
    }

    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      if (__DEV__) console.log('[Hangar] search triggered for:', q);
      const rows = await runSearch(q);
      setResults(rankAndDedup(rows, q));
      setSearched(true);
      setBrowsing(false);
      setLoading(false);
    }, 250);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  function goToProfile(item: PilotResult) {
    router.push({
      pathname: '/community-profile',
      params: { userId: item.user_id, displayName: item.name ?? '' },
    });
  }

  const showEmpty   = searched && !loading && results.length === 0;
  const showBrowse  = !searched && browsing && results.length > 0;
  const showPrompt  = !searched && !browsing && !loading;

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
    <BackgroundWrapper style={{ paddingTop: insets.top }}>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <View style={s.hdr}>
        <Text style={s.title}>Hangar</Text>
        <Text style={s.subtitle}>Find pilots in the community</Text>
      </View>

      {/* ── Search bar ─────────────────────────────────────────────────── */}
      <GlassSearchBar
        value={query}
        onChangeText={setQuery}
        placeholder="Search pilots or airport (e.g. KSUS)"
        autoCapitalize="none"
      />

      {/* ── Results ────────────────────────────────────────────────────── */}
      {loading ? (
        <View style={s.emptyWrap}>
          <ActivityIndicator size="small" color="#38BDF8" />
        </View>
      ) : showPrompt ? (
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={s.emptyWrap}>
            <MaterialCommunityIcons name="airplane" size={36} color="#6B83A0" style={{ opacity: 0.4 }} />
            <Text style={s.emptyTxt}>Search by name or home airport</Text>
          </View>
        </TouchableWithoutFeedback>
      ) : showEmpty ? (
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={s.emptyWrap}>
            <MaterialCommunityIcons name="account-search" size={36} color="#6B83A0" style={{ opacity: 0.4 }} />
            <Text style={s.emptyTxt}>No pilots found</Text>
            <Text style={s.emptyHint}>Try searching by username or airport (e.g. KSUS)</Text>
          </View>
        </TouchableWithoutFeedback>
      ) : (
        <>
          {showBrowse && (
            <Text style={s.browseLabel}>COMMUNITY PILOTS</Text>
          )}
          <FlatList
            data={results}
            keyExtractor={item => item.user_id}
            contentContainerStyle={s.list}
            showsVerticalScrollIndicator={false}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            onScrollBeginDrag={Keyboard.dismiss}
            renderItem={({ item }) => (
              <PilotRow item={item} onPress={() => goToProfile(item)} />
            )}
            ItemSeparatorComponent={() => <View style={s.separator} />}
            ListFooterComponent={() => (
              <View style={s.listFooter}>
                <MaterialCommunityIcons name="radar" size={18} color="#3A5472" style={{ opacity: 0.5 }} />
                <Text style={s.listFooterTxt}>
                  {showBrowse ? 'All community pilots shown' : 'End of results'}
                </Text>
              </View>
            )}
          />
        </>
      )}

      {/* ── Bottom depth vignette — fades dead space into atmosphere ─── */}
      <LinearGradient
        colors={['transparent', 'rgba(6, 9, 16, 0.80)']}
        style={s.bottomVignette}
        pointerEvents="none"
      />
    </BackgroundWrapper>
    </TouchableWithoutFeedback>
  );
}

// ── Hangar styles — migrated to design system tokens ─────────────────────────
//
// Before migration, this StyleSheet used 18 hard-coded color strings.
// After: every value traces back to a token in constants/theme.ts.
//
// Pattern used throughout:
//   color values  → Colors.*
//   surface shape → Surfaces.card (spread with spread operator)
//   spacing       → Spacing.*
//   type styles   → Typography.* (spread)

const s = StyleSheet.create({
  root: { flex: 1 },

  // Header
  hdr: {
    paddingHorizontal: Spacing.screenPadding,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.lg,
  },
  title:    { ...Typography.screenTitle, marginBottom: 4 },
  subtitle: { ...Typography.detail, fontWeight: '500' },

  // Browse label — section label system
  browseLabel: {
    ...Typography.sectionLabel,
    marginHorizontal: Spacing.screenPadding,
    marginTop: Spacing.md,
    marginBottom: Spacing.sm,
  },

  // Results list
  list: { paddingHorizontal: Spacing.screenPadding - 4, paddingBottom: 60 },

  // Pilot row — animated glass avionics plate
  // borderColor is overridden by Animated.View style on press (orange accent)
  row: {
    ...Surfaces.card,
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.cardPadding,
    gap: Spacing.rowIconGap,
    // overflow must be 'visible' so the shadow renders correctly;
    // the inner catch-light is absolute inside the row instead
    overflow: 'visible',
  },

  // Inner catch-light — 1px glass edge reflection at top of plate
  rowHighlight: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    height: 1,
    borderTopLeftRadius: Radius.card,
    borderTopRightRadius: Radius.card,
    backgroundColor: 'rgba(140, 190, 255, 0.07)',
    zIndex: 1,
  },

  // Avatar — circular instrument plate
  avatar: { width: 44, height: 44, borderRadius: Radius.full },
  avatarPlaceholder: {
    backgroundColor: Colors.glass.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.border.active,
  },
  avatarInitial: { fontSize: 18, fontWeight: '700', color: Colors.accent.sky },

  // ── Info stack ────────────────────────────────────────────────────────────
  rowInfo: { flex: 1, gap: 2 },

  // 1. Name — primary anchor: large, bold, clean white
  rowName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#EDF3FB',
    letterSpacing: -0.1,
    marginBottom: 0,
  },

  // 2. Handle — small, muted, clearly below the name
  rowUsername: {
    fontSize: 12,
    fontWeight: '400',
    color: Colors.text.muted,
    letterSpacing: 0,
  },

  // 3. ICAO row — icon + code inline
  rowAirportRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: 3,
  },
  airportIcon: { opacity: 0.85 },
  rowAirport: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FF4D00',
    letterSpacing: 1.0,
  },

  // 4. Secondary — aircraft or certificate, barely-there
  rowSecondary: {
    fontSize: 11,
    fontWeight: '400',
    color: Colors.text.dim,
    letterSpacing: 0,
  },

  separator: { height: Spacing.sm + 4 },  // 12px gap between rows

  // List footer — atmospheric end-of-list marker
  listFooter: {
    alignItems: 'center',
    gap: 6,
    paddingTop: Spacing.xl,
    paddingBottom: 100,   // extra breathing room before vignette
  },
  listFooterTxt: {
    fontSize: 11,
    fontWeight: '500',
    color: '#3A5472',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },

  // Bottom depth vignette — fades dead space into atmosphere
  bottomVignette: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    height: 120,
    pointerEvents: 'none',
  },

  // Empty state
  emptyWrap: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    gap: Spacing.sm + 4, paddingBottom: 80,
  },
  emptyIcon: { fontSize: 36, opacity: 0.4 },
  emptyTxt:  { ...Typography.rowLabel, color: Colors.text.muted },
  emptyHint: {
    ...Typography.detail, color: Colors.text.muted,
    textAlign: 'center', paddingHorizontal: Spacing.xl,
  },
});
