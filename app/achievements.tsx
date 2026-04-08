import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import AchievementCard, { Achievement } from '../components/profile/AchievementCard';
import { supabase } from '../lib/supabase';
import { MaterialCommunityIcons, Feather } from '@expo/vector-icons';

import React from 'react';

interface Group {
  title: string;
  icon: React.ReactElement;
  items: Achievement[];
}

// ─── Static placeholder achievements ─────────────────────────────────────────

interface AchCtx {
  hasFoodVisit: boolean; hasGolfVisit: boolean; hasHotelVisit: boolean;
  hasDogVisit: boolean; attractionCount: number; nearHomeCount: number;
  longFlightCount: number; bucketCount: number; bucketVisited: number;
}

function buildFoodFunItems(c: AchCtx): Achievement[] {
  return [
    { icon: <MaterialCommunityIcons name="food" size={20} color="#38BDF8" />,           title: '$100 Hamburger',   description: 'Fly somewhere for food',                      difficulty: 'easy',   current: c.hasFoodVisit ? 1 : 0, total: 1,  complete: c.hasFoodVisit  },
    { icon: <MaterialCommunityIcons name="golf-tee" size={20} color="#38BDF8" />,       title: 'Golf Destination', description: 'Fly to a golf course',                        difficulty: 'easy',   current: c.hasGolfVisit ? 1 : 0, total: 1,  complete: c.hasGolfVisit  },
    { icon: <MaterialCommunityIcons name="bed-outline" size={20} color="#38BDF8" />,    title: 'Overnighter',      description: 'Fly somewhere with lodging',                  difficulty: 'easy',   current: c.hasHotelVisit ? 1 : 0, total: 1, complete: c.hasHotelVisit },
    { icon: <MaterialCommunityIcons name="dog-side" size={20} color="#38BDF8" />,       title: 'Dog Lover',        description: 'Fly to a dog-friendly airport',               difficulty: 'easy',   current: c.hasDogVisit ? 1 : 0, total: 1,  complete: c.hasDogVisit },
    { icon: <MaterialCommunityIcons name="flag-variant" size={20} color="#A855F7" />,   title: 'Adventure Pilot',  description: 'Visit 10 airports with things to do nearby',  difficulty: 'hard',   current: Math.min(c.attractionCount, 10), total: 10, complete: c.attractionCount >= 10 },
  ];
}

function buildProgressItems(totalFlights: number, c: AchCtx): Achievement[] {
  return [
    { icon: <MaterialCommunityIcons name="home" size={20} color="#38BDF8" />,            title: 'Home Base Explorer',    description: 'Discover 10 airports near home', difficulty: 'easy',   current: Math.min(c.nearHomeCount, 10), total: 10, complete: c.nearHomeCount >= 10 },
    { icon: <MaterialCommunityIcons name="airplane-takeoff" size={20} color="#F59E0B" />,title: 'Cross Country Starter', description: 'Fly 200+ nm from home',          difficulty: 'medium', current: Math.min(c.longFlightCount, 1), total: 1, complete: c.longFlightCount >= 1 },
    { icon: <Feather name="award" size={20} color="#A855F7" />,                          title: 'Serious Explorer',      description: 'Log 25 destination flights',     difficulty: 'hard',   current: Math.min(totalFlights, 25), total: 25, complete: totalFlights >= 25 },
  ];
}

function buildBucketListItems(c: AchCtx): Achievement[] {
  return [
    { icon: <MaterialCommunityIcons name="star" size={20} color="#38BDF8" />,           title: 'Bucket List Starter', description: 'Save 5 airports',                difficulty: 'easy',   current: Math.min(c.bucketCount, 5),  total: 5,  complete: c.bucketCount >= 5  },
    { icon: <MaterialCommunityIcons name="clipboard-list" size={20} color="#F59E0B" />, title: 'Bucket List Builder', description: 'Save 15 airports',               difficulty: 'medium', current: Math.min(c.bucketCount, 15), total: 15, complete: c.bucketCount >= 15 },
    { icon: <MaterialCommunityIcons name="star-shooting" size={20} color="#A855F7" />,  title: 'Dream Chaser',        description: 'Visit 10 bucket list airports',  difficulty: 'hard',   current: Math.min(c.bucketVisited, 10), total: 10, complete: c.bucketVisited >= 10 },
  ];
}

// ─── Real-data achievement builders ──────────────────────────────────────────
// These are computed from visited_airports in Supabase.

function buildExplorationItems(airports: number, states: number, longestNm: number): Achievement[] {
  return [
    { icon: <MaterialCommunityIcons name="airplane-landing" size={20} color="#38BDF8" />, title: 'First 5 Airports',  description: 'Visit 5 airports',        difficulty: 'easy',   current: Math.min(airports, 5), total: 5, complete: airports >= 5 },
    { icon: <MaterialCommunityIcons name="airplane" size={20} color="#F59E0B" />,         title: 'First 10 Airports', description: 'Visit 10 airports',       difficulty: 'medium', current: Math.min(airports, 10), total: 10, complete: airports >= 10 },
    { icon: <Feather name="map" size={20} color="#F59E0B" />,                              title: '5 States Flown',    description: 'Fly across 5 states',     difficulty: 'medium', current: Math.min(states, 5), total: 5, complete: states >= 5 },
    { icon: <Feather name="map" size={20} color="#A855F7" />,                              title: '10 States Flown',   description: 'Fly across 10 states',    difficulty: 'hard',   current: Math.min(states, 10), total: 10, complete: states >= 10 },
    { icon: <MaterialCommunityIcons name="earth" size={20} color="#A855F7" />,             title: '20 Airports',       description: 'Visit 20 airports',       difficulty: 'hard',   current: Math.min(airports, 20), total: 20, complete: airports >= 20 },
    { icon: <MaterialCommunityIcons name="airplane" size={20} color="#A855F7" />,          title: '50 Airports',       description: 'Visit 50 airports',       difficulty: 'hard',   current: Math.min(airports, 50), total: 50, complete: airports >= 50 },
    { icon: <MaterialCommunityIcons name="airplane" size={20} color="#F59E0B" />,          title: 'Cross-Country',     description: 'Fly 200+ nm from home',   difficulty: 'medium', current: Math.min(longestNm, 200), total: 200, complete: longestNm >= 200 },
    { icon: <MaterialCommunityIcons name="earth" size={20} color="#A855F7" />,             title: 'All 50 States',     description: 'Fly in all 50 states',    difficulty: 'hard',   current: Math.min(states, 50), total: 50, complete: states >= 50 },
  ];
}


function buildCommunityItems(reportCount: number, followingCount: number): Achievement[] {
  return [
    { icon: <Feather name="clipboard" size={20} color="#38BDF8" />,       title: 'First Report',      description: 'Submit a pilot report',     difficulty: 'easy',   current: Math.min(reportCount, 1),  total: 1,  complete: reportCount >= 1 },
    { icon: <Feather name="clipboard" size={20} color="#F59E0B" />,       title: 'Helpful Pilot',     description: 'Submit 10 pilot reports',   difficulty: 'medium', current: Math.min(reportCount, 10), total: 10, complete: reportCount >= 10 },
    { icon: <MaterialCommunityIcons name="account-group" size={20} color="#38BDF8" />, title: 'Social Butterfly', description: 'Follow 5 pilots', difficulty: 'easy', current: Math.min(followingCount, 5), total: 5, complete: followingCount >= 5 },
  ];
}

function buildStreakItems(streakWeeks: number): Achievement[] {
  return [
    { icon: <MaterialCommunityIcons name="airplane-takeoff" size={20} color="#F59E0B" />, title: 'Weekend Warrior', description: '4 week flying streak',  difficulty: 'medium', current: Math.min(streakWeeks, 4),  total: 4,  complete: streakWeeks >= 4 },
    { icon: <MaterialCommunityIcons name="fire" size={20} color="#A855F7" />,             title: 'Iron Pilot',      description: '12 week flying streak', difficulty: 'hard',   current: Math.min(streakWeeks, 12), total: 12, complete: streakWeeks >= 12 },
  ];
}


function buildGroups(airports: number, states: number, totalFlights: number, hasFoodVisit: boolean, hasGolfVisit: boolean, bucketCount: number, reportCount: number, followingCount: number, streakWeeks: number, hasDogVisit: boolean, hasHotelVisit: boolean, longestNm: number, attractionCount: number, nearHomeCount: number, bucketVisited: number): Group[] {
  const c: AchCtx = { hasFoodVisit, hasGolfVisit, hasHotelVisit, hasDogVisit, attractionCount, nearHomeCount, longFlightCount: longestNm >= 200 ? 1 : 0, bucketCount, bucketVisited };
  return [
    { title: 'Exploration',   icon: <Feather name="map" size={16} color="#8A9BB5" />,                        items: buildExplorationItems(airports, states, longestNm) },
    { title: 'Destinations',  icon: <MaterialCommunityIcons name="map-marker" size={16} color="#8A9BB5" />,   items: buildFoodFunItems(c) },
    { title: 'Community',     icon: <Feather name="users" size={16} color="#8A9BB5" />,                       items: buildCommunityItems(reportCount, followingCount) },
    { title: 'Streaks',       icon: <MaterialCommunityIcons name="fire" size={16} color="#8A9BB5" />,         items: buildStreakItems(streakWeeks) },
    { title: 'Progress',      icon: <MaterialCommunityIcons name="trending-up" size={16} color="#8A9BB5" />,  items: buildProgressItems(totalFlights, c) },
    { title: 'Bucket List',   icon: <MaterialCommunityIcons name="star" size={16} color="#8A9BB5" />,         items: buildBucketListItems(c) },
  ];
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function AchievementsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [groups, setGroups] = useState<Group[]>(buildGroups(0, 0, 0, false, false, 0, 0, 0, 0, false, false, 0, 0, 0, 0));
  const [loading, setLoading] = useState(true);

  // Refresh every time the screen comes into focus (e.g. after logging a flight)
  useFocusEffect(useCallback(() => {
    loadAchievements();
  }, [user]));

  async function loadAchievements() {
    if (!user) { setLoading(false); return; }

    // Load home airport ICAO from saved user profile
    let homeIcao = '';
    try {
      const raw = await AsyncStorage.getItem(`userProfile:${user.id}`);
      if (raw) {
        const saved = JSON.parse(raw);
        homeIcao = (saved.home_airport ?? '').toUpperCase();
      }
    } catch {}

    const [visitedRes, bucketRes] = await Promise.all([
      supabase.from('visited_airports').select('icao, state, visited_at').eq('user_id', user.id),
      supabase.from('bucket_list').select('icao', { count: 'exact', head: true }).eq('user_id', user.id),
    ]);

    if (visitedRes.error) {
      console.error('[Achievements] visited_airports fetch error:', visitedRes.error.message);
      setLoading(false);
      return;
    }
    // bucketRes failure is non-fatal — degrade to 0 rather than crashing
    if (bucketRes.error) {
      console.warn('[Achievements] bucket_list fetch error:', bucketRes.error.message);
    }

    const bucketCount = bucketRes.count ?? 0;
    const rows = visitedRes.data ?? [];
    const nonHome = homeIcao ? rows.filter(r => r.icao !== homeIcao) : rows;

    // Unique airports visited (excluding home base)
    const airports = new Set(nonHome.map(r => r.icao)).size;
    // Unique states flown (excluding home base)
    const states = new Set(nonHome.filter(r => r.state).map(r => r.state)).size;
    // Total raw flight count (every logged visit, not unique)
    const totalFlights = nonHome.length;

    if (__DEV__) {
      console.log('[Achievements] user id:', user.id);
      console.log('[Achievements] flights:', totalFlights, '| airports:', airports, '| states:', states);
    }

    // Check food/golf badge eligibility
    const visitedIcaos = nonHome.map(r => r.icao);
    let hasFoodVisit = false;
    let hasGolfVisit = false;
    let hasDogVisit = false;
    let hasHotelVisit = false;
    if (visitedIcaos.length > 0) {
      const { data: cacheCheck } = await supabase
        .from('airport_places_cache')
        .select('airport_icao, category')
        .in('airport_icao', visitedIcaos)
        .in('category', ['restaurants', 'golf'])
        .limit(2);
      hasFoodVisit = (cacheCheck ?? []).some((r: any) => r.category === 'restaurants');
      hasGolfVisit = (cacheCheck ?? []).some((r: any) => r.category === 'golf');

      // Static fallbacks
      const airportsJson: any[] = require('../assets/images/airports.json');
      if (!hasFoodVisit) hasFoodVisit = visitedIcaos.some(ic => { const a = airportsJson.find((x: any) => (x.icao || x.faa || x.id) === ic); return a?.nearestFoodNm != null && a.nearestFoodNm <= 3; });
      if (!hasGolfVisit) hasGolfVisit = visitedIcaos.some(ic => { const a = airportsJson.find((x: any) => (x.icao || x.faa || x.id) === ic); return a?.nearestGolfNm != null; });
      hasHotelVisit = visitedIcaos.some(ic => { const a = airportsJson.find((x: any) => (x.icao || x.faa || x.id) === ic); return a?.nearestHotelNm != null && a.nearestHotelNm <= 3; });

      // Dog-friendly check
      try {
        const { data: dogCheck } = await supabase.from('dog_friendly_airports').select('airport_icao').in('airport_icao', visitedIcaos).limit(1);
        hasDogVisit = (dogCheck ?? []).length > 0;
      } catch {}
    }

    // Longest flight + streak + report count + following count
    let longestNm = 0;
    if (homeIcao) {
      const airportsJson: any[] = require('../assets/images/airports.json');
      const homeApt = airportsJson.find((a: any) => (a.icao || a.faa || a.id)?.toUpperCase() === homeIcao);
      if (homeApt?.lat && homeApt?.lng) {
        for (const r of nonHome) {
          const apt = airportsJson.find((a: any) => (a.icao || a.faa || a.id) === r.icao);
          if (apt?.lat && apt?.lng) {
            const R = 3440.065;
            const dLat = (apt.lat - homeApt.lat) * Math.PI / 180;
            const dLng = (apt.lng - homeApt.lng) * Math.PI / 180;
            const aa = Math.sin(dLat / 2) ** 2 + Math.cos(homeApt.lat * Math.PI / 180) * Math.cos(apt.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
            const nm = Math.round(R * 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa)));
            if (nm > longestNm) longestNm = nm;
          }
        }
      }
    }

    let reportCount = 0;
    let followingCount = 0;
    try {
      const { count: rc } = await supabase.from('airport_reviews').select('id', { count: 'exact', head: true }).eq('user_id', user.id);
      reportCount = rc ?? 0;
      const { count: fc } = await supabase.from('pilot_follows').select('following_id', { count: 'exact', head: true }).eq('follower_id', user.id);
      followingCount = fc ?? 0;
    } catch {}

    // Streak
    const flightDates = rows.map(r => new Date(r.visited_at ?? (r as any).created_at).getTime());
    const now = new Date();
    const dayOfWeek = now.getDay();
    const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const thisMonday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - mondayOffset);
    thisMonday.setHours(0, 0, 0, 0);
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    let streakWeeks = 0;
    for (let w = 0; w < 52; w++) {
      const weekStart = thisMonday.getTime() - w * weekMs;
      const weekEnd = weekStart + weekMs;
      if (flightDates.some(d => d >= weekStart && d < weekEnd)) streakWeeks++;
      else break;
    }

    // Attraction count: airports visited that have attractions nearby
    const airportsJson: any[] = require('../assets/images/airports.json');
    const attractionCount = visitedIcaos.filter(ic => {
      const a = airportsJson.find((x: any) => (x.icao || x.faa || x.id) === ic);
      return a?.nearestAttractionNm != null && a.nearestAttractionNm <= 8;
    }).length;

    // Near-home count: visited airports within 50nm of home
    let nearHomeCount = 0;
    if (homeIcao) {
      const homeAptN = airportsJson.find((a: any) => (a.icao || a.faa || a.id)?.toUpperCase() === homeIcao);
      if (homeAptN?.lat && homeAptN?.lng) {
        nearHomeCount = visitedIcaos.filter(ic => {
          const a = airportsJson.find((x: any) => (x.icao || x.faa || x.id) === ic);
          if (!a?.lat || !a?.lng) return false;
          const R = 3440.065;
          const dLat = (a.lat - homeAptN.lat) * Math.PI / 180;
          const dLng = (a.lng - homeAptN.lng) * Math.PI / 180;
          const aa = Math.sin(dLat / 2) ** 2 + Math.cos(homeAptN.lat * Math.PI / 180) * Math.cos(a.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
          const nm = R * 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
          return nm <= 50;
        }).length;
      }
    }

    // Bucket list airports that have been visited
    let bucketVisited = 0;
    try {
      const { data: bucketItems } = await supabase.from('bucket_list').select('icao').eq('user_id', user.id);
      const bucketIcaos = new Set((bucketItems ?? []).map((b: any) => b.icao));
      bucketVisited = visitedIcaos.filter(ic => bucketIcaos.has(ic)).length;
    } catch {}

    setGroups(buildGroups(airports, states, totalFlights, hasFoodVisit, hasGolfVisit, bucketCount, reportCount, followingCount, streakWeeks, hasDogVisit, hasHotelVisit, longestNm, attractionCount, nearHomeCount, bucketVisited));
    setLoading(false);
  }

  const allItems = groups.flatMap(g => g.items);
  const completed  = allItems.filter(a => a.complete).length;
  // "In Progress" = started but not finished (current > 0). Items at 0/total are Locked, not In Progress.
  const inProgress = allItems.filter(a => !a.complete && a.current > 0).length;
  const total      = allItems.length;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Text style={styles.backArrow}>‹</Text>
          <Text style={styles.backLabel}>Profile</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Achievements</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Summary — clean progress bar */}
        <View style={styles.summaryRow}>
          <Text style={styles.summaryText}>{completed} of {total} completed</Text>
          <View style={styles.summaryBar}>
            <View style={[styles.summaryBarFill, { width: total > 0 ? `${(completed / total) * 100}%` : '0%' }]} />
          </View>
        </View>

        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color="#38BDF8" />
          </View>
        ) : (
          groups.map(group => (
            <View key={group.title} style={styles.group}>
              <View style={styles.groupHeader}>
                {group.icon}
                <Text style={styles.groupTitle}>{group.title}</Text>
                <Text style={styles.groupCount}>
                  {group.items.filter(a => a.complete).length}/{group.items.length}
                </Text>
              </View>
              {group.items.map((item, i) => (
                <TouchableOpacity key={i} activeOpacity={0.7}
                  onPress={() => router.push({
                    pathname: '/achievement-detail' as any,
                    params: {
                      title: item.title,
                      hint: item.description,
                      iconKey: '',
                      difficulty: item.difficulty,
                      earned: item.complete ? 'true' : 'false',
                      current: String(item.current),
                      total: String(item.total),
                    },
                  })}
                >
                  <AchievementCard achievement={item} />
                </TouchableOpacity>
              ))}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
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
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 60 },
  summaryRow: { marginBottom: 20 },
  summaryText: { fontSize: 13, color: '#6B83A0', fontWeight: '600', marginBottom: 8 },
  summaryBar: { height: 6, backgroundColor: '#131E2D', borderRadius: 3, overflow: 'hidden' },
  summaryBarFill: { height: 6, borderRadius: 3, backgroundColor: '#38BDF8' },
  loadingWrap: { paddingVertical: 40, alignItems: 'center' },
  group: { marginBottom: 24 },
  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  groupTitle: {
    fontSize: 12, fontWeight: '700', color: '#6B83A0',
    letterSpacing: 0.8, textTransform: 'uppercase', flex: 1,
  },
  groupCount: { fontSize: 11, color: '#3D5068', fontWeight: '600' },
});
