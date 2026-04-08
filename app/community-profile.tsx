/**
 * app/community-profile.tsx
 *
 * Public view of another pilot's profile.
 * Navigate here from anywhere with:
 *   router.push({ pathname: '/community-profile', params: { userId, displayName } })
 *
 * Mirrors the own Profile tab structure, adapted for viewer mode:
 *   - Photo + stats row (airports primary, social secondary)
 *   - Identity: name · @handle · cert · rank · detail line
 *   - Follow CTA (replaces edit/camera controls)
 *   - Achievement badges (horizontal scroll)
 *   - Flights & Destinations (cinematic flight cards)
 */

import { useFocusEffect } from '@react-navigation/native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons, Feather } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import BackgroundWrapper from '../components/BackgroundWrapper';
import SignInPrompt from '../components/SignInPrompt';
import { Colors, Surfaces, Radius } from '../constants/theme';
import { GOOGLE_KEY } from '../utils/config';

const CERT_LABELS: Record<string, string> = {
  student:    'Student Pilot',
  private:    'Private Pilot',
  instrument: 'Instrument Rated',
  commercial: 'Commercial Pilot',
  atp:        'ATP',
  cfi:        'CFI',
};

// ── Badge system — mirrors profile.tsx thresholds ─────────────────────────────
interface BadgeCtx { airports: number; states: number; flights: number; }

function BadgeIcon({ iconKey, size, color }: { iconKey: string; size: number; color: string }) {
  if (iconKey === 'landing')  return <MaterialCommunityIcons name="airplane-landing" size={size} color={color} />;
  if (iconKey === 'airplane') return <MaterialCommunityIcons name="airplane" size={size} color={color} />;
  if (iconKey === 'map')      return <Feather name="map" size={size} color={color} />;
  if (iconKey === 'globe')    return <MaterialCommunityIcons name="earth" size={size} color={color} />;
  if (iconKey === 'award')    return <Feather name="award" size={size} color={color} />;
  return null;
}

const BADGE_DEFS: Array<{
  iconKey: string; title: string; difficulty: string; requirement: string;
  fn: (ctx: BadgeCtx) => boolean;
}> = [
  { iconKey: 'landing',  title: 'First 5 Airports',  difficulty: 'easy',   requirement: 'Log 5 different airports',     fn: (c) => c.airports >= 5 },
  { iconKey: 'airplane', title: 'First 10 Airports', difficulty: 'medium', requirement: 'Log 10 different airports',    fn: (c) => c.airports >= 10 },
  { iconKey: 'map',      title: '5 States Flown',    difficulty: 'medium', requirement: 'Fly to 5 different states',    fn: (c) => c.states >= 5 },
  { iconKey: 'globe',    title: '20 Airports',        difficulty: 'hard',   requirement: 'Visit 20 different airports', fn: (c) => c.airports >= 20 },
  { iconKey: 'award',    title: 'Serious Explorer',   difficulty: 'hard',   requirement: '25 or more total flights',    fn: (c) => c.flights >= 25 },
];

const BADGE_COLORS: Record<string, string> = {
  easy: '#38BDF8', medium: '#F59E0B', hard: '#A855F7',
};

function getPilotRank(airports: number): string {
  if (airports >= 100) return 'Airport Collector';
  if (airports >= 50)  return 'Sky Nomad';
  if (airports >= 25)  return 'Adventure Pilot';
  if (airports >= 10)  return 'Cross-Country Explorer';
  if (airports >= 5)   return 'Local Explorer';
  return 'First Flight';
}

// ── Follow button — Reanimated scale-spring, two visual states ────────────────
function FollowButton({
  isFollowing,
  loading,
  onPress,
}: {
  isFollowing: boolean;
  loading: boolean;
  onPress: () => void;
}) {
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: withSpring(scale.value, { damping: 22, stiffness: 300 }) }],
  }));

  return (
    <Pressable
      onPressIn ={() => { scale.value = 0.97; }}
      onPressOut={() => { scale.value = 1; }}
      onPress   ={onPress}
      disabled  ={loading}
    >
      <Animated.View style={[s.followBtn, isFollowing && s.followBtnActive, animStyle]}>
        <View style={s.followBtnHighlight} pointerEvents="none" />
        <Text style={[s.followBtnTxt, isFollowing && s.followBtnTxtActive]}>
          {loading ? '…' : isFollowing ? '✓  Following' : '+  Follow Pilot'}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

export default function CommunityProfileScreen() {
  const { userId, displayName } = useLocalSearchParams<{ userId: string; displayName: string }>();
  const { user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [profile, setProfile]               = useState<any>(null);
  const [photoUrl, setPhotoUrl]             = useState<string | null>(null);
  const [recentVisits, setRecentVisits]     = useState<any[]>([]);
  const [pilotActivity, setPilotActivity]   = useState<any[]>([]);
  const [airportCount, setAirportCount]     = useState(0);
  const [followerCount, setFollowerCount]   = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [earnedBadges, setEarnedBadges]     = useState<{ iconKey: string; title: string; difficulty: string }[]>([]);
  const [isFollowing, setIsFollowing]       = useState(false);
  const [loading, setLoading]               = useState(true);
  const [followLoading, setFollowLoading]   = useState(false);
  const [isPrivate, setIsPrivate]           = useState(false);
  const [signInPrompt, setSignInPrompt]     = useState(false);

  const isOwnProfile = user?.id === userId;

  useFocusEffect(useCallback(() => {
    if (!userId) return;
    loadProfile();
  }, [userId]));

  async function loadProfile() {
    setLoading(true);
    try {
      // ── Pilot profile ────────────────────────────────────────────────────
      const { data: p } = await supabase
        .from('pilot_profiles')
        .select('name, username, certificate, home_airport, aircraft_type, is_public')
        .eq('user_id', userId)
        .single();

      if (p?.is_public === false && !isOwnProfile) {
        setIsPrivate(true);
        setLoading(false);
        return;
      }
      setProfile(p);

      // ── Profile photo ────────────────────────────────────────────────────
      const { data: files } = await supabase.storage
        .from('profile-photos')
        .list(userId, { limit: 20 });
      if (files && files.length > 0) {
        const avatarFiles = files
          .filter(f => f.name.startsWith('avatar'))
          .sort((a, b) => b.name.localeCompare(a.name));
        if (avatarFiles[0]) {
          const { data: urlData } = supabase.storage
            .from('profile-photos')
            .getPublicUrl(`${userId}/${avatarFiles[0].name}`);
          setPhotoUrl(urlData.publicUrl);
        }
      }

      // ── Visit stats + social counts ───────────────────────────────────────
      const [visitedRes, recentRes, followersRes, followingRes] = await Promise.all([
        supabase
          .from('visited_airports')
          .select('icao, state')
          .eq('user_id', userId),
        supabase
          .from('visited_airports')
          .select('icao, name, city, state, lat, lng, visited_at')
          .eq('user_id', userId)
          .order('visited_at', { ascending: false })
          .limit(5),
        supabase
          .from('pilot_follows')
          .select('follower_id', { count: 'exact', head: true })
          .eq('following_id', userId),
        supabase
          .from('pilot_follows')
          .select('following_id', { count: 'exact', head: true })
          .eq('follower_id', userId),
      ]);

      const rows = visitedRes.data ?? [];
      const uniqueAirports = new Set(rows.map((r: any) => r.icao)).size;
      const uniqueStates   = new Set(rows.filter((r: any) => r.state).map((r: any) => r.state)).size;

      setAirportCount(uniqueAirports);
      setRecentVisits(recentRes.data ?? []);
      setFollowerCount(followersRes.count ?? 0);
      setFollowingCount(followingRes.count ?? 0);

      // Load recent activity (flights + reviews)
      try {
        const [actFlights, actReviews] = await Promise.all([
          supabase.from('visited_airports').select('icao, name, state, visited_at')
            .eq('user_id', userId).order('visited_at', { ascending: false }).limit(10),
          supabase.from('airport_reviews').select('airport_icao, visit_reason, created_at')
            .eq('user_id', userId).order('created_at', { ascending: false }).limit(10),
        ]);
        const items: any[] = [];
        for (const f of (actFlights.data ?? [])) items.push({ type: 'flight', icao: f.icao, label: f.name, state: f.state, ts: f.visited_at });
        for (const r of (actReviews.data ?? [])) items.push({ type: 'review', icao: r.airport_icao, label: r.visit_reason?.replace('_', ' ') ?? 'report', ts: r.created_at });
        items.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
        // Dedupe
        const deduped: any[] = [];
        for (const item of items) {
          const dup = deduped.find(d => d.type === item.type && d.icao === item.icao &&
            Math.abs(new Date(d.ts).getTime() - new Date(item.ts).getTime()) < 5 * 60 * 1000);
          if (!dup) deduped.push(item);
        }
        setPilotActivity(deduped.slice(0, 6));
      } catch {}

      // ── Compute badges ───────────────────────────────────────────────────
      const ctx: BadgeCtx = { airports: uniqueAirports, states: uniqueStates, flights: rows.length };
      const earned = BADGE_DEFS.filter(b => b.fn(ctx));
      setEarnedBadges(earned.map(b => ({ iconKey: b.iconKey, title: b.title, difficulty: b.difficulty })));

      // ── Am I already following this pilot? ───────────────────────────────
      if (user && !isOwnProfile && isValidUUID.test(userId ?? '')) {
        const { data: followRow } = await supabase
          .from('pilot_follows')
          .select('follower_id')
          .eq('follower_id', user.id)
          .eq('following_id', userId)
          .maybeSingle();
        setIsFollowing(!!followRow);
      }
    } catch (e) {
      console.warn('[CommunityProfile] load error:', e);
    } finally {
      setLoading(false);
    }
  }

  // UUID format check — pilot_follows requires auth UUIDs, not legacy text IDs
  const isValidUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const canFollow = isValidUUID.test(userId ?? '') && !isOwnProfile;

  async function toggleFollow() {
    if (!user) { setSignInPrompt(true); return; }
    if (!canFollow || followLoading) return;
    setFollowLoading(true);
    if (__DEV__) console.log('[Follow] toggling — current:', isFollowing, '| follower:', user.id, '| following:', userId);
    try {
      if (isFollowing) {
        const { error } = await supabase
          .from('pilot_follows')
          .delete()
          .eq('follower_id', user.id)
          .eq('following_id', userId);
        if (error) {
          if (__DEV__) console.error('[Follow] unfollow error:', error.message, error.code);
        } else {
          setIsFollowing(false);
          setFollowerCount(c => Math.max(0, c - 1));
        }
      } else {
        const { error } = await supabase
          .from('pilot_follows')
          .insert({ follower_id: user.id, following_id: userId });
        if (error) {
          if (__DEV__) console.error('[Follow] follow error:', error.message, error.code);
        } else {
          setIsFollowing(true);
          setFollowerCount(c => c + 1);
        }
      }
    } catch (e) {
      console.warn('[CommunityProfile] follow toggle error:', e);
    } finally {
      setFollowLoading(false);
    }
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <BackgroundWrapper style={{ paddingTop: insets.top }}>
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()}>
          <Text style={s.backTxt}>‹ Back</Text>
        </TouchableOpacity>
        <ActivityIndicator color={Colors.accent.sky} style={{ marginTop: 80 }} />
      </BackgroundWrapper>
    );
  }

  // ── Private ────────────────────────────────────────────────────────────────
  if (isPrivate) {
    return (
      <BackgroundWrapper style={{ paddingTop: insets.top }}>
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()}>
          <Text style={s.backTxt}>‹ Back</Text>
        </TouchableOpacity>
        <View style={s.privateCtr}>
          <Feather name="lock" size={40} color={Colors.text.dim} style={{ marginBottom: 16 }} />
          <Text style={s.privateTitle}>Private Profile</Text>
          <Text style={s.privateMsg}>This pilot has set their profile to private.</Text>
        </View>
      </BackgroundWrapper>
    );
  }

  const certLabel = CERT_LABELS[profile?.certificate] ?? profile?.certificate ?? '';
  const pilotName = profile?.name ?? displayName ?? 'Pilot';
  const rank = getPilotRank(airportCount);

  return (
    <BackgroundWrapper>
      <ScrollView
        style={{ paddingTop: insets.top }}
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Back ──────────────────────────────────────────────────────────── */}
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()}>
          <Text style={s.backTxt}>‹ Back</Text>
        </TouchableOpacity>

        {/* ── Photo + stats row — mirrors ProfileHeader layout ──────────────── */}
        <View style={s.headerBlock}>
          {/* Avatar */}
          <View style={s.photoWrap}>
            <View style={[s.photoRing, !photoUrl && s.photoRingFallback]}>
              {photoUrl ? (
                <Image source={{ uri: photoUrl }} style={s.photo} />
              ) : (
                <View style={s.photoFallback}>
                  <Text style={s.photoInitial}>{pilotName.charAt(0).toUpperCase()}</Text>
                </View>
              )}
            </View>
          </View>

          {/* Stats — aviation-primary (airports) + social secondary */}
          <View style={s.statsRow}>
            <View style={s.statItem}>
              <Text style={s.primaryStatValue}>{airportCount}</Text>
              <Text style={s.statLabel}>AIRPORTS</Text>
            </View>
            <View style={s.statsDivider} />
            <View style={s.statItem}>
              <Text style={s.secondaryStatValue}>{followerCount}</Text>
              <Text style={s.secondaryStatLabel}>FOLLOWERS</Text>
            </View>
            <View style={s.statItem}>
              <Text style={s.secondaryStatValue}>{followingCount}</Text>
              <Text style={s.secondaryStatLabel}>FOLLOWING</Text>
            </View>
          </View>
        </View>

        {/* ── Identity block ────────────────────────────────────────────────── */}
        <View style={s.identity}>
          <Text style={s.name}>{pilotName}</Text>
          {profile?.username ? <Text style={s.usernameHandle}>@{profile.username}</Text> : null}

          <View style={s.badgeRankRow}>
            {certLabel ? <Text style={s.certBadge}>{certLabel}</Text> : null}
            {certLabel ? <Text style={s.dot}> · </Text> : null}
            <Text style={s.rank}>{rank}</Text>
          </View>

          <View style={s.detailRow}>
            {profile?.home_airport ? (
              <View style={s.detailItem}>
                <MaterialCommunityIcons name="home" size={12} color="#6B83A0" />
                <Text style={s.detail}>{profile.home_airport.toUpperCase()}</Text>
              </View>
            ) : null}
            {profile?.aircraft_type ? (
              <View style={s.detailItem}>
                <MaterialCommunityIcons name="airplane" size={12} color="#6B83A0" />
                <Text style={s.detail}>{profile.aircraft_type}</Text>
              </View>
            ) : null}
          </View>

          {/* Follow CTA — primary action, below identity */}
          {canFollow && (
            <View style={s.followWrap}>
              <FollowButton
                isFollowing={isFollowing}
                loading={followLoading}
                onPress={toggleFollow}
              />
            </View>
          )}
        </View>

        {/* ── Earned Achievements ────────────────────────────────────────── */}
        <View style={s.badgesSection}>
          <View style={s.sectionLabelRow}>
            <View style={s.sectionAccent} />
            <Text style={s.sectionLabel}>Achievements</Text>
            {earnedBadges.length > 0 && (
              <Text style={s.sectionCount}>{earnedBadges.length}</Text>
            )}
          </View>
          {earnedBadges.length === 0 ? (
            <Text style={s.noBadgesText}>No achievements earned yet</Text>
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={s.badgesRow}
            >
              {earnedBadges.map((badge, i) => {
                const color = BADGE_COLORS[badge.difficulty] ?? '#38BDF8';
                return (
                  <View key={i} style={[s.badgeCard, { borderColor: color + '55' }]}>
                    <View style={s.badgeRibbon} />
                    <BadgeIcon iconKey={badge.iconKey} size={22} color={color} />
                    <Text style={s.badgeTitle}>{badge.title}</Text>
                  </View>
                );
              })}
            </ScrollView>
          )}
        </View>

        {/* ── Recent Activity ──────────────────────────────────────────────── */}
        {pilotActivity.length > 0 && (
          <View style={s.activitySection}>
            <View style={s.sectionLabelRow}>
              <View style={s.sectionAccent} />
              <Text style={s.sectionLabel}>Recent Activity</Text>
            </View>
            {pilotActivity.map((item, i) => (
              <View key={`${item.type}-${item.icao}-${i}`} style={[s.activityRow, i < pilotActivity.length - 1 && s.activityRowBorder]}>
                <View style={s.activityIconWrap}>
                  <Feather
                    name={item.type === 'flight' ? 'navigation' : 'clipboard'}
                    size={12}
                    color={item.type === 'flight' ? '#38BDF8' : '#0D9488'}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.activityText}>
                    {item.type === 'flight' ? 'Flew to ' : 'Reported on '}
                    <Text style={s.activityIcao}>{item.icao}</Text>
                  </Text>
                </View>
                <Text style={s.activityTime}>
                  {new Date(item.ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* ── Flights & Destinations ────────────────────────────────────────── */}
        <View style={s.section}>
          <View style={s.sectionLabelRow}>
            <View style={s.sectionAccent} />
            <Text style={s.sectionLabel}>Flights & Destinations</Text>
          </View>

          {recentVisits.length === 0 ? (
            <View style={[s.card, { overflow: 'hidden' }]}>
              <View style={s.cardHighlight} pointerEvents="none" />
              <Text style={s.emptyTxt}>No airports logged yet.</Text>
            </View>
          ) : (
            <View style={s.flightStack}>
              {recentVisits.map((v, i) => (
                <View key={`${v.icao}-${v.visited_at}-${i}`} style={s.flightCard}>
                  <View style={s.flightCardHighlight} pointerEvents="none" />

                  {/* Left: airport aerial thumbnail */}
                  <View style={s.flightThumb}>
                    {v.lat && v.lng && GOOGLE_KEY ? (
                      <Image
                        source={{ uri: `https://maps.googleapis.com/maps/api/staticmap?center=${v.lat},${v.lng}&zoom=14&size=124x144&scale=2&maptype=satellite&key=${GOOGLE_KEY}` }}
                        style={s.flightThumbImg}
                        resizeMode="cover"
                      />
                    ) : (
                      <LinearGradient
                        colors={['#1A3A5C', '#0E2040', '#08111E', '#040A12']}
                        locations={[0, 0.40, 0.72, 1]}
                        style={StyleSheet.absoluteFill}
                      />
                    )}
                    {/* Vignette overlay */}
                    <LinearGradient
                      colors={['rgba(4,8,18,0.30)', 'transparent', 'rgba(4,8,18,0.55)']}
                      locations={[0, 0.45, 1]}
                      style={StyleSheet.absoluteFill}
                    />
                    {/* Right-edge bleed into card */}
                    <LinearGradient
                      colors={['transparent', 'rgba(8, 15, 28, 0.88)']}
                      start={{ x: 0.25, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={StyleSheet.absoluteFill}
                    />
                    <Text style={s.thumbIcao}>{v.icao}</Text>
                  </View>

                  {/* Center: text */}
                  <View style={s.flightInfo}>
                    <Text style={s.flightIcao}>{v.icao}</Text>
                    <Text style={s.flightName} numberOfLines={1}>
                      {v.name ?? v.city ?? v.icao}
                    </Text>
                    {(v.city || v.state) ? (
                      <Text style={s.flightLocation} numberOfLines={1}>
                        {[v.city, v.state].filter(Boolean).join(', ')}
                      </Text>
                    ) : null}
                  </View>

                  {/* Right: date stamp */}
                  <View style={s.flightDateWrap}>
                    <Text style={s.flightDateMonth}>
                      {new Date(v.visited_at).toLocaleDateString('en-US', { month: 'short' }).toUpperCase()}
                    </Text>
                    <Text style={s.flightDateDay}>
                      {new Date(v.visited_at).toLocaleDateString('en-US', { day: 'numeric' })}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      {/* Bottom depth vignette */}
      <LinearGradient
        colors={['transparent', 'rgba(6, 9, 16, 0.80)']}
        style={s.bottomVignette}
        pointerEvents="none"
      />

      <SignInPrompt
        visible={signInPrompt}
        onClose={() => setSignInPrompt(false)}
        title="Follow This Pilot"
        body="Create a free account to follow pilots, track their flights, and build your aviation network."
      />
    </BackgroundWrapper>
  );
}

const s = StyleSheet.create({
  scroll: { paddingBottom: 100 },

  backBtn: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4 },
  backTxt: { fontSize: 17, color: Colors.accent.sky, fontWeight: '500' },

  // ── Header: photo + stats row ──────────────────────────────────────────────
  // Mirrors ProfileHeader.photoStatsRow
  headerBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 10,
  },

  // Avatar ───────────────────────────────────────────────────────────────────
  photoWrap: { flexShrink: 0 },

  // Outer ring — faint orange identity accent (photo state)
  photoRing: {
    borderRadius: 52,
    borderWidth: 2,
    borderColor: 'rgba(232, 112, 10, 0.45)',
    padding: 3,
    backgroundColor: '#060B16',
  },
  // Fallback state — brighter orange ring
  photoRingFallback: {
    borderColor: 'rgba(255, 77, 0, 0.45)',
  },

  photo: { width: 96, height: 96, borderRadius: 48 },

  // Fallback — dark glass circle with initial
  photoFallback: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: Colors.glass.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoInitial: { fontSize: 38, fontWeight: '700', color: Colors.accent.sky },

  // Stats grid ───────────────────────────────────────────────────────────────
  statsRow: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignSelf: 'center',
    alignItems: 'center',
  },
  statItem:  { alignItems: 'center', flex: 1 },

  // Primary: airports — dominant aviation stat
  primaryStatValue: {
    fontSize: 26,
    fontWeight: '800',
    color: '#F0F4FF',
    letterSpacing: -0.5,
    marginBottom: 3,
  },
  statLabel: {
    fontSize: 9,
    color: '#6B83A0',
    fontWeight: '700',
    letterSpacing: 0.8,
    textAlign: 'center',
    textTransform: 'uppercase',
  },

  // Thin divider between primary and secondary groups
  statsDivider: { width: 1, height: 30, backgroundColor: '#1E2D45', marginHorizontal: 4 },

  // Secondary: social — present but de-emphasized
  secondaryStatValue: {
    fontSize: 15,
    fontWeight: '700',
    color: '#4A5F77',
    letterSpacing: -0.2,
    marginBottom: 3,
  },
  secondaryStatLabel: {
    fontSize: 9,
    color: '#364A60',
    fontWeight: '600',
    letterSpacing: 0.6,
    textAlign: 'center',
    textTransform: 'uppercase',
  },

  // ── Identity block ─────────────────────────────────────────────────────────
  identity: {
    paddingHorizontal: 20,
    paddingBottom: 20,
    gap: 3,
  },

  name: {
    fontSize: 30,
    fontWeight: '800',
    color: '#F0F4FF',
    letterSpacing: -0.5,
  },
  usernameHandle: {
    fontSize: 13,
    fontWeight: '500',
    color: '#4A5F77',
    letterSpacing: 0.2,
    marginTop: -1,
  },

  badgeRankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginTop: 1,
  },
  certBadge: {
    fontSize: 13,
    fontWeight: '700',
    color: '#38BDF8',
    letterSpacing: 0.2,
  },
  dot:  { fontSize: 13, color: '#4A5F77' },
  rank: { fontSize: 13, fontWeight: '500', color: '#8A9BB5' },

  detailRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 3,
  },
  detailItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  detail:     { fontSize: 12, color: '#6B83A0', fontWeight: '500' },

  // Follow CTA
  followWrap: { marginTop: 14, alignSelf: 'flex-start' },

  // ── Follow button ──────────────────────────────────────────────────────────
  followBtn: {
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 77, 0, 0.70)',
    backgroundColor: 'rgba(255, 77, 0, 0.09)',
    alignItems: 'center',
    overflow: 'visible',
    shadowColor: '#FF4D00',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.22,
    shadowRadius: 10,
    elevation: 5,
  },
  followBtnHighlight: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    height: 1,
    borderTopLeftRadius: 13,
    borderTopRightRadius: 13,
    backgroundColor: 'rgba(255, 140, 60, 0.18)',
  },
  followBtnActive: {
    borderColor: 'rgba(56, 189, 248, 0.55)',
    backgroundColor: 'rgba(56, 189, 248, 0.09)',
    shadowColor: Colors.accent.sky,
    shadowOpacity: 0.14,
  },
  followBtnTxt: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FF4D00',
    letterSpacing: 0.4,
  },
  followBtnTxtActive: {
    color: Colors.accent.sky,
    letterSpacing: 0.3,
  },

  // ── Section header ─────────────────────────────────────────────────────────
  sectionLabelRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginBottom: 12, marginTop: 4,
  },
  sectionAccent: {
    width: 2, height: 11, borderRadius: 1,
    backgroundColor: '#FF4D00',
  },
  sectionLabel: {
    fontSize: 11, fontWeight: '700', color: Colors.text.label,
    letterSpacing: 1.4, textTransform: 'uppercase', flex: 1,
  },
  sectionCount: { fontSize: 12, fontWeight: '700', color: '#4A5B73' },
  noBadgesText: { fontSize: 13, color: '#3D5068', paddingVertical: 8 },
  activitySection: { marginHorizontal: 16, marginBottom: 20 },
  activityRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  activityRowBorder: { borderBottomWidth: 1, borderBottomColor: '#1A2535' },
  activityIconWrap: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.03)',
    alignItems: 'center', justifyContent: 'center',
  },
  activityText: { fontSize: 13, color: '#8A9BB5' },
  activityIcao: { fontWeight: '700', color: '#38BDF8' },
  activityTime: { fontSize: 11, color: '#3D5068' },

  // ── Achievement badges ─────────────────────────────────────────────────────
  badgesSection: { marginHorizontal: 16, marginBottom: 20 },
  badgesRow:     { gap: 12, paddingBottom: 4 },

  badgeCard: {
    width: 130,
    backgroundColor: '#0D1421',
    borderRadius: 14,
    borderWidth: 1.5,
    padding: 14,
    paddingTop: 18,
    gap: 5,
    overflow: 'hidden',
  },
  badgeCardLocked: {
    borderColor: '#141E2C',
    opacity: 0.5,
  },
  badgeRibbon: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    height: 2.5,
    backgroundColor: '#FF4D00',
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
  },
  badgeTitle: {
    fontSize: 11, fontWeight: '700', color: '#C8D8EE', lineHeight: 14,
  },
  badgeEarnedLabel: {
    fontSize: 9, fontWeight: '800', letterSpacing: 1, marginTop: 1,
  },
  badgeTitleLocked: {
    fontSize: 11, fontWeight: '600', color: '#4A5F77', lineHeight: 14,
  },
  badgeReq: {
    fontSize: 10, color: '#4A5F77', lineHeight: 13, marginTop: 1,
  },

  // ── Flight cards section ───────────────────────────────────────────────────
  section: { marginHorizontal: 16, marginBottom: 24 },

  card: {
    ...Surfaces.card,
    overflow: 'hidden',
  },
  cardHighlight: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    height: 1,
    backgroundColor: 'rgba(140, 190, 255, 0.07)',
    zIndex: 1,
  },
  emptyTxt: { fontSize: 13, color: Colors.text.dim, fontWeight: '500', padding: 16 },

  flightStack: { gap: 8 },

  flightCard: {
    backgroundColor: Colors.glass.primary,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: '#1E2D45',
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'visible',
    gap: 12,
    paddingVertical: 0,
    paddingRight: 14,
    paddingLeft: 0,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.48,
    shadowRadius: 16,
    elevation: 8,
  },
  flightCardHighlight: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    height: 1,
    borderTopLeftRadius: Radius.card,
    borderTopRightRadius: Radius.card,
    backgroundColor: 'rgba(160, 210, 255, 0.11)',
    zIndex: 1,
  },

  flightThumb: {
    width: 62, height: 72,
    borderTopLeftRadius: Radius.card,
    borderBottomLeftRadius: Radius.card,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 7,
    flexShrink: 0,
  },
  flightThumbImg: { ...StyleSheet.absoluteFillObject },

  thumbIcao: {
    fontSize: 8,
    fontWeight: '800',
    color: 'rgba(255, 77, 0, 0.50)',
    letterSpacing: 0.8,
    textAlign: 'center',
  },

  flightInfo: { flex: 1, gap: 2 },
  flightIcao: {
    fontSize: 14, fontWeight: '800', color: '#FF4D00',
    letterSpacing: 1.4, marginBottom: 1,
  },
  flightName: {
    fontSize: 13, fontWeight: '600', color: '#EDF3FB',
  },
  flightLocation: {
    fontSize: 11, fontWeight: '400', color: Colors.text.muted,
  },

  flightDateWrap: { alignItems: 'flex-end', gap: 1 },
  flightDateMonth: {
    fontSize: 9, fontWeight: '600', color: Colors.text.dim, letterSpacing: 1.0,
  },
  flightDateDay: {
    fontSize: 18, fontWeight: '700', color: Colors.text.secondary, letterSpacing: -0.5,
  },

  // Bottom depth vignette
  bottomVignette: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    height: 120,
  },

  // Private profile
  privateCtr:   { flex: 1, alignItems: 'center', justifyContent: 'center', marginTop: 80, paddingHorizontal: 40 },
  privateTitle: { fontSize: 20, fontWeight: '700', color: '#F0F4FF', marginBottom: 8 },
  privateMsg:   { fontSize: 14, color: Colors.text.muted, textAlign: 'center', lineHeight: 22 },
});
