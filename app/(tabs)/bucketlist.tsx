import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionSheetIOS, ActivityIndicator, Alert, Animated, Image, Platform,
  ScrollView, Share, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { GOOGLE_KEY } from '../../utils/config';
import airportsData from '../../assets/images/airports.json';
import { MaterialCommunityIcons, Feather } from '@expo/vector-icons';
import BackgroundWrapper from '../../components/BackgroundWrapper';
import { getSavedDestinations, unsaveDestination, type SavedDestination } from '../../utils/bucketListStorage';

// ── Types ─────────────────────────────────────────────────────────────────────

type SavedFilter = 'All' | 'Airports' | 'Festivals' | 'Events';
const SAVED_FILTERS: SavedFilter[] = ['All', 'Airports', 'Festivals', 'Events'];

type ViewMode = 'list' | 'calendar';

type SavedItem =
  | ({ _type: 'airport' } & Record<string, any>)
  | (SavedDestination & { _type: 'festival' | 'event' });

// ── Helpers ───────────────────────────────────────────────────────────────────

const FUEL_LABELS: Record<string, string> = { '100LL': '100LL', 'A': 'Jet A', 'mogas': 'Mogas' };
function formatFuel(fuel: string): string {
  return fuel.split(',').map(f => FUEL_LABELS[f.trim()] ?? f.trim()).join(' / ');
}

function getDistanceNm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3440.065;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatFlightTime(nm: number, speedKts: number): string {
  const hrs = nm / speedKts;
  const h = Math.floor(hrs);
  const m = Math.round((hrs - h) * 60);
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

function formatDateRange(start: string, end: string): string {
  const s = new Date(start + 'T12:00:00');
  const e = new Date(end + 'T12:00:00');
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  if (start === end) return s.toLocaleDateString('en-US', opts);
  if (s.getMonth() === e.getMonth()) {
    return `${s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}–${e.getDate()}`;
  }
  return `${s.toLocaleDateString('en-US', opts)} – ${e.toLocaleDateString('en-US', opts)}`;
}

function monthLabel(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function BucketListScreen() {
  const [airports, setAirports] = useState<any[]>([]);
  const [savedDestinations, setSavedDestinations] = useState<SavedDestination[]>([]);
  const [activeFilter, setActiveFilter] = useState<SavedFilter>('All');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [loading, setLoading] = useState(true);
  const [heroPhotos, setHeroPhotos] = useState<Record<string, string | null>>({});
  const [homeApt, setHomeApt] = useState<{ icao: string; lat: number; lng: number } | null>(null);
  const [amenityMap, setAmenityMap] = useState<Record<string, string[]>>({});
  const [crewCarSet, setCrewCarSet] = useState<Set<string>>(new Set());
  const router = useRouter();
  const { user } = useAuth();
  const [cruiseSpeed, setCruiseSpeed] = useState(120);

  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [calViewMonth, setCalViewMonth] = useState<Date>(() => new Date());
  const [calSelectedDay, setCalSelectedDay] = useState<string>(() => new Date().toISOString().slice(0, 10));

  // Re-fetch whenever user becomes available (handles iPad auth resolving after focus)
  useEffect(() => {
    if (user?.id) {
      fetchBucketList();
      loadHomeAirport();
      AsyncStorage.getItem(`userProfile:${user.id}`).then(raw => {
        if (!raw) return;
        try {
          const p = JSON.parse(raw);
          const s = Number(p.cruise_speed);
          if (s > 0) setCruiseSpeed(s);
        } catch {}
      });
      getSavedDestinations(user.id).then(setSavedDestinations);
    }
  }, [user?.id]);

  useFocusEffect(useCallback(() => {
    loadHomeAirport();
    fetchBucketList();
    if (user?.id) {
      AsyncStorage.getItem(`userProfile:${user.id}`).then(raw => {
        if (!raw) return;
        try {
          const p = JSON.parse(raw);
          const s = Number(p.cruise_speed);
          if (s > 0) setCruiseSpeed(s);
        } catch {}
      });
      getSavedDestinations(user.id).then(setSavedDestinations);
    }
  }, [user]));

  async function loadHomeAirport() {
    if (!user) return;
    const raw = await AsyncStorage.getItem(`userProfile:${user.id}`);
    const icao = raw ? (JSON.parse(raw).home_airport ?? null) : null;
    if (!icao) return;
    const apt = (airportsData as any[]).find(a => (a.icao ?? a.ident) === icao);
    if (apt?.lat && apt?.lng) setHomeApt({ icao, lat: apt.lat, lng: apt.lng });
  }

  async function fetchBucketList() {
    if (!user) { setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase
      .from('bucket_list')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    if (data) {
      setAirports(data);
      fetchAllHeroPhotos(data);
      fetchAmenities(data.map((a: any) => a.icao));
    }
    setLoading(false);
  }

  function fetchAllHeroPhotos(list: any[]) {
    // Use satellite tiles — no Places API calls in loops
    const results: Record<string, string | null> = {};
    for (const apt of list) {
      if (apt.lat && apt.lng) {
        results[apt.icao] = `https://maps.googleapis.com/maps/api/staticmap?center=${apt.lat},${apt.lng}&zoom=14&size=800x400&maptype=satellite&key=${GOOGLE_KEY}`;
      }
    }
    setHeroPhotos(results);
  }

  async function fetchAmenities(icaoList: string[]) {
    if (icaoList.length === 0) return;
    const { data: cacheRows } = await supabase
      .from('airport_places_cache')
      .select('airport_icao, category')
      .in('airport_icao', icaoList);
    const map: Record<string, string[]> = {};
    if (cacheRows) {
      for (const row of cacheRows) {
        if (!map[row.airport_icao]) map[row.airport_icao] = [];
        if (!map[row.airport_icao].includes(row.category)) map[row.airport_icao].push(row.category);
      }
    }
    setAmenityMap(map);
    const { data: crewRows } = await supabase
      .from('crew_cars')
      .select('icao, available, reported_at')
      .in('icao', icaoList)
      .order('reported_at', { ascending: false });
    if (crewRows) {
      const latest: Record<string, boolean> = {};
      for (const row of crewRows) {
        if (!(row.icao in latest)) latest[row.icao] = row.available;
      }
      setCrewCarSet(new Set(Object.entries(latest).filter(([, v]) => v).map(([k]) => k)));
    }
  }

  async function removeAirport(icao: string) {
    if (!user) return;
    await supabase.from('bucket_list').delete().eq('user_id', user.id).eq('icao', icao);
    setAirports(prev => prev.filter(a => a.icao !== icao));
  }

  async function removeDestination(itemId: string) {
    if (!user) return;
    await unsaveDestination(user.id, itemId);
    setSavedDestinations(prev => prev.filter(i => i.id !== itemId));
  }

  function confirmRemoveAirport(apt: any) {
    Alert.alert('Remove from Bucket List', `Remove ${apt.icao} – ${apt.name}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => removeAirport(apt.icao) },
    ]);
  }

  function confirmRemoveDestination(item: SavedDestination) {
    Alert.alert('Remove from Bucket List', `Remove ${item.event_name}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => removeDestination(item.id) },
    ]);
  }

  async function markAsFlown(airport: any) {
    if (!user) return;
    const { error } = await supabase.from('visited_airports').upsert({
      user_id: user.id, icao: airport.icao, name: airport.name,
      city: airport.city, state: airport.state,
      lat: airport.lat, lng: airport.lng,
      elevation: airport.elevation, fuel: airport.fuel,
      visited_at: new Date().toISOString(),
    }, { onConflict: 'user_id,icao' });
    if (!error) Alert.alert('Marked as Flown ✈️', `${airport.icao} added to your flight log.`);
    else Alert.alert('Error', 'Could not mark as flown. Try again.');
  }

  async function shareAirport(airport: any) {
    await Share.share({
      message: `Check out ${airport.icao} – ${airport.name} in ${airport.city}, ${airport.state}. On my LeftSeat bucket list!`,
    });
  }

  function showAirportMenu(airport: any) {
    const options = ['Open Airport', 'Mark as Flown', 'Remove from Bucket List', 'Share', 'Cancel'];
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options, cancelButtonIndex: 4, destructiveButtonIndex: 2 },
        (idx) => {
          if (idx === 0) goToAirport(airport);
          else if (idx === 1) markAsFlown(airport);
          else if (idx === 2) confirmRemoveAirport(airport);
          else if (idx === 3) shareAirport(airport);
        }
      );
    } else {
      Alert.alert(airport.icao, airport.name, [
        { text: 'Open Airport', onPress: () => goToAirport(airport) },
        { text: 'Mark as Flown', onPress: () => markAsFlown(airport) },
        { text: 'Remove', style: 'destructive', onPress: () => confirmRemoveAirport(airport) },
        { text: 'Share', onPress: () => shareAirport(airport) },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  }

  function goToAirport(airport: any) {
    router.push({
      pathname: '/airport',
      params: {
        icao: airport.icao, name: airport.name,
        city: airport.city, state: airport.state,
        lat: airport.lat, lng: airport.lng,
        elevation: airport.elevation, fuel: airport.fuel,
      },
    });
  }

  // ── Merged + filtered list ────────────────────────────────────────────────

  const festivals = savedDestinations.filter(d => d._type === 'festival');
  const events    = savedDestinations.filter(d => d._type === 'event');

  const allItems: SavedItem[] = [
    ...airports.map(a => ({ ...a, _type: 'airport' as const })),
    ...savedDestinations,
  ];

  const filteredItems = allItems.filter(item => {
    if (activeFilter === 'All') return true;
    if (activeFilter === 'Airports') return item._type === 'airport';
    if (activeFilter === 'Festivals') return item._type === 'festival';
    if (activeFilter === 'Events') return item._type === 'event';
    return true;
  });

  // ── Calendar: festivals + events sorted by start_date, grouped by month ──

  const calendarItems = [...savedDestinations]
    .sort((a, b) => a.start_date.localeCompare(b.start_date));

  const calendarGroups: { month: string; items: SavedDestination[] }[] = [];
  for (const item of calendarItems) {
    const month = monthLabel(item.start_date);
    const last = calendarGroups[calendarGroups.length - 1];
    if (last?.month === month) last.items.push(item);
    else calendarGroups.push({ month, items: [item] });
  }

  // ── Calendar grid helpers ─────────────────────────────────────────────────

  const calDayGrid = useMemo(() => {
    const year = calViewMonth.getFullYear();
    const month = calViewMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startOffset = firstDay.getDay();
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

  const destByDate = useMemo(() => {
    const map = new Map<string, SavedDestination[]>();
    for (const item of calendarItems) {
      const key = item.start_date;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return map;
  }, [calendarItems]);

  const selectedDayItems = useMemo(() => {
    return calendarItems
      .filter(item => calSelectedDay >= item.start_date && calSelectedDay <= item.end_date)
      .sort((a, b) => a.start_date.localeCompare(b.start_date));
  }, [calendarItems, calSelectedDay]);

  const listFade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    listFade.setValue(0);
    Animated.timing(listFade, { toValue: 1, duration: 200, useNativeDriver: true }).start();
  }, [calSelectedDay]);

  // ── Empty state copy ──────────────────────────────────────────────────────

  const emptyMessages: Record<SavedFilter, { title: string; body: string }> = {
    All:       { title: 'Nothing saved yet', body: 'Save airports, festivals, and events to build your bucket list' },
    Airports:  { title: 'No airports saved', body: 'Tap "Add to Bucket List" on any airport to save it here' },
    Festivals: { title: 'No festivals saved', body: 'Tap Save on any festival in the Events tab' },
    Events:    { title: 'No events saved', body: 'Tap the bookmark on any aviation event to save it here' },
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <BackgroundWrapper style={styles.container}>

      {/* Header */}
      <View style={styles.header}>
        <LinearGradient
          colors={['rgba(38, 78, 140, 0.07)', 'transparent']}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />

        <View style={styles.greetingRow}>
          <View style={styles.greetingAccent} />
          <Text style={styles.greeting}>My Bucket List</Text>
        </View>

        <Text style={styles.title}>Saved Destinations</Text>

        {/* Segmented type filter */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} style={{ marginBottom: 14 }}>
          {SAVED_FILTERS.map(f => (
            <TouchableOpacity
              key={f}
              style={[styles.filterChip, activeFilter === f && styles.filterChipActive]}
              onPress={() => { setActiveFilter(f); setViewMode('list'); }}
              activeOpacity={0.75}
            >
              <Text style={[styles.filterChipText, activeFilter === f && styles.filterChipTextActive]}>{f}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* List | Calendar toggle — only shown when there are dated items */}
        {savedDestinations.length > 0 && (
          <View style={styles.viewToggleRow}>
            {(['list', 'calendar'] as ViewMode[]).map(mode => (
              <TouchableOpacity
                key={mode}
                style={[styles.viewToggleBtn, viewMode === mode && styles.viewToggleBtnActive]}
                onPress={() => setViewMode(mode)}
                activeOpacity={0.75}
              >
                <MaterialCommunityIcons
                  name={mode === 'list' ? 'view-list-outline' : 'calendar-month-outline'}
                  size={14}
                  color={viewMode === mode ? '#38BDF8' : '#3A5472'}
                />
                <Text style={[styles.viewToggleText, viewMode === mode && styles.viewToggleTextActive]}>
                  {mode === 'list' ? 'List' : 'Calendar'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color="#38BDF8" size="large" />
          <Text style={styles.loadingText}>Loading your bucket list...</Text>
        </View>

      ) : viewMode === 'calendar' ? (
        /* ── Calendar View ─────────────────────────────────────────────── */
        <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
          {(() => {
            const DAYS_OF_WEEK = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
            const monthLbl = calViewMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
            const selectedFmt = new Date(calSelectedDay + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
            return (
              <View style={{ paddingBottom: 40 }}>
                {/* Month nav */}
                <View style={styles.calNavRow}>
                  <TouchableOpacity
                    style={styles.calNavBtn}
                    onPress={() => setCalViewMonth(m => { const n = new Date(m); n.setMonth(n.getMonth() - 1); return n; })}
                    activeOpacity={0.7}
                  >
                    <Feather name="chevron-left" size={20} color="#F0F4FF" />
                  </TouchableOpacity>
                  <Text style={styles.calNavTitle}>{monthLbl}</Text>
                  <TouchableOpacity
                    style={styles.calNavBtn}
                    onPress={() => setCalViewMonth(m => { const n = new Date(m); n.setMonth(n.getMonth() + 1); return n; })}
                    activeOpacity={0.7}
                  >
                    <Feather name="chevron-right" size={20} color="#F0F4FF" />
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
                    const dayItems = destByDate.get(dateStr) ?? [];
                    const dots = dayItems.slice(0, 3);
                    return (
                      <TouchableOpacity
                        key={dateStr}
                        style={styles.calDayCell}
                        onPress={() => setCalSelectedDay(dateStr)}
                        activeOpacity={0.55}
                      >
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
                            {dots.map((item, i) => (
                              <View key={i} style={[styles.calDot, { backgroundColor: item._type === 'event' ? '#38BDF8' : '#FF4D00' }]} />
                            ))}
                          </View>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Divider + selected day list */}
                <View style={styles.calDivider} />
                <View style={{ paddingHorizontal: 16 }}>
                  <Text style={styles.calSelDayLabel}>{selectedFmt.toUpperCase()}</Text>
                  <View style={styles.calSelDayRule} />
                  <Animated.View style={{ opacity: listFade }}>
                    {selectedDayItems.length === 0 ? (
                      <Text style={styles.calNoEvents}>Clear skies — nothing scheduled this day</Text>
                    ) : selectedDayItems.map(item => {
                      const accent = item._type === 'event' ? '#38BDF8' : '#FF4D00';
                      return (
                        <TouchableOpacity
                          key={item.id}
                          style={styles.calRow}
                          onLongPress={() => confirmRemoveDestination(item)}
                          activeOpacity={0.72}
                        >
                          <View style={[styles.calAccentBar, { backgroundColor: accent }]} />
                          <View style={styles.calRowContent}>
                            <View style={styles.calRowTop}>
                              <Text style={styles.calEventName} numberOfLines={1}>{item.event_name}</Text>
                            </View>
                            <View style={styles.calRowBottom}>
                              {item.nearest_airport ? (
                                <View style={[styles.calIcaoChip, { borderColor: accent + '66', backgroundColor: accent + '18' }]}>
                                  <Text style={[styles.calIcaoText, { color: accent }]}>{item.nearest_airport}</Text>
                                </View>
                              ) : null}
                              {(item.city || item.state) ? (
                                <Text style={styles.calLocationText} numberOfLines={1}>
                                  {item.city}{item.state ? `, ${item.state}` : ''}
                                </Text>
                              ) : null}
                            </View>
                          </View>
                          <Feather name="chevron-right" size={14} color="#4E6E8A" style={{ marginLeft: 4 }} />
                        </TouchableOpacity>
                      );
                    })}
                  </Animated.View>
                </View>
              </View>
            );
          })()}
        </ScrollView>

      ) : filteredItems.length === 0 ? (
        /* ── Empty state ───────────────────────────────────────────────── */
        <View style={styles.empty}>
          <Feather name="map" size={36} color="#6B83A0" style={{ opacity: 0.4, marginBottom: 8 }} />
          <Text style={styles.emptyTitle}>{emptyMessages[activeFilter].title}</Text>
          <Text style={styles.emptyText}>{emptyMessages[activeFilter].body}</Text>
        </View>

      ) : (
        /* ── List View ─────────────────────────────────────────────────── */
        <ScrollView style={styles.list} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
          {filteredItems.map((item) => {

            // ── Airport card ─────────────────────────────────────────────
            if (item._type === 'airport') {
              const airport = item as any;
              const heroUrl = heroPhotos[airport.icao];
              const distNm = homeApt && airport.lat && airport.lng
                ? Math.round(getDistanceNm(homeApt.lat, homeApt.lng, airport.lat, airport.lng))
                : null;
              const amenities = amenityMap[airport.icao] ?? [];
              const hasFood = amenities.includes('restaurants');
              const hasGolf = amenities.includes('golf');
              const hasStay = amenities.includes('hotels');
              const hasDo   = amenities.includes('things');
              const hasCrew = crewCarSet.has(airport.icao);
              const showChips = hasFood || hasGolf || hasStay || hasDo || hasCrew;

              return (
                <TouchableOpacity
                  key={`airport-${airport.icao}`}
                  style={styles.card}
                  onPress={() => goToAirport(airport)}
                  activeOpacity={0.88}
                >
                  <View style={styles.cardHero}>
                    {heroUrl ? (
                      <Image source={{ uri: heroUrl }} style={styles.cardHeroImg} resizeMode="cover" />
                    ) : (
                      <View style={styles.cardHeroFallback}>
                        <MaterialCommunityIcons name="airplane" size={28} color="rgba(56,189,248,0.15)" />
                        <Text style={styles.cardHeroFallbackText}>{airport.icao}</Text>
                      </View>
                    )}
                    <LinearGradient
                      colors={['rgba(4, 8, 18, 0.22)', 'transparent', 'rgba(8, 14, 26, 0.80)']}
                      locations={[0, 0.38, 1]}
                      style={StyleSheet.absoluteFill}
                      pointerEvents="none"
                    />
                    <View style={styles.typeBadge}>
                      <Text style={styles.typeBadgeText}>Airport</Text>
                    </View>
                  </View>

                  <View style={styles.cardBody}>
                    <View style={styles.cardTopRow}>
                      <Text style={styles.cardIcao}>{airport.icao}</Text>
                      <TouchableOpacity onPress={() => showAirportMenu(airport)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} style={styles.menuBtn}>
                        <Feather name="more-vertical" size={18} color="#3A5472" />
                      </TouchableOpacity>
                    </View>
                    <Text style={styles.cardName} numberOfLines={1}>{airport.name}</Text>
                    <Text style={styles.cardCity}>{airport.city}, {airport.state}</Text>
                    {distNm != null && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 4 }}>
                        <MaterialCommunityIcons name="airplane" size={13} color="#4E6E8A" />
                        <Text style={styles.cardMeta}>{distNm} nm · {formatFlightTime(distNm, cruiseSpeed)}{homeApt ? ` from ${homeApt.icao}` : ''}</Text>
                      </View>
                    )}
                    {airport.fuel ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 10 }}>
                        <MaterialCommunityIcons name="gas-station" size={13} color="#4E6E8A" />
                        <Text style={styles.cardMeta}>{formatFuel(String(airport.fuel))}</Text>
                      </View>
                    ) : null}
                    {showChips && (
                      <View style={styles.chipsRow}>
                        {hasFood && <View style={styles.chip}><MaterialCommunityIcons name="food-fork-drink" size={12} color="#4E6E8A" /><Text style={styles.chipText}>Food</Text></View>}
                        {hasGolf && <View style={styles.chip}><MaterialCommunityIcons name="golf" size={12} color="#4E6E8A" /><Text style={styles.chipText}>Golf</Text></View>}
                        {hasStay && <View style={styles.chip}><MaterialCommunityIcons name="bed-outline" size={12} color="#4E6E8A" /><Text style={styles.chipText}>Stay</Text></View>}
                        {hasDo   && <View style={styles.chip}><MaterialCommunityIcons name="flag-outline" size={12} color="#4E6E8A" /><Text style={styles.chipText}>Activities</Text></View>}
                        {hasCrew && <View style={styles.chip}><MaterialCommunityIcons name="car-outline" size={12} color="#4E6E8A" /><Text style={styles.chipText}>Crew Car</Text></View>}
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              );
            }

            // ── Festival card ────────────────────────────────────────────
            if (item._type === 'festival') {
              const fest = item as SavedDestination;
              return (
                <TouchableOpacity
                  key={`festival-${fest.id}`}
                  style={styles.card}
                  activeOpacity={0.88}
                  onLongPress={() => confirmRemoveDestination(fest)}
                >
                  <View style={[styles.cardHero, styles.cardHeroFestival]}>
                    <MaterialCommunityIcons name="ticket-outline" size={28} color="rgba(196,97,26,0.2)" />
                    <View style={styles.typeBadge}>
                      <Text style={styles.typeBadgeText}>Festival</Text>
                    </View>
                    <TouchableOpacity style={[styles.menuBtn, { position: 'absolute', top: 8, right: 10 }]} onPress={() => confirmRemoveDestination(fest)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                      <Feather name="more-vertical" size={18} color="#3A5472" />
                    </TouchableOpacity>
                  </View>
                  <View style={styles.cardBody}>
                    <Text style={styles.cardName} numberOfLines={2}>{fest.event_name}</Text>
                    <Text style={styles.cardCity}>{fest.city}, {fest.state}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 4 }}>
                      <MaterialCommunityIcons name="calendar" size={13} color="#4E6E8A" />
                      <Text style={styles.cardMeta}>{formatDateRange(fest.start_date, fest.end_date)}</Text>
                    </View>
                    {fest.nearest_airport ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                        <MaterialCommunityIcons name="airplane-landing" size={13} color="#4E6E8A" />
                        <Text style={styles.cardMeta}>{fest.nearest_airport}</Text>
                      </View>
                    ) : null}
                  </View>
                </TouchableOpacity>
              );
            }

            // ── Event card ───────────────────────────────────────────────
            if (item._type === 'event') {
              const ev = item as SavedDestination;
              return (
                <TouchableOpacity
                  key={`event-${ev.id}`}
                  style={styles.card}
                  activeOpacity={0.88}
                  onLongPress={() => confirmRemoveDestination(ev)}
                >
                  <View style={[styles.cardHero, styles.cardHeroEvent]}>
                    <MaterialCommunityIcons name="airplane" size={28} color="rgba(56,189,248,0.15)" />
                    <View style={[styles.typeBadge, styles.typeBadgeEvent]}>
                      <Text style={[styles.typeBadgeText, styles.typeBadgeTextEvent]}>Aviation Event</Text>
                    </View>
                    <TouchableOpacity style={[styles.menuBtn, { position: 'absolute', top: 8, right: 10 }]} onPress={() => confirmRemoveDestination(ev)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                      <Feather name="more-vertical" size={18} color="#3A5472" />
                    </TouchableOpacity>
                  </View>
                  <View style={styles.cardBody}>
                    <View style={styles.cardTopRow}>
                      <Text style={styles.cardIcao}>{ev.nearest_airport}</Text>
                    </View>
                    <Text style={styles.cardName} numberOfLines={2}>{ev.event_name}</Text>
                    <Text style={styles.cardCity}>{ev.city}, {ev.state}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 8 }}>
                      <MaterialCommunityIcons name="calendar" size={13} color="#4E6E8A" />
                      <Text style={styles.cardMeta}>{formatDateRange(ev.start_date, ev.end_date)}</Text>
                    </View>
                    <View style={styles.chipsRow}>
                      <View style={styles.chip}><Text style={styles.chipText}>{ev.category}</Text></View>
                    </View>
                  </View>
                </TouchableOpacity>
              );
            }

            return null;
          })}
        </ScrollView>
      )}
    </BackgroundWrapper>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  // ── Header ────────────────────────────────────────────────────────────────────
  header: { paddingTop: 70, paddingHorizontal: 20, paddingBottom: 10, overflow: 'hidden' },
  greetingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  greetingAccent: { width: 2, height: 11, borderRadius: 1, backgroundColor: '#C4611A' },
  greeting: { fontSize: 11, fontWeight: '700', color: '#5C7A96', letterSpacing: 1.4, textTransform: 'uppercase' },
  title: { fontSize: 32, fontWeight: '800', color: '#F0F4FF', letterSpacing: -0.8, marginBottom: 14 },

  // ── Type filter chips ─────────────────────────────────────────────────────────
  filterChip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    backgroundColor: '#080F1C', borderWidth: 1, borderColor: '#182C44',
  },
  filterChipActive: { backgroundColor: 'rgba(196,97,26,0.15)', borderColor: 'rgba(196,97,26,0.40)' },
  filterChipText: { fontSize: 12, fontWeight: '700', color: '#3E5269', letterSpacing: 0.2 },
  filterChipTextActive: { color: '#C4611A' },

  // ── List | Calendar toggle ────────────────────────────────────────────────────
  viewToggleRow: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  viewToggleBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10,
    backgroundColor: '#080F1C', borderWidth: 1, borderColor: '#182C44',
  },
  viewToggleBtnActive: { borderColor: 'rgba(56,189,248,0.35)', backgroundColor: 'rgba(56,189,248,0.08)' },
  viewToggleText: { fontSize: 12, fontWeight: '600', color: '#3A5472' },
  viewToggleTextActive: { color: '#38BDF8' },

  // ── States ────────────────────────────────────────────────────────────────────
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  loadingText: { color: '#6B83A0', fontSize: 14 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 12 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: '#F0F4FF', textAlign: 'center' },
  emptyText: { fontSize: 14, color: '#6B83A0', textAlign: 'center', lineHeight: 22 },

  // ── List ──────────────────────────────────────────────────────────────────────
  list: { flex: 1, paddingHorizontal: 16 },

  // ── Calendar grid ─────────────────────────────────────────────────────────────
  calNavRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  calNavBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  calNavTitle: { fontSize: 17, fontWeight: '800', color: '#F0F4FF', letterSpacing: -0.3 },
  calDowRow: { flexDirection: 'row', paddingHorizontal: 8, paddingBottom: 6 },
  calDowText: { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '700', color: '#4A5F77', letterSpacing: 0.8 },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 8, paddingBottom: 8 },
  calDayCell: { width: '14.285714%', alignItems: 'center', paddingVertical: 4 },
  calDayHalo: {
    position: 'absolute', width: 42, height: 42, borderRadius: 21,
    borderWidth: 1.5, borderColor: 'rgba(56,189,248,0.33)',
    backgroundColor: 'rgba(56,189,248,0.04)',
    shadowColor: '#38BDF8', shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.45, shadowRadius: 10,
  },
  calDayNum: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  calDayToday: { borderWidth: 1.5, borderColor: '#FF4D00', backgroundColor: 'rgba(255,77,0,0.10)' },
  calDaySelected: {
    backgroundColor: '#38BDF8',
    shadowColor: '#38BDF8', shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7, shadowRadius: 10,
  },
  calDayNumText: { fontSize: 14, fontWeight: '600', color: '#F0F4FF' },
  calDayNumFaded: { color: '#2A3D52' },
  calDayTodayText: { color: '#FF4D00', fontWeight: '700' },
  calDaySelectedText: { color: '#030D1A', fontWeight: '900' },
  calDotRow: { flexDirection: 'row', gap: 3, marginTop: 3, height: 6, alignItems: 'center' },
  calDot: { width: 5, height: 5, borderRadius: 3 },
  calDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.06)', marginTop: 14, marginBottom: 0 },
  calSelDayLabel: { fontSize: 10, fontWeight: '900', color: '#8BA5BE', letterSpacing: 2.2, marginTop: 14, marginBottom: 6 },
  calSelDayRule: { height: 1, backgroundColor: 'rgba(255,255,255,0.06)', marginBottom: 12 },
  calNoEvents: { fontSize: 14, color: '#4E6E8A', paddingVertical: 20, textAlign: 'center' },
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
  calEventName: { fontSize: 14, fontWeight: '700', color: '#F0F4FF', flex: 1 },
  calRowBottom: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  calIcaoChip: { borderRadius: 6, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  calIcaoText: { fontSize: 11, fontWeight: '900', letterSpacing: 0.9 },
  calLocationText: { fontSize: 12, color: '#4E6E8A', flex: 1 },

  // ── Card ──────────────────────────────────────────────────────────────────────
  card: {
    backgroundColor: '#080F1C', borderRadius: 18, marginBottom: 20,
    borderWidth: 1, borderColor: '#182C44', overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45, shadowRadius: 16, elevation: 8,
  },
  cardHero: { width: '100%', height: 165, backgroundColor: '#080F1C' },
  cardHeroImg: { width: '100%', height: '100%' },
  cardHeroFallback: {
    width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#0A1628', gap: 6,
  },
  cardHeroFallbackText: { fontSize: 18, fontWeight: '800', color: 'rgba(56,189,248,0.18)', letterSpacing: 4 },
  cardHeroFestival: { height: 52, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(196,97,26,0.04)' },
  cardHeroEvent:    { height: 52, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(56,189,248,0.04)' },

  // Type badge — top-left corner of hero
  typeBadge: {
    position: 'absolute', top: 10, left: 10,
    backgroundColor: 'rgba(8,15,28,0.82)', borderRadius: 6,
    paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: 'rgba(196,97,26,0.30)',
  },
  typeBadgeEvent: { borderColor: 'rgba(56,189,248,0.30)' },
  typeBadgeText: { fontSize: 10, fontWeight: '700', color: '#5C7A96', letterSpacing: 0.8, textTransform: 'uppercase' },
  typeBadgeTextEvent: { color: '#38BDF8' },

  cardBody: { padding: 16, paddingTop: 14 },
  cardTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  cardIcao: { fontSize: 13, fontWeight: '800', color: '#C4611A', letterSpacing: 1.8, textTransform: 'uppercase' },
  menuBtn: { paddingLeft: 8 },
  cardName: { fontSize: 18, fontWeight: '700', color: '#EDF3FB', marginBottom: 3, letterSpacing: -0.2 },
  cardCity: { fontSize: 12, color: '#4E6E8A', marginBottom: 10, fontWeight: '500', letterSpacing: 0.1 },
  cardMeta: { fontSize: 12, color: '#7A96B0', fontWeight: '500' },

  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(78,110,138,0.08)', borderRadius: 8,
    borderWidth: 1, borderColor: 'rgba(78,110,138,0.18)',
    paddingHorizontal: 8, paddingVertical: 4,
  },
  chipText: { fontSize: 11, color: '#8AAABF', fontWeight: '600', letterSpacing: 0.2 },
});
