import AsyncStorage from '@react-native-async-storage/async-storage';
import airportsData from '../../assets/images/airports.json';

import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { useAuth } from '../../contexts/AuthContext';
import { useProfilePhoto } from '../../contexts/ProfilePhotoContext';
import ProfileHeader from '../../components/profile/ProfileHeader';
import ProfileSectionCard from '../../components/profile/ProfileSectionCard';
import BackgroundWrapper from '../../components/BackgroundWrapper';
import { supabase, SUPABASE_URL } from '../../lib/supabase';
import { MaterialCommunityIcons, Feather } from '@expo/vector-icons';

const HOME_LAT = 39.8283; // US geographic center — fallback only when no home airport is set
const HOME_LNG = -98.5795;

function getDistanceNm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3440.065;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const CERT_LABELS: Record<string, string> = {
  student:    'Student Pilot',
  private:    'Private Pilot',
  instrument: 'Instrument Rated',
  commercial: 'Commercial',
  atp:        'ATP',
  cfi:        'CFI',
};

function getPilotRank(airports: number): string {
  if (airports >= 100) return 'Airport Collector';
  if (airports >= 50)  return 'Sky Nomad';
  if (airports >= 25)  return 'Adventure Pilot';
  if (airports >= 10)  return 'Cross-Country Explorer';
  if (airports >= 5)   return 'Local Explorer';
  return 'First Flight';
}


// Badge context — passed to each badge fn so requirements can reference any stat.
interface BadgeCtx {
  airports: number;
  states: number;
  flights: number;
  hasFoodVisit: boolean;
  hasGolfVisit: boolean;
  hasDogVisit: boolean;
  hasHotelVisit: boolean;
  longestNm: number;
  reportCount: number;
  followingCount: number;
  streakWeeks: number;
  bucketCount: number;
  bucketVisited: number;
}

function BadgeIcon({ iconKey, size, color }: { iconKey: string; size: number; color: string }) {
  if (iconKey === 'food')       return <MaterialCommunityIcons name="food" size={size} color={color} />;
  if (iconKey === 'golf')       return <MaterialCommunityIcons name="golf" size={size} color={color} />;
  if (iconKey === 'landing')    return <MaterialCommunityIcons name="airplane-landing" size={size} color={color} />;
  if (iconKey === 'airplane')   return <MaterialCommunityIcons name="airplane" size={size} color={color} />;
  if (iconKey === 'map')        return <Feather name="map" size={size} color={color} />;
  if (iconKey === 'globe')      return <MaterialCommunityIcons name="earth" size={size} color={color} />;
  if (iconKey === 'award')      return <Feather name="award" size={size} color={color} />;
  return null;
}

// Badge definitions mirror achievements.tsx thresholds — edit one, update both.
const BADGE_DEFS: Array<{
  iconKey: string; title: string; difficulty: string; requirement: string;
  hint: string;
  fn: (ctx: BadgeCtx) => boolean;
  progress: (ctx: BadgeCtx) => { current: number; total: number };
}> = [
  { iconKey: 'food',    title: '$100 Hamburger',  difficulty: 'easy',   requirement: 'Fly somewhere for food',
    hint: 'Fly somewhere new, grab a meal nearby, and log your trip.',
    fn: (c) => c.hasFoodVisit, progress: (c) => ({ current: c.hasFoodVisit ? 1 : 0, total: 1 }) },
  { iconKey: 'golf',    title: 'Golf Destination', difficulty: 'easy',   requirement: 'Fly to a golf course',
    hint: 'Land near a golf course and log the flight — tee time optional.',
    fn: (c) => c.hasGolfVisit, progress: (c) => ({ current: c.hasGolfVisit ? 1 : 0, total: 1 }) },
  { iconKey: 'landing', title: 'First 5 Airports', difficulty: 'easy',   requirement: 'Visit 5 airports',
    hint: 'Log flights to 5 different airports — your home base doesn\'t count.',
    fn: (c) => c.airports >= 5, progress: (c) => ({ current: Math.min(c.airports, 5), total: 5 }) },
  { iconKey: 'airplane',title: 'First 10 Airports',difficulty: 'medium', requirement: 'Visit 10 airports',
    hint: 'Double down and hit 10 unique airports — mix short hops with longer trips.',
    fn: (c) => c.airports >= 10, progress: (c) => ({ current: Math.min(c.airports, 10), total: 10 }) },
  { iconKey: 'map',     title: '5 States Flown',   difficulty: 'medium', requirement: 'Fly across 5 states',
    hint: 'Spread your wings across 5 different states.',
    fn: (c) => c.states >= 5, progress: (c) => ({ current: Math.min(c.states, 5), total: 5 }) },
  { iconKey: 'globe',   title: '20 Airports',       difficulty: 'hard',   requirement: 'Visit 20 airports',
    hint: 'The mark of a true explorer — 20 unique airports under your belt.',
    fn: (c) => c.airports >= 20, progress: (c) => ({ current: Math.min(c.airports, 20), total: 20 }) },
  { iconKey: 'award',   title: 'Serious Explorer',  difficulty: 'hard',   requirement: '25 total flights',
    hint: 'Log 25 flights — every trip counts, even repeat visits.',
    fn: (c) => c.flights >= 25, progress: (c) => ({ current: Math.min(c.flights, 25), total: 25 }) },
  // ── New achievements ──
  { iconKey: 'map',     title: '10 States Flown',   difficulty: 'hard',   requirement: 'Fly across 10 states',
    hint: 'Double your state count — 10 states makes you a true cross-country pilot.',
    fn: (c) => c.states >= 10, progress: (c) => ({ current: Math.min(c.states, 10), total: 10 }) },
  { iconKey: 'airplane',title: '50 Airports',       difficulty: 'hard',   requirement: 'Visit 50 airports',
    hint: 'Fifty unique airports — you\'ve seen more ramps than most pilots dream of.',
    fn: (c) => c.airports >= 50, progress: (c) => ({ current: Math.min(c.airports, 50), total: 50 }) },
  { iconKey: 'globe',   title: 'Cross-Country',     difficulty: 'medium', requirement: 'Fly 200+ nm from home',
    hint: 'Push past 200 nm from your home base on a single trip.',
    fn: (c) => c.longestNm >= 200, progress: (c) => ({ current: Math.min(c.longestNm, 200), total: 200 }) },
  { iconKey: 'landing', title: 'Dog Lover',          difficulty: 'easy',   requirement: 'Fly to a dog-friendly airport',
    hint: 'Bring your best copilot — land at a dog-friendly airport.',
    fn: (c) => c.hasDogVisit, progress: (c) => ({ current: c.hasDogVisit ? 1 : 0, total: 1 }) },
  { iconKey: 'landing', title: 'Overnighter',        difficulty: 'easy',   requirement: 'Fly somewhere with lodging',
    hint: 'Fly somewhere you can stay the night — make it a real getaway.',
    fn: (c) => c.hasHotelVisit, progress: (c) => ({ current: c.hasHotelVisit ? 1 : 0, total: 1 }) },
  { iconKey: 'award',   title: 'First Report',       difficulty: 'easy',   requirement: 'Submit a pilot report',
    hint: 'Share what you found — one report helps every pilot who flies there next.',
    fn: (c) => c.reportCount >= 1, progress: (c) => ({ current: Math.min(c.reportCount, 1), total: 1 }) },
  { iconKey: 'award',   title: 'Helpful Pilot',      difficulty: 'medium', requirement: 'Submit 10 pilot reports',
    hint: 'Ten reports makes you one of the most valuable voices in the community.',
    fn: (c) => c.reportCount >= 10, progress: (c) => ({ current: Math.min(c.reportCount, 10), total: 10 }) },
  { iconKey: 'landing', title: 'Social Butterfly',   difficulty: 'easy',   requirement: 'Follow 5 pilots',
    hint: 'Connect with 5 fellow pilots and build your flying network.',
    fn: (c) => c.followingCount >= 5, progress: (c) => ({ current: Math.min(c.followingCount, 5), total: 5 }) },
  { iconKey: 'award',   title: 'Weekend Warrior',    difficulty: 'medium', requirement: '4 week flying streak',
    hint: 'Fly every week for a month straight — consistency is everything.',
    fn: (c) => c.streakWeeks >= 4, progress: (c) => ({ current: Math.min(c.streakWeeks, 4), total: 4 }) },
  { iconKey: 'award',   title: 'Iron Pilot',         difficulty: 'hard',   requirement: '12 week flying streak',
    hint: 'Three months of flying every single week. Legend status.',
    fn: (c) => c.streakWeeks >= 12, progress: (c) => ({ current: Math.min(c.streakWeeks, 12), total: 12 }) },
  // ── Bucket List + Milestones ──
  { iconKey: 'award',   title: 'Bucket List Starter', difficulty: 'easy',   requirement: 'Save 5 airports',
    hint: 'Build your dream list — save 5 airports you want to fly to.',
    fn: (c) => c.bucketCount >= 5, progress: (c) => ({ current: Math.min(c.bucketCount, 5), total: 5 }) },
  { iconKey: 'award',   title: 'Bucket List Builder', difficulty: 'medium', requirement: 'Save 15 airports',
    hint: 'Fifteen saved airports means you\'re never short on ideas.',
    fn: (c) => c.bucketCount >= 15, progress: (c) => ({ current: Math.min(c.bucketCount, 15), total: 15 }) },
  { iconKey: 'globe',   title: 'All 50 States',       difficulty: 'hard',   requirement: 'Fly in all 50 states',
    hint: 'The ultimate pilot achievement — touch down in every state.',
    fn: (c) => c.states >= 50, progress: (c) => ({ current: Math.min(c.states, 50), total: 50 }) },
  { iconKey: 'award',   title: '100 Flights',          difficulty: 'hard',   requirement: 'Log 100 flights',
    hint: 'Triple digits. You live for this.',
    fn: (c) => c.flights >= 100, progress: (c) => ({ current: Math.min(c.flights, 100), total: 100 }) },
  { iconKey: 'airplane',title: 'Dream Chaser',         difficulty: 'hard',   requirement: 'Visit 10 bucket list airports',
    hint: 'Turn 10 bucket list dreams into logged flights.',
    fn: (c) => c.bucketVisited >= 10, progress: (c) => ({ current: Math.min(c.bucketVisited, 10), total: 10 }) },
];

const BADGE_COLORS: Record<string, string> = {
  easy: '#38BDF8', medium: '#F59E0B', hard: '#A855F7',
};

interface ProfileData {
  name: string;
  username: string;
  badge: string;
  homeAirport: string;
  homeAirportName: string;
  aircraft: string;
}

const DEFAULT_PROFILE: ProfileData = {
  name: 'Pilot',
  username: '',
  badge: '',
  homeAirport: '',
  homeAirportName: '',
  aircraft: '',
};

// ── Flight log row — individual animated card per entry ──────────────────────
function FlightLogRow({ f, isLast, onPress }: { f: any; isLast: boolean; onPress: () => void }) {
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const airportName = f.name ?? f.city ?? f.icao;
  const location    = [f.city, f.state].filter(Boolean).join(', ');
  const dateStr     = new Date(f.visited_at).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });

  return (
    <Animated.View style={[animStyle, !isLast && logStyles.rowGap]}>
      <TouchableOpacity
        onPress={onPress}
        onPressIn={() => { scale.value = withSpring(0.97, { damping: 15, stiffness: 300 }); }}
        onPressOut={() => { scale.value = withSpring(1,    { damping: 15, stiffness: 300 }); }}
        activeOpacity={1}
        style={logStyles.row}
      >
        {/* Left — ICAO anchor + airport + location */}
        <View style={logStyles.left}>
          <Text style={logStyles.icao}>{f.icao}</Text>
          <Text style={logStyles.airportName} numberOfLines={1}>{airportName}</Text>
          {location ? <Text style={logStyles.location}>{location}</Text> : null}
        </View>

        {/* Right — date + chevron */}
        <View style={logStyles.right}>
          <Text style={logStyles.date}>{dateStr}</Text>
          <Feather name="chevron-right" size={14} color="#364A60" style={{ marginTop: 2 }} />
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

const logStyles = StyleSheet.create({
  rowGap: { marginBottom: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0A1220',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1A2D45',
    paddingVertical: 14,
    paddingHorizontal: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 3,
  },
  left: { flex: 1, gap: 2 },
  icao: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FF4D00',
    letterSpacing: 1.2,
  },
  airportName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#F0F4FF',
  },
  location: {
    fontSize: 11,
    color: '#6B83A0',
    fontWeight: '400',
  },
  right: {
    alignItems: 'flex-end',
    gap: 4,
    paddingLeft: 12,
  },
  date: {
    fontSize: 11,
    color: '#4A5F77',
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.3,
  },
});

export default function ProfileScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { setProfilePhoto } = useProfilePhoto();

  // All state declared before any function that uses it
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileData>(DEFAULT_PROFILE);
  const [earnedBadges, setEarnedBadges] = useState<{ iconKey: string; title: string; difficulty: string }[]>([]);
  const [badgeCtx, setBadgeCtx] = useState<BadgeCtx>({ airports: 0, states: 0, flights: 0, hasFoodVisit: false, hasGolfVisit: false, hasDogVisit: false, hasHotelVisit: false, longestNm: 0, reportCount: 0, followingCount: 0, streakWeeks: 0, bucketCount: 0, bucketVisited: 0 });
  const [streakWeeks, setStreakWeeks] = useState(0);
  const [stats, setStats] = useState([
    { value: '—',    label: 'Airports Visited' },
    { value: '—',    label: 'Bucket List' },
    { value: '—',    label: 'Flight Hours' },
    { value: '— nm', label: 'Total NM Flown' },
  ]);
  const [recentFlights, setRecentFlights] = useState<any[]>([]);
  const [followerCount, setFollowerCount]     = useState(0);
  const [followingCount, setFollowingCount]   = useState(0);
  const [newFollowerCount, setNewFollowerCount] = useState(0);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [myReviews, setMyReviews] = useState<any[]>([]);
  const [myActivity, setMyActivity] = useState<any[]>([]);

  function goToAirport(a: any) {
    router.push({
      pathname: '/airport',
      params: {
        icao: a.icao,
        name: a.name ?? '',
        city: a.city ?? '',
        state: a.state ?? '',
        lat: String(a.lat ?? ''),
        lng: String(a.lng ?? ''),
        elevation: '',
        fuel: '',
      },
    });
  }

  // Pre-warm photo library permission when the profile screen mounts so iOS
  // has already resolved the permission state by the time the user taps the
  // photo button. Without this, the first tap has a 1-2s delay while iOS
  // lazily checks/prompts for permission before the picker can open.
  useEffect(() => {
    ImagePicker.requestMediaLibraryPermissionsAsync().then(({ status }) => {
      if (__DEV__) console.log('[Profile] media library permission pre-warm:', status);
    });
  }, []);

  async function pickPhoto() {
    if (!user) return;
    if (__DEV__) console.log('[Profile] photo button tapped — user:', user.id);
    const t0 = Date.now();
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.7,
      });
      if (__DEV__) console.log('[Profile] picker opened + closed in', Date.now() - t0, 'ms | canceled:', result.canceled);
      if (!result.canceled && result.assets?.[0]?.uri) {
        const uri = result.assets[0].uri;
        if (__DEV__) console.log('[Profile] image selected — uri:', uri);
        // Update BOTH header and tab avatar immediately with the local file URI.
        // Do NOT wait for upload — the UI must feel instant.
        setPhotoUri(uri);
        setProfilePhoto(uri); // ← tab bar updates here, same frame as header

        // Upload to Supabase Storage in the background — UI already shows new photo above.
        try {
          const tUpload = Date.now();

          // Read the previous avatar path BEFORE uploading so we can delete it afterward.
          // This prevents accumulating old avatar files in Storage.
          let oldStoragePath: string | null = null;
          try {
            const { data: { user: currentUser } } = await supabase.auth.getUser();
            const meta = currentUser?.user_metadata?.avatar_url as string | undefined;
            if (meta && !meta.startsWith('http')) oldStoragePath = meta;
            if (__DEV__) console.log('[Profile] previous avatar path:', oldStoragePath ?? 'none');
          } catch {}

          // Use a timestamped filename so each upload gets a unique URL.
          // This forces the Image component cache to miss on every new upload —
          // reusing the same path (avatar.jpg) would serve the cached old image
          // even after the file is overwritten on Supabase Storage.
          const newFilename  = `avatar-${Date.now()}.jpg`;
          const storagePath  = `${user.id}/${newFilename}`;
          if (__DEV__) console.log('[Profile] upload target path (new):', storagePath);

          // arrayBuffer() is reliable for file:// URIs in React Native; blob() is not.
          const response = await fetch(uri);
          const arrayBuffer = await response.arrayBuffer();
          if (__DEV__) console.log('[Profile] file read, size:', arrayBuffer.byteLength, 'bytes');

          const { error: uploadError } = await supabase.storage
            .from('profile-photos')
            .upload(storagePath, arrayBuffer, { upsert: false, contentType: 'image/jpeg' });
          if (uploadError) throw uploadError;
          if (__DEV__) console.log('[Profile] upload SUCCESS in', Date.now() - tUpload, 'ms | path:', storagePath);

          const { data: urlData } = supabase.storage
            .from('profile-photos')
            .getPublicUrl(storagePath);
          const publicUrl = urlData.publicUrl;
          if (__DEV__) console.log('[Profile] new public URL:', publicUrl);

          // Save the new versioned path to user metadata (server-side source of truth).
          try {
            const { error: metaErr } = await supabase.auth.updateUser({ data: { avatar_url: storagePath } });
            if (__DEV__) console.log('[Profile] user_metadata updated to new path:', metaErr ? 'FAILED: ' + metaErr.message : storagePath);
          } catch (metaEx: any) {
            if (__DEV__) console.warn('[Profile] user_metadata save threw:', metaEx?.message);
          }

          // Swap the temp file:// URI for the permanent versioned URL in both places.
          // Both header and tab bar now show the new image (cache miss guaranteed).
          setPhotoUri(publicUrl);
          setProfilePhoto(publicUrl);
          if (__DEV__) console.log('[Profile] header + tab avatar → new URL:', publicUrl);

          // Mirror the new URL to AsyncStorage so next launch loads this version instantly.
          const oldCachedUrl = await AsyncStorage.getItem(`profilePhoto:${user.id}`).catch(() => null);
          if (__DEV__) console.log('[Profile] AsyncStorage old value:', oldCachedUrl ?? 'none', '| new value:', publicUrl);
          await AsyncStorage.setItem(`profilePhoto:${user.id}`, publicUrl).catch((e) => {
            if (__DEV__) console.warn('[Profile] AsyncStorage.setItem failed:', e?.message);
          });

          // Delete the previous avatar file to avoid accumulating stale files.
          // Fire-and-forget — do not let cleanup failure block anything.
          if (oldStoragePath && oldStoragePath !== storagePath) {
            supabase.storage.from('profile-photos').remove([oldStoragePath]).then(({ error }) => {
              if (__DEV__) console.log('[Profile] old avatar deleted (', oldStoragePath, '):', error ? 'FAILED: ' + error.message : 'OK');
            });
          }
        } catch (uploadErr: any) {
          if (__DEV__) console.warn('[Profile] upload FAILED — photo visible this session only:', uploadErr?.message ?? uploadErr);
          // The temp file:// URI is already showing in header + tab bar for this session.
          // On next launch it won't persist (file:// paths are not durable), which is acceptable.
        }
      }
    } catch (e: any) {
      if (__DEV__) console.log('[pickPhoto] error:', e?.message ?? e);
      Alert.alert('Could not open photos', e?.message ?? 'Please try again.');
    }
  }

  // Clear all local state when the signed-in user changes so the next user
  // never sees a previous user's cached profile data.
  useEffect(() => {
    if (__DEV__) console.log('[Profile] user changed → resetting local state. new id:', user?.id ?? 'none');
    setProfile(DEFAULT_PROFILE);
    setPhotoUri(null);
    setProfilePhoto(null);
    setRecentFlights([]);
    setEarnedBadges([]);
    setStats([
      { value: '—',    label: 'Airports Visited' },
      { value: '—',    label: 'Bucket List' },
      { value: '—',    label: 'Flight Hours' },
      { value: '— nm', label: 'Total NM Flown' },
    ]);
  }, [user?.id]);

  useFocusEffect(useCallback(() => {
    async function fetchAll() {
      // No authenticated user — bail gracefully, stats stay at placeholders
      if (!user) return;
      if (__DEV__) console.log('[Profile] fetching for user id:', user.id, 'email:', user.email);

      // Load profile and photo from AsyncStorage, keyed by the authenticated user's id
      // so two different accounts never share the same cached profile data.
      const profileKey = `userProfile:${user.id}`;
      const photoKey   = `profilePhoto:${user.id}`;
      if (__DEV__) console.log('[Profile] reading AsyncStorage keys:', profileKey, photoKey);

      const [raw, cachedPhotoUrl] = await Promise.all([
        AsyncStorage.getItem(profileKey).catch(() => null),
        AsyncStorage.getItem(photoKey).catch(() => null),
      ]);

      if (raw) {
        try {
          const p = JSON.parse(raw);
          setProfile({
            name:            p.name             || DEFAULT_PROFILE.name,
            username:        p.username         || '',
            badge:           CERT_LABELS[p.certificate] || '',
            homeAirport:     p.home_airport      || '',
            homeAirportName: p.home_airport_name || '',
            aircraft:        p.aircraft_type     || '',
          });
        } catch {}
      }

      // Resolve the profile photo.
      // Priority: valid https:// cached URL → Supabase Storage public URL → null (stock).
      //
      // IMPORTANT: Only call setPhotoUri(null) when we have POSITIVELY CONFIRMED the user
      // has no custom photo (Storage list succeeded and returned 0 files). If the check
      // itself fails (network error, RLS, etc.), leave the existing photoUri state intact
      // so a temporary backend hiccup never replaces a custom photo with the stock image.
      let resolvedPhotoUrl: string | null = null;
      let confirmedNoPhoto = false;

      if (__DEV__) console.log(`[Profile] photo check — user: ${user.id} | cached key: ${photoKey}`);

      if (cachedPhotoUrl && !cachedPhotoUrl.startsWith('file://')) {
        resolvedPhotoUrl = cachedPhotoUrl;
        if (__DEV__) console.log('[Profile] photo → source=AsyncStorage cache url:', resolvedPhotoUrl);
      } else {
        if (cachedPhotoUrl?.startsWith('file://')) {
          if (__DEV__) console.log('[Profile] stale temp file:// URI in cache, discarding…');
          await AsyncStorage.removeItem(photoKey).catch(() => {});
        }
        // Check Supabase Storage for a previously uploaded avatar.
        // No filename filter — versioned uploads are named avatar-<timestamp>.jpg
        // so we list all files and take the most recently named one.
        try {
          const { data: files, error: listError } = await supabase.storage
            .from('profile-photos')
            .list(user.id, { limit: 20 });

          if (listError) {
            // Check failed — we cannot determine if a photo exists. Keep current state.
            if (__DEV__) console.warn('[Profile] Supabase Storage list error (will keep current photoUri):', listError.message);
          } else if (files && files.length > 0) {
            // Sort by name descending — avatar-<timestamp>.jpg names sort correctly by time.
            const avatarFiles = files
              .filter(f => f.name.startsWith('avatar'))
              .sort((a, b) => b.name.localeCompare(a.name));
            const latest = avatarFiles[0];
            if (__DEV__) console.log('[Profile] Storage list found', files.length, 'file(s) | using latest:', latest?.name ?? 'none');
            if (latest) {
              const storagePath = `${user.id}/${latest.name}`;
              const { data: urlData } = supabase.storage
                .from('profile-photos')
                .getPublicUrl(storagePath);
              resolvedPhotoUrl = urlData.publicUrl;
              await AsyncStorage.setItem(photoKey, resolvedPhotoUrl).catch(() => {});
              if (__DEV__) console.log('[Profile] photo → source=Supabase Storage | path:', storagePath, '| url:', resolvedPhotoUrl);
            } else {
              // Files exist but none match avatar prefix — treat as no photo, fall through
              files.length = 0; // reuse the else branch below
            }
          }

          if (!resolvedPhotoUrl && !(files && files.length > 0)) {
            // List returned 0 files. Before treating this as "no photo", check user_metadata
            // for a saved storage path — the list() call can return false-empty due to RLS.
            if (__DEV__) console.log('[Profile] Storage list returned 0 files — checking user_metadata before confirming no photo');
            try {
              const { data: { user: freshUser } } = await supabase.auth.getUser();
              const metaPath = freshUser?.user_metadata?.avatar_url as string | undefined;
              if (__DEV__) console.log('[Profile] user_metadata avatar_url:', metaPath ?? 'none');
              if (metaPath && !metaPath.startsWith('http')) {
                // We have a stored storage path — regenerate public URL from it
                const { data: urlData } = supabase.storage.from('profile-photos').getPublicUrl(metaPath);
                resolvedPhotoUrl = urlData.publicUrl;
                await AsyncStorage.setItem(photoKey, resolvedPhotoUrl).catch(() => {});
                if (__DEV__) console.log('[Profile] photo → source=user_metadata, path:', metaPath, '→ url:', resolvedPhotoUrl);
              } else if (metaPath?.startsWith('http')) {
                // Legacy: a full URL was stored in metadata
                resolvedPhotoUrl = metaPath;
                if (__DEV__) console.log('[Profile] photo → source=user_metadata (legacy url):', resolvedPhotoUrl);
              } else {
                // Both list() AND user_metadata confirm no photo — safe to show stock
                confirmedNoPhoto = true;
                if (__DEV__) console.log('[Profile] photo → source=none (confirmed by both list + metadata)');
              }
            } catch (metaErr: any) {
              // Metadata check failed — keep current state, do not clear photo
              if (__DEV__) console.warn('[Profile] user_metadata check threw, keeping current photoUri:', metaErr?.message);
            }
          }
        } catch (storageErr: any) {
          // Network or unexpected error — don't clear a custom photo over a failed check.
          if (__DEV__) console.warn('[Profile] Supabase Storage check threw (will keep current photoUri):', storageErr?.message ?? storageErr);
        }
      }

      if (resolvedPhotoUrl !== null) {
        if (__DEV__) console.log('[Profile] final render: CUSTOM PHOTO for user:', user.id, 'url:', resolvedPhotoUrl);
        setPhotoUri(resolvedPhotoUrl);
        setProfilePhoto(resolvedPhotoUrl);
      } else if (confirmedNoPhoto) {
        if (__DEV__) console.log('[Profile] final render: STOCK/placeholder — no custom photo confirmed for user:', user.id);
        setPhotoUri(null);
        setProfilePhoto(null);
      } else {
        // Check was inconclusive (error/network failure). Leave existing photoUri intact.
        if (__DEV__) console.log('[Profile] photo check inconclusive — keeping existing photoUri state (not reverting to stock)');
      }

      // Load social counts
      const [followersRes, followingRes] = await Promise.all([
        supabase.from('pilot_follows').select('follower_id', { count: 'exact', head: true }).eq('following_id', user.id),
        supabase.from('pilot_follows').select('following_id', { count: 'exact', head: true }).eq('follower_id', user.id),
      ]);
      const currentFollowers = followersRes.count ?? 0;
      setFollowerCount(currentFollowers);
      setFollowingCount(followingRes.count ?? 0);

      // Check for new followers since last seen
      try {
        const lastSeenKey = `lastSeenFollowerCount:${user.id}`;
        const lastSeenRaw = await AsyncStorage.getItem(lastSeenKey);
        const lastSeen = lastSeenRaw ? parseInt(lastSeenRaw, 10) : 0;
        const newCount = Math.max(0, currentFollowers - lastSeen);
        setNewFollowerCount(newCount);
        // Don't update lastSeen here — update when user taps the bell
      } catch {}

      // Load home airport from saved profile so we can exclude it from stats
      let homeIcao = '';
      try {
        const rawProfile = await AsyncStorage.getItem(`userProfile:${user.id}`);
        if (rawProfile) {
          const savedProfile = JSON.parse(rawProfile);
          homeIcao = (savedProfile.home_airport ?? '').toUpperCase();
        }
      } catch {}

      // Load live stats from Supabase using the real signed-in user's ID
      let visitedQuery = supabase
        .from('visited_airports')
        .select('icao, state, lat, lng')
        .eq('user_id', user.id);
      let recentQuery = supabase
        .from('visited_airports')
        .select('icao, name, city, state, lat, lng, visited_at')
        .eq('user_id', user.id)
        .order('visited_at', { ascending: false })
        .limit(3);
      if (homeIcao) {
        visitedQuery = visitedQuery.neq('icao', homeIcao);
        recentQuery = recentQuery.neq('icao', homeIcao);
      }

      const [visitedRes, bucketRes, recentRes] = await Promise.all([
        visitedQuery,
        supabase
          .from('bucket_list')
          .select('icao', { count: 'exact', head: true })
          .eq('user_id', user.id),
        recentQuery,
      ]);
      setRecentFlights(recentRes.data ?? []);

      const rows = visitedRes.data ?? [];
      if (__DEV__) console.log('[Profile] visited rows:', rows.length, '| bucket count:', bucketRes.count);
      const uniqueAirports = new Set(rows.map((r: any) => r.icao)).size;
      const uniqueStates   = new Set(rows.filter((r: any) => r.state).map((r: any) => r.state)).size;
      const totalFlights   = rows.length;
      const bucketCount    = bucketRes.count ?? 0;
      // Resolve home airport coords and cruise speed from saved profile
      let estHours: string = '—';
      let homeLat = HOME_LAT;
      let homeLng = HOME_LNG;
      let cruiseKts = 120;
      try {
        const raw = await AsyncStorage.getItem(`userProfile:${user.id}`);
        if (raw) {
          const savedProfile = JSON.parse(raw);
          if (savedProfile.cruise_speed) cruiseKts = Math.max(1, Number(savedProfile.cruise_speed));
          const resolvedHome = homeIcao || (savedProfile.home_airport ?? '').toUpperCase();
          if (resolvedHome) {
            const homeApt = (airportsData as any[]).find(
              (a: any) => (a.icao || a.faa || a.id)?.toUpperCase() === resolvedHome
            );
            if (homeApt?.lat && homeApt?.lng) { homeLat = homeApt.lat; homeLng = homeApt.lng; }
          }
        }
      } catch {}

      const totalNm = Math.round(
        rows
          .filter((r: any) => r.lat != null && r.lng != null)
          .reduce((sum: number, r: any) => sum + getDistanceNm(homeLat, homeLng, r.lat, r.lng), 0)
      );
      const hrs = totalNm > 0 ? Math.round(totalNm / cruiseKts) : 0;
      if (hrs > 0) estHours = `~${hrs} hrs`;

      setStats([
        { value: String(uniqueAirports), label: 'Airports Visited' },
        { value: String(bucketCount),     label: 'Bucket List' },
        { value: estHours,                label: 'Flight Hours' },
        { value: `${totalNm} nm`,         label: 'Total NM Flown' },
      ]);

      // Check food/golf badge eligibility against visited airports cache
      const visitedIcaos = rows.map((r: any) => r.icao);
      let hasFoodVisit = false;
      let hasGolfVisit = false;
      if (visitedIcaos.length > 0) {
        const { data: cacheCheck } = await supabase
          .from('airport_places_cache')
          .select('airport_icao, category')
          .in('airport_icao', visitedIcaos)
          .in('category', ['restaurants', 'golf'])
          .limit(2);
        hasFoodVisit = (cacheCheck ?? []).some((r: any) => r.category === 'restaurants');
        hasGolfVisit = (cacheCheck ?? []).some((r: any) => r.category === 'golf');
      }
      // Fallback: also check static airport data for food/golf nearby
      if (!hasFoodVisit) {
        hasFoodVisit = rows.some((r: any) => {
          const apt = (airportsData as any[]).find((a: any) => (a.icao || a.faa || a.id) === r.icao);
          return apt?.nearestFoodNm != null && apt.nearestFoodNm <= 3;
        });
      }
      if (!hasGolfVisit) {
        hasGolfVisit = rows.some((r: any) => {
          const apt = (airportsData as any[]).find((a: any) => (a.icao || a.faa || a.id) === r.icao);
          return apt?.nearestGolfNm != null;
        });
      }

      // Compute streak first so it can go in badge context
      const flightDates = rows.map((r: any) => new Date(r.visited_at ?? r.created_at).getTime());
      const now = new Date();
      const dayOfWeek = now.getDay();
      const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      const thisMonday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - mondayOffset);
      thisMonday.setHours(0, 0, 0, 0);
      const weekMs = 7 * 24 * 60 * 60 * 1000;
      let streak = 0;
      for (let w = 0; w < 52; w++) {
        const weekStart = thisMonday.getTime() - w * weekMs;
        const weekEnd = weekStart + weekMs;
        if (flightDates.some((d: number) => d >= weekStart && d < weekEnd)) streak++;
        else break;
      }
      if (__DEV__) console.log('[Streak] flights:', flightDates.length, '| streak:', streak, 'weeks');
      setStreakWeeks(streak);

      // Check dog-friendly and hotel visits from static data
      let hasDogVisit = false;
      let hasHotelVisit = false;
      try {
        const { data: dogCheck } = await supabase
          .from('dog_friendly_airports')
          .select('airport_icao')
          .in('airport_icao', visitedIcaos)
          .limit(1);
        hasDogVisit = (dogCheck ?? []).length > 0;
      } catch {}
      hasHotelVisit = rows.some((r: any) => {
        const apt = (airportsData as any[]).find((a: any) => (a.icao || a.faa || a.id) === r.icao);
        return apt?.nearestHotelNm != null && apt.nearestHotelNm <= 3;
      });

      // Longest flight distance — reuse homeLat/homeLng from earlier in this function
      let longestNm = 0;
      for (const r of rows) {
        const apt = (airportsData as any[]).find((a: any) => (a.icao || a.faa || a.id) === r.icao);
        if (apt?.lat && apt?.lng) {
          const R = 3440.065;
          const dLat = (apt.lat - homeLat) * Math.PI / 180;
          const dLng = (apt.lng - homeLng) * Math.PI / 180;
          const aa = Math.sin(dLat / 2) ** 2 + Math.cos(homeLat * Math.PI / 180) * Math.cos(apt.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
          const nm = Math.round(R * 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa)));
          if (nm > longestNm) longestNm = nm;
        }
      }

      // Report count — query directly since setMyReviews state hasn't updated yet
      let reportCount = 0;
      try {
        const { count } = await supabase.from('airport_reviews').select('id', { count: 'exact', head: true }).eq('user_id', user.id);
        reportCount = count ?? 0;
      } catch {}

      // Count bucket list airports that have been visited
      let bucketVisited = 0;
      try {
        const { data: bucketItems } = await supabase.from('bucket_list').select('icao').eq('user_id', user.id);
        const bucketIcaos = new Set((bucketItems ?? []).map((b: any) => b.icao));
        bucketVisited = [...visitedIcaos].filter(ic => bucketIcaos.has(ic)).length;
      } catch {}

      const ctx: BadgeCtx = {
        airports: uniqueAirports, states: uniqueStates, flights: totalFlights,
        hasFoodVisit, hasGolfVisit, hasDogVisit, hasHotelVisit,
        longestNm, reportCount, followingCount, streakWeeks: streak,
        bucketCount, bucketVisited,
      };
      setBadgeCtx(ctx);
      const earned = BADGE_DEFS.filter(b => b.fn(ctx));
      const locked = BADGE_DEFS.filter(b => !b.fn(ctx));
      if (__DEV__) {
        console.log('[Profile:badges] user id:', user.id);
        console.log('[Profile:badges] flights:', totalFlights, '| airports:', uniqueAirports, '| states:', uniqueStates);
        console.log('[Profile:badges] hasFoodVisit:', hasFoodVisit, '| hasGolfVisit:', hasGolfVisit);
        console.log('[Profile:badges] definitions loaded:', BADGE_DEFS.map(b => b.title));
        console.log('[Profile:badges] earned:', earned.map(b => b.title));
        console.log('[Profile:badges] locked:', locked.map(b => b.title));
        earned.forEach(b => console.log('[Profile:badges] unlock reason —', b.title));
      }
      setEarnedBadges(earned.map(b => ({ iconKey: b.iconKey, title: b.title, difficulty: b.difficulty })));

      // Fetch user's airport reviews
      try {
        const { data: reviews } = await supabase
          .from('airport_reviews')
          .select('airport_icao, courtesy_car, fuel_available, fuel_price, fbo_rating, visit_reason, notes, created_at')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(10);
        setMyReviews(reviews ?? []);
      } catch {}

      // Fetch user's recent activity (flights + reviews + bucket list)
      try {
        const [flightsRes, reviewsRes, bucketRes] = await Promise.all([
          supabase.from('visited_airports').select('icao, name, state, visited_at')
            .eq('user_id', user.id).order('visited_at', { ascending: false }).limit(10),
          supabase.from('airport_reviews').select('airport_icao, visit_reason, created_at')
            .eq('user_id', user.id).order('created_at', { ascending: false }).limit(10),
          supabase.from('bucket_list').select('icao, name, created_at')
            .eq('user_id', user.id).order('created_at', { ascending: false }).limit(5),
        ]);
        const items: any[] = [];
        for (const f of (flightsRes.data ?? [])) items.push({ type: 'flight', icao: f.icao, label: f.name, ts: f.visited_at });
        for (const r of (reviewsRes.data ?? [])) items.push({ type: 'review', icao: r.airport_icao, label: r.visit_reason?.replace('_', ' ') ?? 'report', ts: r.created_at });
        for (const b of (bucketRes.data ?? [])) items.push({ type: 'bucket', icao: b.icao, label: b.name, ts: b.created_at });
        items.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
        // Dedupe: skip same type+icao within 5 minutes
        const deduped: any[] = [];
        for (const item of items) {
          const dup = deduped.find(d => d.type === item.type && d.icao === item.icao &&
            Math.abs(new Date(d.ts).getTime() - new Date(item.ts).getTime()) < 5 * 60 * 1000);
          if (!dup) deduped.push(item);
        }
        setMyActivity(deduped.slice(0, 15));
      } catch {}
    }
    fetchAll();
  }, [user])); // user in deps: if auth resolves after mount, this re-runs with the real user

  function handleDeleteAccount() {
    Alert.alert(
      'Delete Account',
      'This will permanently delete your account, flights, bucket list, and all your data. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete My Account', style: 'destructive', onPress: confirmDeleteAccount },
      ],
    );
  }

  async function confirmDeleteAccount() {
    if (!user) return;
    setDeletingAccount(true);
    try {
      // refreshSession() forces a server-side token refresh — getSession() only
      // returns the cached local session which may contain an expired JWT.
      const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
      const token = refreshData?.session?.access_token;
      if (__DEV__) {
        console.log('[DeleteAccount] refresh error:', refreshError?.message ?? 'none');
        console.log('[DeleteAccount] token exists:', !!token, token ? `| starts: ${token.slice(0, 10)}… ends: …${token.slice(-10)}` : '');
      }
      if (refreshError || !token) throw new Error('Session expired — please sign in again.');

      const res = await fetch(`${SUPABASE_URL}/functions/v1/delete-account`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      let body: any = null;
      const rawText = await res.text();
      if (__DEV__) console.log('[DeleteAccount] status:', res.status, '| raw:', rawText.slice(0, 300));
      try { body = JSON.parse(rawText); } catch {}

      if (!res.ok) {
        const msg = body?.error ?? body?.msg ?? `Server error ${res.status}`;
        const stage = body?.stage ?? 'unknown';
        if (__DEV__) console.error('[DeleteAccount] failed — stage:', stage, '| error:', msg);
        throw new Error(msg);
      }

      await supabase.auth.signOut();
      router.replace('/welcome');
    } catch (e: any) {
      setDeletingAccount(false);
      if (__DEV__) console.error('[DeleteAccount] catch:', e?.message);
      Alert.alert('Error', e?.message ?? 'Could not delete account. Please try again.');
    }
  }

  const ACTION_ROWS = [
    [
      { icon: <MaterialCommunityIcons name="trophy-outline" size={18} color="#FBBF24" />, title: 'Achievements', subtitle: 'Track your flying milestones', onPress: () => router.push('/achievements') },
      { icon: <MaterialCommunityIcons name="map-marker-path" size={18} color="#38BDF8" />, title: 'My Adventures', subtitle: "Places you've flown", onPress: () => router.push('/adventures') },
    ],
  ];


  return (
    <BackgroundWrapper>
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      <View style={styles.titleRow}>
        <Text style={styles.screenTitle}>Pilot Profile</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <TouchableOpacity
            onPress={async () => {
              // Mark followers as seen
              if (user?.id) {
                await AsyncStorage.setItem(`lastSeenFollowerCount:${user.id}`, String(followerCount));
                setNewFollowerCount(0);
              }
              router.push({ pathname: '/notifications' as any });
            }}
            style={styles.gearBtn}
            activeOpacity={0.7}
          >
            <Feather name="bell" size={20} color={newFollowerCount > 0 ? '#FBBF24' : '#6B83A0'} />
            {newFollowerCount > 0 && (
              <View style={styles.notifBadge}>
                <Text style={styles.notifBadgeText}>{newFollowerCount}</Text>
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push('/settings')} style={styles.gearBtn} activeOpacity={0.7}>
            <Feather name="settings" size={22} color="#6B83A0" />
          </TouchableOpacity>
        </View>
      </View>

      <ProfileHeader
        name={profile.name}
        username={profile.username}
        badge={profile.badge}
        rank={getPilotRank(parseInt(stats[0].value as string) || 0)}
        homeAirport={profile.homeAirport}
        homeAirportName={profile.homeAirportName}
        aircraft={profile.aircraft}
        photoUri={photoUri}
        onPhotoPress={pickPhoto}
        airportsVisited={stats[0].value as string}
        bucketListCount={stats[1].value as string}
        followingCount={followingCount}
        followerCount={followerCount}
        onFollowersPress={() => router.push({ pathname: '/follow-list', params: { mode: 'followers' } })}
        onFollowingPress={() => router.push({ pathname: '/follow-list', params: { mode: 'following' } })}
      />

      {/* Action card rows — Achievements + My Adventures */}
      {ACTION_ROWS.map((row, rowIdx) => (
        <View key={rowIdx} style={styles.cardRow}>
          {row.map((item, i) => (
            <ProfileSectionCard
              key={i}
              icon={item.icon}
              title={item.title}
              subtitle={item.subtitle}
              onPress={item.onPress}
            />
          ))}
        </View>
      ))}

      {/* Flying Streak */}
      {streakWeeks > 0 ? (
        <View style={styles.streakCard}>
          <View style={styles.streakIconWrap}>
            <MaterialCommunityIcons name={streakWeeks >= 4 ? 'fire' : 'airplane-takeoff'} size={20} color="#FBBF24" />
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
              <Text style={styles.streakValue}>{streakWeeks}</Text>
              <Text style={styles.streakUnit}>week{streakWeeks !== 1 ? 's' : ''} flying</Text>
            </View>
            <Text style={styles.streakSub}>Keep the streak alive this weekend</Text>
          </View>
          {streakWeeks >= 4 && (
            <View style={styles.streakBadge}>
              <MaterialCommunityIcons name="shield-star" size={14} color="#FBBF24" />
            </View>
          )}
        </View>
      ) : badgeCtx.flights > 0 ? (
        <View style={styles.streakCardEmpty}>
          <View style={styles.streakIconWrapEmpty}>
            <MaterialCommunityIcons name="airplane-takeoff" size={18} color="#4A5B73" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.streakValueEmpty}>Start your streak</Text>
            <Text style={styles.streakSub}>Log a flight this weekend to begin</Text>
          </View>
        </View>
      ) : null}

      {/* Achievement Badges — earned first, then closest to completion */}
      <View style={styles.badgesSection}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, marginBottom: 10 }}>
          <Text style={[styles.badgesTitle, { marginBottom: 0 }]}>ACHIEVEMENTS  <Text style={{ color: '#C4611A', fontWeight: '800' }}>{earnedBadges.length}<Text style={{ color: '#4A5B73', fontWeight: '600' }}>/{BADGE_DEFS.length}</Text></Text></Text>
          <TouchableOpacity onPress={() => router.push('/achievements')} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }} activeOpacity={0.7}>
            <Text style={{ fontSize: 12, fontWeight: '600', color: '#38BDF8' }}>View All</Text>
            <Feather name="arrow-right" size={12} color="#38BDF8" />
          </TouchableOpacity>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.badgesRow}
        >
          {/* Sort: earned first, then by progress % descending */}
          {[...BADGE_DEFS].sort((a, b) => {
            const aEarned = a.fn(badgeCtx) ? 1 : 0;
            const bEarned = b.fn(badgeCtx) ? 1 : 0;
            if (aEarned !== bEarned) return bEarned - aEarned;
            const aProg = a.progress(badgeCtx);
            const bProg = b.progress(badgeCtx);
            const aPct = aProg.total > 0 ? aProg.current / aProg.total : 0;
            const bPct = bProg.total > 0 ? bProg.current / bProg.total : 0;
            return bPct - aPct;
          }).slice(0, 8).map((def, i) => {
            const earned = earnedBadges.some(e => e.title === def.title);
            const color  = BADGE_COLORS[def.difficulty];
            const prog = def.progress(badgeCtx);
            const pct = prog.total > 0 ? Math.min(prog.current / prog.total, 1) : 0;
            return (
              <TouchableOpacity key={i} activeOpacity={0.7}
                onPress={() => router.push({
                  pathname: '/achievement-detail' as any,
                  params: {
                    title: def.title,
                    hint: def.hint,
                    iconKey: def.iconKey,
                    difficulty: def.difficulty,
                    earned: earned ? 'true' : 'false',
                    current: String(prog.current),
                    total: String(prog.total),
                  },
                })}
              >
                {earned ? (
                  <View style={[styles.badgeCard, { borderColor: color + '44', backgroundColor: '#0A1220' }]}>
                    <View style={[styles.badgeRibbon, { backgroundColor: color }]} />
                    <BadgeIcon iconKey={def.iconKey} size={22} color={color} />
                    <Text style={styles.badgeTitle}>{def.title}</Text>
                    <Text style={[styles.badgeEarnedLabel, { color }]}>EARNED</Text>
                  </View>
                ) : (
                  <View style={[styles.badgeCard, styles.badgeCardLocked]}>
                    <View style={{ opacity: 0.3 }}>
                      <BadgeIcon iconKey={def.iconKey} size={22} color="#6B83A0" />
                    </View>
                    <Text style={styles.badgeTitleLocked}>{def.title}</Text>
                    <View style={styles.progressBarBg}>
                      <View style={[styles.progressBarFill, { width: `${Math.max(pct * 100, 4)}%`, backgroundColor: color }]} />
                    </View>
                    <Text style={styles.progressText}>{prog.current}/{prog.total}</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Pilot's Logbook — unified timeline of flights, reports, saves */}
      <View style={styles.recentSection}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <MaterialCommunityIcons name="book-open-variant" size={14} color="#6B83A0" />
            <Text style={[styles.recentTitle, { marginBottom: 0 }]}>PILOT'S LOGBOOK</Text>
          </View>
          {myActivity.length > 3 && (
            <TouchableOpacity
              onPress={() => router.push('/my-activity' as any)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
              activeOpacity={0.7}
            >
              <Text style={{ fontSize: 12, fontWeight: '600', color: '#38BDF8' }}>View All</Text>
              <Feather name="arrow-right" size={12} color="#38BDF8" />
            </TouchableOpacity>
          )}
        </View>
        {myActivity.length === 0 ? (
          <View style={styles.emptyLogbook}>
            <MaterialCommunityIcons name="airplane-takeoff" size={28} color="#2A3A52" />
            <Text style={styles.recentEmpty}>Your logbook is empty</Text>
            <Text style={{ fontSize: 12, color: '#3A4A5F', textAlign: 'center' }}>Fly somewhere and tap "I've flown here" to start logging</Text>
          </View>
        ) : (
          <View style={styles.logbookCard}>
            {myActivity.slice(0, 3).map((item, i) => (
              <TouchableOpacity
                key={`${item.type}-${item.icao}-${i}`}
                style={[styles.activityRow, i < Math.min(myActivity.length, 3) - 1 && styles.activityRowBorder]}
                onPress={() => goToAirport({ icao: item.icao })}
                activeOpacity={0.7}
              >
                <View style={[styles.activityIconWrap, {
                  backgroundColor: item.type === 'flight' ? 'rgba(56,189,248,0.08)' :
                    item.type === 'bucket' ? 'rgba(251,191,36,0.08)' : 'rgba(13,148,136,0.08)',
                }]}>
                  <MaterialCommunityIcons
                    name={item.type === 'flight' ? 'airplane' : item.type === 'bucket' ? 'star-outline' : 'clipboard-text-outline'}
                    size={14}
                    color={item.type === 'flight' ? '#38BDF8' : item.type === 'bucket' ? '#FBBF24' : '#0D9488'}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.activityText}>
                    {item.type === 'flight' ? 'Flew to' : item.type === 'bucket' ? 'Saved' : 'Reported on'}{' '}
                    <Text style={styles.activityIcao}>{item.icao}</Text>
                  </Text>
                  {item.label && item.type !== 'bucket' && (
                    <Text style={styles.activityLabel}>{item.label}</Text>
                  )}
                </View>
                <Text style={styles.activityTime}>
                  {new Date(item.ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      {/* Delete Account — required by Apple guideline 5.1.1(v) */}
      {user && (
        <TouchableOpacity
          style={[styles.deleteAccountBtn, deletingAccount && { opacity: 0.5 }]}
          onPress={handleDeleteAccount}
          disabled={deletingAccount}
          activeOpacity={0.7}
        >
          <Feather name="trash-2" size={14} color="#EF4444" />
          <Text style={styles.deleteAccountTxt}>
            {deletingAccount ? 'Deleting account…' : 'Delete Account'}
          </Text>
        </TouchableOpacity>
      )}

    </ScrollView>
    </BackgroundWrapper>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 60,
    paddingBottom: 40,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  screenTitle: {
    flex: 1,
    fontSize: 28,
    fontWeight: '700',
    color: '#F0F4FF',
  },
  gearBtn: { padding: 6, position: 'relative' },
  notifBadge: {
    position: 'absolute', top: 0, right: 0,
    backgroundColor: '#EF4444', borderRadius: 8, minWidth: 16, height: 16,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
  },
  notifBadgeText: { fontSize: 9, fontWeight: '800', color: '#FFFFFF' },
  gearIcon: { fontSize: 22 },
  cardRow: {
    flexDirection: 'row',
    gap: 12,
    marginHorizontal: 16,
    marginBottom: 12,
  },
  settingsSection: {
    marginTop: 12,
    marginHorizontal: 16,
    marginBottom: 16,
  },
  settingsTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6B83A0',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  settingsCard: {
    backgroundColor: '#0D1421',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#1E3A5F',
    overflow: 'hidden',
  },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 18,
    gap: 14,
  },
  settingsRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: '#1E3A5F',
  },
  settingsIcon: {
    fontSize: 18,
    width: 24,
    textAlign: 'center',
  },
  settingsLabel: {
    flex: 1,
    fontSize: 15,
    color: '#C8D8EE',
    fontWeight: '500',
  },
  settingsChevron: {
    fontSize: 22,
    color: '#6B83A0',
    fontWeight: '300',
    lineHeight: 24,
  },
  // Streak
  streakCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginHorizontal: 20, marginBottom: 16, padding: 14,
    backgroundColor: 'rgba(251,191,36,0.06)', borderRadius: 14,
    borderWidth: 1, borderColor: 'rgba(251,191,36,0.18)',
  },
  streakCardEmpty: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginHorizontal: 20, marginBottom: 16, padding: 14,
    backgroundColor: 'rgba(255,255,255,0.02)', borderRadius: 14,
    borderWidth: 1, borderColor: '#1A2535',
  },
  streakValueEmpty: { fontSize: 14, fontWeight: '700', color: '#5C7A96' },
  streakIconWrap: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(251,191,36,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  streakIconWrapEmpty: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center', justifyContent: 'center',
  },
  streakValue: { fontSize: 24, fontWeight: '900', color: '#FBBF24', fontVariant: ['tabular-nums'] as any },
  streakUnit: { fontSize: 13, fontWeight: '600', color: '#A08930' },
  streakSub: { fontSize: 11, color: '#6B5D30', marginTop: 1 },
  streakBadge: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: 'rgba(251,191,36,0.10)',
    alignItems: 'center', justifyContent: 'center',
  },

  // Progress bar
  progressBarBg: {
    width: '100%', height: 4, borderRadius: 2,
    backgroundColor: '#1A2535', marginTop: 6, overflow: 'hidden',
  },
  progressBarFill: { height: 4, borderRadius: 2 },
  progressText: { fontSize: 9, color: '#4A5B73', fontWeight: '600', marginTop: 3, textAlign: 'center' },

  badgesSection: {
    marginHorizontal: 16,
    marginBottom: 16,
  },
  badgesTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6B83A0',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  badgesRow: {
    gap: 10,
    paddingBottom: 4,
    paddingHorizontal: 4,
  },
  badgeCard: {
    width: 140,
    backgroundColor: '#080F1C',
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    paddingTop: 16,
    gap: 5,
    overflow: 'hidden',
  },
  badgeCardLocked: {
    borderColor: '#141E2C',
    opacity: 0.45,
  },
  badgeRibbon: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: '#FF4D00',
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
  },
  badgeIcon: {
    fontSize: 24,
  },
  badgeTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#C8D8EE',
    lineHeight: 14,
  },
  badgeEarnedLabel: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1,
    marginTop: 1,
  },
  badgeTitleLocked: {
    fontSize: 11,
    fontWeight: '600',
    color: '#4A5F77',
    lineHeight: 14,
  },
  badgeReq: {
    fontSize: 10,
    color: '#4A5F77',
    lineHeight: 13,
    marginTop: 1,
  },
  signOutLabel: {
    color: '#F87171',
  },
  deleteAccountBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginHorizontal: 40,
    marginTop: 16,
    marginBottom: 40,
    paddingVertical: 12,
    borderRadius: 10,
  },
  deleteAccountTxt: {
    fontSize: 13,
    fontWeight: '500',
    color: '#7A5555',
  },

  // Follow counts
  socialRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 20,
    backgroundColor: '#0D1421',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1E3A5F',
    paddingVertical: 14,
  },
  socialStat: { flex: 1, alignItems: 'center' },
  socialNum: { fontSize: 20, fontWeight: '800', color: '#F0F4FF', marginBottom: 2 },
  socialLbl: { fontSize: 11, color: '#6B83A0', fontWeight: '600', letterSpacing: 0.5 },
  socialDivider: { width: 1, height: 28, backgroundColor: '#1E3A5F' },

  // Public toggle
  toggleTrack: {
    width: 44, height: 26, borderRadius: 13,
    backgroundColor: '#1E2D45',
    justifyContent: 'center', paddingHorizontal: 3,
  },
  toggleTrackOn: { backgroundColor: '#38BDF8' },
  toggleThumb: {
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: '#fff', alignSelf: 'flex-start',
  },
  toggleThumbOn: { alignSelf: 'flex-end' },

  // App Info modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: '#0D1421', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 44, borderTopWidth: 1, borderColor: '#1E2D45' },
  modalHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#1E2D45', alignSelf: 'center', marginBottom: 20 },
  modalAppName: { fontSize: 22, fontWeight: '800', color: '#F0F4FF', textAlign: 'center', marginBottom: 4 },
  modalVersion: { fontSize: 13, color: '#38BDF8', textAlign: 'center', fontWeight: '600', marginBottom: 16 },
  modalDesc: { fontSize: 14, color: '#C8D8EE', textAlign: 'center', lineHeight: 22, marginBottom: 20 },
  modalDivider: { height: 1, backgroundColor: '#1E2D45', marginBottom: 16 },
  modalRow: { fontSize: 14, color: '#C8D8EE', marginBottom: 10 },
  modalCloseBtn: { marginTop: 20, backgroundColor: '#1E2D45', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  modalCloseBtnText: { fontSize: 15, fontWeight: '600', color: '#F0F4FF' },
  recentSection: {
    marginHorizontal: 16,
    marginBottom: 16,
  },
  recentTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6B83A0',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  emptyLogbook: {
    alignItems: 'center',
    paddingVertical: 28,
    paddingHorizontal: 20,
    gap: 8,
    backgroundColor: '#080F1C',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#182C44',
  },
  recentEmpty: {
    fontSize: 14,
    color: '#5C7A96',
    fontWeight: '600',
  },
  logbookCard: {
    backgroundColor: '#080F1C',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#182C44',
    overflow: 'hidden',
  },
  reviewCard: {
    backgroundColor: 'rgba(10,18,36,0.97)', borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)',
  },
  reviewCardHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8,
  },
  reviewIcao: { fontSize: 15, fontWeight: '700', color: '#38BDF8' },
  reviewDate: { fontSize: 11, color: '#4A5B73' },
  reviewChipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 4 },
  reviewChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  reviewChipText: { fontSize: 11, color: '#8A9BB5', fontWeight: '500', textTransform: 'capitalize' },
  reviewNotePreview: { fontSize: 13, color: '#6B83A0', lineHeight: 19, marginTop: 6 },
  activityRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 13, paddingHorizontal: 14,
  },
  activityRowBorder: { borderBottomWidth: 1, borderBottomColor: '#141E2C' },
  activityIconWrap: {
    width: 32, height: 32, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  activityText: { fontSize: 14, color: '#C8D8EE', fontWeight: '500' },
  activityIcao: { fontWeight: '800', color: '#C4611A', letterSpacing: 0.5 },
  activityLabel: { fontSize: 11, color: '#4A5B73', marginTop: 1, textTransform: 'capitalize' },
  activityTime: { fontSize: 11, color: '#3E5269', fontWeight: '500', fontVariant: ['tabular-nums'] as any },
  usernameText: {
    fontSize: 13, color: '#6B83A0', fontWeight: '500',
    textAlign: 'center', marginTop: -8, marginBottom: 10,
  },
});
