/**
 * app/achievement-detail.tsx — Achievement detail page
 * Shows description, progress, and qualifying airports when earned.
 */

import { useEffect, useState } from 'react';
import { MaterialCommunityIcons, Feather } from '@expo/vector-icons';
import {
  Image, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { GOOGLE_KEY } from '../utils/config';
import airportsData from '../assets/images/airports.json';

const BADGE_COLORS: Record<string, string> = { easy: '#38BDF8', medium: '#F59E0B', hard: '#A855F7' };
const DIFFICULTY_LABELS: Record<string, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

// Map title → icon for when iconKey is not passed (from achievements page)
const TITLE_ICON: Record<string, string> = {
  '$100 Hamburger': 'food', 'Golf Destination': 'golf-tee', 'First 5 Airports': 'airplane-landing',
  'First 10 Airports': 'airplane', '5 States Flown': 'map', '10 States Flown': 'map',
  '20 Airports': 'earth', '50 Airports': 'airplane', 'All 50 States': 'earth',
  'Serious Explorer': 'trophy', '100 Flights': 'trophy', 'Cross-Country': 'airplane',
  'Dog Lover': 'dog-side', 'Overnighter': 'bed-outline', 'First Report': 'clipboard-text',
  'Helpful Pilot': 'clipboard-text', 'Social Butterfly': 'account-group',
  'Weekend Warrior': 'airplane-takeoff', 'Iron Pilot': 'fire',
  'Bucket List Starter': 'star', 'Bucket List Builder': 'star', 'Dream Chaser': 'star-shooting',
  'Weekend Escape': 'bed', 'Adventure Pilot': 'flag-variant',
  'Home Base Explorer': 'home', 'Cross Country Starter': 'airplane-takeoff',
};

function BadgeIcon({ iconKey, size, color, title }: { iconKey: string; size: number; color: string; title?: string }) {
  const resolved = iconKey || (title ? TITLE_ICON[title] : '') || 'trophy';
  // Feather icons
  if (resolved === 'map') return <Feather name="map" size={size} color={color} />;
  if (resolved === 'award' || resolved === 'trophy') return <Feather name="award" size={size} color={color} />;
  // MaterialCommunityIcons
  return <MaterialCommunityIcons name={resolved as any} size={size} color={color} />;
}

interface QualifyingAirport {
  icao: string;
  name: string;
  city: string;
  state: string;
  visited_at: string;
}

interface SuggestedAirport {
  icao: string;
  name: string;
  city: string;
  state: string;
  distNm: number;
}

const allAirports: any[] = airportsData as any[];

function haversineNm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3440.065;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export default function AchievementDetailScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const params = useLocalSearchParams<{
    title: string; hint: string; iconKey: string; difficulty: string;
    earned: string; current: string; total: string;
  }>();

  const earned = params.earned === 'true';
  const color = BADGE_COLORS[params.difficulty] ?? '#38BDF8';
  const current = parseInt(params.current ?? '0', 10);
  const total = parseInt(params.total ?? '1', 10);
  const pct = total > 0 ? Math.min(current / total, 1) : 0;

  const [qualifyingAirports, setQualifyingAirports] = useState<QualifyingAirport[]>([]);
  const [suggestions, setSuggestions] = useState<SuggestedAirport[]>([]);

  useEffect(() => {
    if (!user?.id) return;
    loadData();
  }, [user?.id]);

  async function loadData() {
    try {
      const { data: visits } = await supabase
        .from('visited_airports')
        .select('icao, name, city, state, visited_at')
        .eq('user_id', user!.id)
        .order('visited_at', { ascending: false });

      const visitList = visits ?? [];
      const visitedIcaos = new Set(visitList.map(v => v.icao));
      const visitedStates = new Set(visitList.filter(v => v.state).map(v => v.state));

      const title = params.title;

      // ── Qualifying airports (for earned badges) ──
      let qualifying: QualifyingAirport[] = [];
      if (title === '$100 Hamburger') {
        qualifying = visitList.filter(v => {
          const apt = allAirports.find(a => (a.icao || a.faa || a.id) === v.icao);
          return apt?.nearestFoodNm != null && apt.nearestFoodNm <= 3;
        });
      } else if (title === 'Golf Destination') {
        qualifying = visitList.filter(v => {
          const apt = allAirports.find(a => (a.icao || a.faa || a.id) === v.icao);
          return apt?.nearestGolfNm != null;
        });
      } else if (title === 'Overnighter') {
        qualifying = visitList.filter(v => {
          const apt = allAirports.find(a => (a.icao || a.faa || a.id) === v.icao);
          return apt?.nearestHotelNm != null && apt.nearestHotelNm <= 3;
        });
      } else if (title === 'Dog Lover') {
        try {
          const { data: dogApts } = await supabase.from('dog_friendly_airports').select('airport_icao');
          const dogIcaos = new Set((dogApts ?? []).map((d: any) => d.airport_icao));
          qualifying = visitList.filter(v => dogIcaos.has(v.icao));
        } catch {}
      } else if (title === '5 States Flown' || title === '10 States Flown') {
        const seen = new Set<string>();
        qualifying = visitList.filter(v => {
          if (!v.state || seen.has(v.state)) return false;
          seen.add(v.state); return true;
        });
      } else {
        // All airport-count and flight-count badges
        const seen = new Set<string>();
        qualifying = visitList.filter(v => {
          if (seen.has(v.icao)) return false;
          seen.add(v.icao); return true;
        });
      }
      setQualifyingAirports(qualifying.slice(0, 25));

      // ── Suggestions (for unearned badges) ──
      // Find user's home location for distance sorting
      let homeLat = 39.83, homeLng = -98.58; // US center fallback
      const { data: profileRaw } = await supabase
        .from('pilot_profiles')
        .select('home_airport')
        .eq('user_id', user!.id)
        .maybeSingle();
      if (profileRaw?.home_airport) {
        const homeApt = allAirports.find(a => (a.icao || a.faa || a.id)?.toUpperCase() === profileRaw.home_airport.toUpperCase());
        if (homeApt?.lat && homeApt?.lng) { homeLat = homeApt.lat; homeLng = homeApt.lng; }
      }

      let candidates: any[] = [];

      const unvisited = (a: any) => a.fuel && a.lat && a.lng && !visitedIcaos.has(a.icao || a.faa || a.id);

      if (title === '$100 Hamburger') {
        candidates = allAirports.filter(a => a.nearestFoodNm != null && a.nearestFoodNm <= 3 && unvisited(a));
      } else if (title === 'Golf Destination') {
        candidates = allAirports.filter(a => a.nearestGolfNm != null && unvisited(a));
      } else if (title === 'Overnighter') {
        candidates = allAirports.filter(a => a.nearestHotelNm != null && a.nearestHotelNm <= 3 && unvisited(a));
      } else if (title === 'Dog Lover') {
        // Dog-friendly airports from Supabase
        try {
          const { data: dogApts } = await supabase.from('dog_friendly_airports').select('airport_icao');
          const dogIcaos = new Set((dogApts ?? []).map((d: any) => d.airport_icao));
          candidates = allAirports.filter(a => dogIcaos.has(a.icao || a.faa || a.id) && unvisited(a));
        } catch { candidates = []; }
      } else if (title === '5 States Flown' || title === '10 States Flown') {
        candidates = allAirports.filter(a => a.state && !visitedStates.has(a.state) && unvisited(a));
      } else if (title === 'Cross-Country') {
        // Airports 200+ nm from home that haven't been visited
        candidates = allAirports.filter(a => {
          if (!unvisited(a)) return false;
          const nm = haversineNm(homeLat, homeLng, a.lat, a.lng);
          return nm >= 200;
        });
      } else {
        // Generic: any unvisited airport
        candidates = allAirports.filter(unvisited);
      }

      // Sort by distance from home, take closest
      const withDist = candidates.map(a => ({
        icao: a.icao || a.faa || a.id,
        name: a.name,
        city: a.city ?? '',
        state: a.state ?? '',
        distNm: Math.round(haversineNm(homeLat, homeLng, a.lat, a.lng)),
      }));
      withDist.sort((a, b) => a.distNm - b.distNm);
      setSuggestions(withDist.slice(0, 8));
    } catch {}
  }

  return (
    <View style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} activeOpacity={0.7}>
          <Text style={s.backArrow}>&#8249;</Text>
          <Text style={s.backLabel}>Back</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Achievement</Text>
        <View style={s.backBtn} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>
        {/* Icon + Title */}
        {earned ? (
          <>
            <View style={[s.iconRingEarned, { borderColor: color + '55', shadowColor: color }]}>
              <View style={[s.iconGlow, { backgroundColor: color + '18' }]} />
              <BadgeIcon iconKey={params.iconKey} size={44} color={color} title={params.title} />
            </View>
            <Text style={s.title}>{params.title}</Text>
            <View style={[s.earnedBanner, { borderColor: color + '30', backgroundColor: color + '10' }]}>
              <Feather name="check-circle" size={15} color={color} />
              <Text style={[s.earnedText, { color }]}>Achievement Unlocked</Text>
            </View>
          </>
        ) : (
          <>
            <View style={[s.iconRing, { borderColor: '#1E2D42' }]}>
              <BadgeIcon iconKey={params.iconKey} size={40} color="#4A5B73" title={params.title} />
            </View>
            <Text style={[s.title, { color: '#6B83A0' }]}>{params.title}</Text>
            <View style={s.diffBadge}>
              <Text style={[s.diffText, { color }]}>{DIFFICULTY_LABELS[params.difficulty] ?? params.difficulty}</Text>
            </View>
            <View style={s.progressSection}>
              <View style={s.progressBarBg}>
                <View style={[s.progressBarFill, { width: `${Math.max(pct * 100, 3)}%`, backgroundColor: color }]} />
              </View>
              <Text style={s.progressLabel}>{current} of {total}</Text>
            </View>
          </>
        )}

        {/* Description */}
        <Text style={s.hint}>{params.hint}</Text>

        {/* Qualifying airports */}
        {earned && qualifyingAirports.length > 0 && (
          <View style={s.airportsSection}>
            <Text style={s.airportsTitle}>
              {params.title === '5 States Flown' || params.title === '10 States Flown' ? 'STATES FLOWN' : 'QUALIFYING AIRPORTS'}
            </Text>
            {qualifyingAirports.map((apt, i) => {
              const aptData = allAirports.find(a => (a.icao || a.faa || a.id) === apt.icao);
              const satUri = GOOGLE_KEY && aptData?.lat && aptData?.lng
                ? `https://maps.googleapis.com/maps/api/staticmap?center=${aptData.lat},${aptData.lng}&zoom=14&size=200x200&maptype=satellite&key=${GOOGLE_KEY}` : null;
              return (
                <TouchableOpacity
                  key={`${apt.icao}-${i}`}
                  style={s.aptCard}
                  onPress={() => router.push({ pathname: '/airport', params: { icao: apt.icao, name: apt.name ?? '', city: apt.city ?? '', state: apt.state ?? '', lat: '', lng: '', elevation: '', fuel: '' } })}
                  activeOpacity={0.7}
                >
                  <View style={s.aptThumb}>
                    {satUri ? <Image source={{ uri: satUri }} style={s.aptThumbImg} /> : <MaterialCommunityIcons name="airplane" size={16} color="#38BDF8" />}
                    <View style={[s.aptCheckBadge, { backgroundColor: color }]}>
                      <Feather name="check" size={8} color="#FFF" />
                    </View>
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={s.aptIcao}>{apt.icao}</Text>
                      {apt.state && <Text style={s.aptState}>{apt.state}</Text>}
                    </View>
                    <Text style={s.aptName} numberOfLines={1}>{apt.name}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={s.aptMeta}>
                      {new Date(apt.visited_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </Text>
                    <Feather name="chevron-right" size={14} color="#2A3A52" />
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* Suggested airports to complete the achievement */}
        {suggestions.length > 0 && (
          <View style={s.airportsSection}>
            <Text style={s.airportsTitle}>
              {earned ? 'KEEP GOING' : 'FLY HERE TO EARN THIS'}
            </Text>
            {suggestions.map((apt, i) => {
              const aptData = allAirports.find(a => (a.icao || a.faa || a.id) === apt.icao);
              const satUri = GOOGLE_KEY && aptData?.lat && aptData?.lng
                ? `https://maps.googleapis.com/maps/api/staticmap?center=${aptData.lat},${aptData.lng}&zoom=14&size=200x200&maptype=satellite&key=${GOOGLE_KEY}` : null;
              return (
                <TouchableOpacity
                  key={`${apt.icao}-${i}`}
                  style={s.aptCard}
                  onPress={() => router.push({ pathname: '/airport', params: { icao: apt.icao, name: apt.name, city: apt.city, state: apt.state, lat: '', lng: '', elevation: '', fuel: '' } })}
                  activeOpacity={0.7}
                >
                  <View style={s.aptThumb}>
                    {satUri ? <Image source={{ uri: satUri }} style={s.aptThumbImg} /> : <MaterialCommunityIcons name="airplane" size={16} color="#38BDF8" />}
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={s.aptIcao}>{apt.icao}</Text>
                      {apt.state && <Text style={s.aptState}>{apt.state}</Text>}
                    </View>
                    <Text style={s.aptName} numberOfLines={1}>{apt.name}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={s.aptDist}>{apt.distNm} nm</Text>
                    <Feather name="chevron-right" size={14} color="#2A3A52" />
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#060B16' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 60, paddingBottom: 12, paddingHorizontal: 16,
    borderBottomWidth: 1, borderBottomColor: '#1E3A5F',
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', width: 80 },
  backArrow: { fontSize: 28, color: '#38BDF8', lineHeight: 32, marginRight: 2 },
  backLabel: { fontSize: 16, color: '#38BDF8', fontWeight: '500' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#F0F4FF' },
  content: { alignItems: 'center', padding: 24, paddingBottom: 60 },

  iconRingEarned: {
    width: 100, height: 100, borderRadius: 50,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2.5, marginBottom: 16,
    shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.35, shadowRadius: 20,
  },
  iconGlow: {
    ...StyleSheet.absoluteFillObject, borderRadius: 50,
  },
  iconRing: {
    width: 88, height: 88, borderRadius: 44,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, marginBottom: 16, backgroundColor: 'rgba(255,255,255,0.03)',
  },
  title: { fontSize: 24, fontWeight: '800', color: '#F0F4FF', textAlign: 'center', marginBottom: 8 },
  diffBadge: {
    paddingHorizontal: 12, paddingVertical: 4, borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: '#1E2D42',
    marginBottom: 20,
  },
  diffText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },

  earnedBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 18, paddingVertical: 11, borderRadius: 14,
    borderWidth: 1, marginBottom: 20,
  },
  earnedText: { fontSize: 15, fontWeight: '800', letterSpacing: 0.3 },

  progressSection: { width: '100%', marginBottom: 20 },
  progressBarBg: {
    width: '100%', height: 8, borderRadius: 4,
    backgroundColor: '#1A2535', overflow: 'hidden', marginBottom: 6,
  },
  progressBarFill: { height: 8, borderRadius: 4 },
  progressLabel: { fontSize: 13, color: '#6B83A0', fontWeight: '600', textAlign: 'center' },

  hint: { fontSize: 16, color: '#8A9BB5', lineHeight: 24, textAlign: 'center', marginBottom: 28 },

  airportsSection: { width: '100%' },
  airportsTitle: { fontSize: 10, fontWeight: '700', color: '#4A5B73', letterSpacing: 1.2, marginBottom: 12 },
  aptCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: 'rgba(10,18,36,0.97)', borderRadius: 14, padding: 12, marginBottom: 8,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
  aptThumb: {
    width: 48, height: 48, borderRadius: 10, overflow: 'hidden',
    backgroundColor: '#0A1628', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  aptThumbImg: { width: 48, height: 48 },
  aptCheckBadge: {
    position: 'absolute', bottom: -1, right: -1,
    width: 16, height: 16, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: '#060B16',
  },
  aptIcao: { fontSize: 15, fontWeight: '800', color: '#38BDF8' },
  aptState: { fontSize: 11, fontWeight: '600', color: '#4A5B73', backgroundColor: 'rgba(255,255,255,0.04)', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4 },
  aptName: { fontSize: 13, fontWeight: '500', color: '#8A9BB5', marginTop: 2 },
  aptMeta: { fontSize: 11, color: '#4A5B73', marginBottom: 4 },
  aptDist: { fontSize: 13, fontWeight: '700', color: '#6B83A0', marginBottom: 4 },
});
