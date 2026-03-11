import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, Image, Linking, Modal,
  ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import airportsData from '../assets/images/airports.json';
import WeatherWidget from '../components/WeatherWidget';
import { supabase } from '../lib/supabase';

const GOOGLE_KEY = 'AIzaSyAP7EitXnoZAhammN6w1RhvFJ2DoZnfd1k';
const airports: any[] = airportsData as any[];

// ─── Helpers ────────────────────────────────────────────────────────────────

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

// ─── Why Fly Here content by category ───────────────────────────────────────

const WHY_FLY: Record<string, string[]> = {
  beach:    ['Beach is minutes from the ramp', 'Stunning ocean approach on final', 'World-class seafood restaurants nearby', 'Easy GA parking and FBO service'],
  ski:      ['Ski resort shuttle from the terminal', 'Incredible mountain scenery on approach', 'World-class après-ski dining', 'High-altitude flying experience'],
  mountains:['Dramatic mountain approach and departure', 'Gateway to national parks and backcountry', 'Challenging and rewarding flying', 'Scenic high-country adventure'],
  golf:     ['Top-tier courses within minutes of the ramp', 'Coastal views on final approach', 'Premium dining and wine country nearby', 'Easy ground transport to courses'],
  nature:   ['Gateway to Yellowstone and Big Sky country', 'Wildlife viewing year-round', 'Unmatched scenery on every departure', 'Rugged outdoor adventure awaits'],
  tropical: ['Fly to the southernmost runway in the US', 'Warm flying weather year-round', 'Beautiful island scenery on approach', 'Vibrant waterfront dining and nightlife'],
  city:     ['Urban flying with stunning skyline views', 'World-class dining and culture', 'Well-equipped FBO with fast service', 'Easy access to downtown'],
  food:     ['Renowned restaurant scene nearby', 'Worth the flight for the food alone', 'Great FBO with pilot-friendly crew', 'Easy GA access to a foodie destination'],
  camping:  ['Trailhead access from the ramp', 'True backcountry flying experience', 'Minimal traffic, maximum adventure', 'Stars you can only see from the wilderness'],
  brewery:  ['Local craft brewery within walking distance', 'Small-town charm and hospitality', 'Scenic approach and quiet pattern', 'A destination worth repeating'],
};

const DEFAULT_WHY = [
  'Unique destination for GA pilots',
  'Well-maintained GA ramp and FBO',
  'Great local dining and activities nearby',
  'A flight worth making',
];

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function AirportScreen() {
  const [activeTab, setActiveTab] = useState('info');
  const [weather, setWeather] = useState<any>(null);
  const [weatherLoading, setWeatherLoading] = useState(true);
  const [weatherError, setWeatherError] = useState(false);
  const [places, setPlaces] = useState<any>({ restaurants: [], hotels: [], golf: [], things: [] });
  const [placesLoading, setPlacesLoading] = useState(true);
  const [runways, setRunways] = useState<any[]>([]);
  const [heroPhoto, setHeroPhoto] = useState<string | null>(null);
  const [inBucketList, setInBucketList] = useState(false);
  const [crewCar, setCrewCar] = useState<any>(null);
  const [crewCarModal, setCrewCarModal] = useState(false);
  const [homeIcao, setHomeIcao] = useState<string | null>(null);
  const [distFromHome, setDistFromHome] = useState<{ nm: number; time: string } | null>(null);
  const saveAnim = useRef(new Animated.Value(1)).current;
  const router = useRouter();

  const {
    icao, name, city, state, lat, lng, elevation, fuel,
    runways: runwaysParam, description, category,
  } = useLocalSearchParams();

  const airport = {
    icao: icao || 'KSBA',
    name: name || 'Santa Barbara Municipal',
    city: city && state ? `${city}, ${state}` : 'Santa Barbara, CA',
    elevation: elevation ? `${elevation} ft MSL` : '—',
    fuel: fuel || '—',
  };

  const airportLat = lat ? parseFloat(lat as string) : null;
  const airportLng = lng ? parseFloat(lng as string) : null;

  const whyBullets: string[] = WHY_FLY[(category as string) || ''] || DEFAULT_WHY;

  // ── Effects ───────────────────────────────────────────────────────────────

  useEffect(() => {
    fetchWeather();
    fetchRunways();
    fetchAirportPhoto();
    fetchCrewCar();
    if (airportLat && airportLng) {
      fetchPlaces(airportLat, airportLng);
    } else {
      fetchAirportCoords();
    }
  }, [icao]);

  useEffect(() => {
    supabase.from('bucket_list').select('id').eq('user_id', 'mitchell').eq('icao', icao).single()
      .then(({ data }) => { if (data) setInBucketList(true); });
  }, [icao]);

  // Load home airport and calculate distance
  useEffect(() => {
    AsyncStorage.getItem('userProfile').then((data) => {
      if (!data) return;
      const profile = JSON.parse(data);
      const speed = profile.cruise_speed ? Number(profile.cruise_speed) : 150;
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

  function handleSaveBucketList() {
    Animated.sequence([
      Animated.timing(saveAnim, { toValue: 0.92, duration: 90, useNativeDriver: true }),
      Animated.spring(saveAnim, { toValue: 1, friction: 4, useNativeDriver: true }),
    ]).start();
    toggleBucketList();
  }

  async function toggleBucketList() {
    if (inBucketList) {
      await supabase.from('bucket_list').delete().eq('user_id', 'mitchell').eq('icao', icao);
      setInBucketList(false);
    } else {
      await supabase.from('bucket_list').insert({
        user_id: 'mitchell', icao, name, city, state,
        lat: airportLat, lng: airportLng,
        elevation: elevation ? parseInt(elevation as string) : null, fuel,
      });
      setInBucketList(true);
    }
  }

  async function fetchAirportPhoto() {
    try {
      const query = encodeURIComponent(`${name} airport`);
      const res = await fetch(`https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${query}&inputtype=textquery&fields=photos&key=${GOOGLE_KEY}`);
      const data = await res.json();
      const ref = data.candidates?.[0]?.photos?.[0]?.photo_reference;
      if (ref) setHeroPhoto(`https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photoreference=${ref}&key=${GOOGLE_KEY}`);
    } catch {}
  }

  async function fetchCrewCar() {
    try {
      const { data } = await supabase.from('crew_cars').select('*').eq('icao', icao).order('reported_at', { ascending: false }).limit(1).single();
      if (data) setCrewCar(data);
    } catch { setCrewCar(null); }
  }

  async function fetchWeather() {
    setWeatherLoading(true);
    setWeatherError(false);
    try {
      const id = (icao || 'KSBA').toString().toUpperCase();
      const res = await fetch(`https://aviationweather.gov/api/data/metar?ids=${id}&format=json`);
      const data = await res.json();
      if (data && data.length > 0) {
        setWeather(parseMetar(data[0]));
      } else {
        setWeatherError(true);
      }
    } catch { setWeatherError(true); }
    finally { setWeatherLoading(false); }
  }

  async function fetchRunways() {
    try {
      if (runwaysParam) {
        const parsed = JSON.parse(runwaysParam as string);
        if (parsed && parsed.length > 0) { setRunways(parsed); return; }
      }
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

  async function fetchPlaces(lat: number, lng: number) {
    setPlacesLoading(true);
    try {
      const radius = 8000;
      const base = `https://maps.googleapis.com/maps/api/place/nearbysearch/json`;
      const [restRes, hotelRes, golfRes, thingsRes] = await Promise.all([
        fetch(`${base}?location=${lat},${lng}&radius=${radius}&type=restaurant&key=${GOOGLE_KEY}`),
        fetch(`${base}?location=${lat},${lng}&radius=${radius}&type=lodging&key=${GOOGLE_KEY}`),
        fetch(`${base}?location=${lat},${lng}&radius=${radius}&keyword=golf+course&key=${GOOGLE_KEY}`),
        fetch(`${base}?location=${lat},${lng}&radius=${radius}&type=tourist_attraction&key=${GOOGLE_KEY}`),
      ]);
      const [restData, hotelData, golfData, thingsData] = await Promise.all([
        restRes.json(), hotelRes.json(), golfRes.json(), thingsRes.json(),
      ]);

      function parseResults(data: any) {
        return (data.results || [])
          .sort((a: any, b: any) =>
            (a.geometry?.location?.lat ? getDistanceMiles(airportLat!, airportLng!, a.geometry.location.lat, a.geometry.location.lng) : 999) -
            (b.geometry?.location?.lat ? getDistanceMiles(airportLat!, airportLng!, b.geometry.location.lat, b.geometry.location.lng) : 999)
          )
          .slice(0, 6)
          .map((p: any) => ({
            name: p.name,
            type: p.types?.[0]?.replace(/_/g, ' ') || '',
            rating: p.rating ? `${p.rating} ⭐ (${p.user_ratings_total})` : 'No rating',
            distance: p.vicinity || '',
            distanceMiles: (p.geometry?.location?.lat && airportLat)
              ? Math.round(getDistanceMiles(airportLat, airportLng!, p.geometry.location.lat, p.geometry.location.lng) * 10) / 10
              : null,
            open: p.opening_hours?.open_now,
            lat: p.geometry?.location?.lat,
            lng: p.geometry?.location?.lng,
            placeId: p.place_id || null,
          }));
      }

      setPlaces({ restaurants: parseResults(restData), hotels: parseResults(hotelData), golf: parseResults(golfData), things: parseResults(thingsData) });
    } catch {}
    finally { setPlacesLoading(false); }
  }

  function parseMetar(raw: any) {
    const windDir = raw.wdir ?? '—';
    const windSpd = raw.wspd ?? '—';
    const windGust = raw.wgst ? ` G${raw.wgst}` : '';
    const vis = raw.visib ?? '—';
    const temp = raw.temp != null ? `${raw.temp}°C / ${Math.round(raw.temp * 9 / 5 + 32)}°F` : '—';
    const dewpoint = raw.dewp != null ? `${raw.dewp}°C` : '—';
    const altimeter = raw.altim != null ? `${raw.altim.toFixed(2)} inHg` : '—';
    const clouds = raw.clouds?.length > 0
      ? raw.clouds.map((c: any) => `${c.cover} ${c.base ? c.base.toLocaleString() + ' ft' : ''}`).join(', ')
      : 'Clear';
    const visNum = parseFloat(raw.visib) || 10;
    const cloudBase = raw.clouds?.length > 0 ? (raw.clouds[0].base || 999) * 100 : 99900;
    let flightCat = 'VFR';
    if (visNum < 1 || cloudBase < 500) flightCat = 'LIFR';
    else if (visNum < 3 || cloudBase < 1000) flightCat = 'IFR';
    else if (visNum <= 5 || cloudBase <= 3000) flightCat = 'MVFR';
    const metar = raw.rawOb || '—';
    const catColor = flightCat === 'VFR' ? '#22c55e' : flightCat === 'MVFR' ? '#3b82f6' : flightCat === 'IFR' ? '#ef4444' : '#a855f7';
    return { windDir, windSpd, windGust, vis, temp, dewpoint, altimeter, clouds, flightCat, catColor, metar };
  }

  function flightConditionLabel(cat: string) {
    if (cat === 'VFR') return '✅  VFR — Good to go';
    if (cat === 'MVFR') return '🔵  MVFR — Marginal conditions';
    if (cat === 'IFR') return '🔴  IFR — Instrument conditions';
    if (cat === 'LIFR') return '🟣  LIFR — Low IFR';
    return cat;
  }

  function openMap() {
    if (!airportLat || !airportLng) return;
    Linking.openURL(`maps://?ll=${airportLat},${airportLng}&q=${encodeURIComponent(String(airport.name))}`);
  }

  function openDirections() {
    if (!airportLat || !airportLng) return;
    Linking.openURL(`maps://?daddr=${airportLat},${airportLng}`);
  }

  const tabs = ['info', 'eat', 'stay', 'golf', 'do'];
  const tabLabels: Record<string, string> = { info: 'Info', eat: '🍽 Eat', stay: '🏨 Stay', golf: '⛳ Golf', do: '🎯 Do' };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>

      {/* Hero */}
      <View style={styles.hero}>
        {heroPhoto && <Image source={{ uri: heroPhoto }} style={styles.heroImage} resizeMode="cover" />}
        {/* Gradient simulation: light top scrim + heavy bottom scrim */}
        <View style={styles.heroScrimTop} />
        <View style={styles.heroScrimBottom} />
        <View style={styles.heroOverlay}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
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
            <View style={styles.metaPill}><Text style={styles.metaText}>⛽ {airport.fuel}</Text></View>
            <View style={styles.metaPill}><Text style={styles.metaText}>📏 {airport.elevation}</Text></View>
          </View>
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
            <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>{tabLabels[tab]}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {activeTab === 'info' && (
          <View>

            {/* ── Quick Action Buttons ─────────────────────────── */}
            <View style={styles.actionRow}>
              <TouchableOpacity style={styles.actionBtn} activeOpacity={0.65} onPress={openMap}>
                <Text style={styles.actionIcon}>🗺</Text>
                <Text style={styles.actionBtnText}>View on Map</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionBtn} activeOpacity={0.65} onPress={openDirections}>
                <Text style={styles.actionIcon}>📍</Text>
                <Text style={styles.actionBtnText}>Directions</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.actionBtn}
                activeOpacity={0.65}
                onPress={() => Linking.openURL(`tel:+1`).catch(() => {})}
              >
                <Text style={styles.actionIcon}>📞</Text>
                <Text style={styles.actionBtnText}>Call FBO</Text>
              </TouchableOpacity>
            </View>

            {/* ── Weather ─────────────────────────────────────── */}
            <Text style={styles.sectionTitle}>Current Weather</Text>
            {weatherLoading && (
              <View style={styles.loadingBox}>
                <ActivityIndicator color="#38BDF8" />
                <Text style={styles.loadingText}>Fetching live weather...</Text>
              </View>
            )}
            {weatherError && !weatherLoading && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>⚠️ Could not load weather for {airport.icao}</Text>
                <TouchableOpacity onPress={fetchWeather} style={styles.retryBtn}>
                  <Text style={styles.retryText}>Retry</Text>
                </TouchableOpacity>
              </View>
            )}
            {weather && !weatherLoading && (
              <View style={styles.weatherCard}>
                <WeatherWidget weather={weather} />
                <View style={[styles.flightCatBanner, { borderColor: weather.catColor }]}>
                  <Text style={[styles.flightCatText, { color: weather.catColor }]}>
                    {flightConditionLabel(weather.flightCat)}
                  </Text>
                </View>
                <View style={styles.weatherRow}><Text style={styles.weatherLabel}>Wind</Text><Text style={styles.weatherValue}>{weather.windDir}° at {weather.windSpd}{weather.windGust} kts</Text></View>
                <View style={styles.weatherRow}><Text style={styles.weatherLabel}>Visibility</Text><Text style={styles.weatherValue}>{weather.vis} SM</Text></View>
                <View style={styles.weatherRow}><Text style={styles.weatherLabel}>Clouds</Text><Text style={styles.weatherValue}>{weather.clouds}</Text></View>
                <View style={styles.weatherRow}><Text style={styles.weatherLabel}>Temperature</Text><Text style={styles.weatherValue}>{weather.temp}</Text></View>
                <View style={styles.weatherRow}><Text style={styles.weatherLabel}>Dewpoint</Text><Text style={styles.weatherValue}>{weather.dewpoint}</Text></View>
                <View style={styles.weatherRow}><Text style={styles.weatherLabel}>Altimeter</Text><Text style={styles.weatherValue}>{weather.altimeter}</Text></View>
                <View style={[styles.metarBox, { marginBottom: 0, marginTop: 8 }]}>
                  <Text style={styles.metarLabel}>RAW METAR</Text>
                  <Text style={styles.metarText}>{weather.metar}</Text>
                </View>
              </View>
            )}

            {/* ── Why Fly Here ─────────────────────────────────── */}
            <Text style={[styles.sectionTitle, styles.sectionTitleWhy]}>Why Fly Here</Text>
            <View style={styles.whyCard}>
              {description ? (
                <Text style={styles.whyDescription}>{description as string}</Text>
              ) : null}
              {whyBullets.map((bullet, i) => (
                <View key={i} style={[styles.whyRow, i === whyBullets.length - 1 && { marginBottom: 0 }]}>
                  <Text style={styles.whyDot}>•</Text>
                  <Text style={styles.whyText}>{bullet}</Text>
                </View>
              ))}
            </View>

            {/* ── Runways ──────────────────────────────────────── */}
            <Text style={styles.sectionTitle}>Runways</Text>
            {runways.length > 0 ? (
              <View style={styles.runwayGrid}>
                {runways.map((rwy: any, i: number) => (
                  <View key={i} style={styles.runwayCard}>
                    <Text style={styles.runwayIcon}>🛬</Text>
                    <View style={styles.runwayInfo}>
                      <Text style={styles.runwayId}>Runway {rwy.id}</Text>
                      <Text style={styles.runwayMeta}>
                        {rwy.length ? `${Number(rwy.length).toLocaleString()} ft` : '—'}
                        {rwy.surface ? ` · ${rwy.surface}` : ''}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            ) : (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyText}>Runway data unavailable</Text>
              </View>
            )}

            {/* ── FBO ──────────────────────────────────────────── */}
            <Text style={styles.sectionTitle}>FBO</Text>
            <View style={styles.fboCard}>
              <View style={styles.fboRow}>
                <Text style={styles.fboIcon}>🏢</Text>
                <View style={styles.fboInfo}>
                  <Text style={styles.fboName}>Fixed Base Operator</Text>
                  <Text style={styles.fboDetail}>Fuel: {airport.fuel}</Text>
                  <Text style={styles.fboDetail}>Pilot lounge · Courtesy car · Self-serve available</Text>
                </View>
              </View>
            </View>

            {/* ── Crew Car ─────────────────────────────────────── */}
            <Text style={styles.sectionTitle}>Crew Car</Text>
            <View style={styles.listItem}>
              <Text style={styles.listIcon}>🚗</Text>
              <View style={{ flex: 1 }}>
                {crewCar ? (
                  <>
                    <Text style={styles.listText}>{crewCar.available ? '✅ Available' : '❌ Not Available'}{crewCar.cost ? ` · ${crewCar.cost}` : ''}</Text>
                    {crewCar.notes ? <Text style={styles.listSub}>{crewCar.notes}</Text> : null}
                  </>
                ) : <Text style={styles.listText}>No reports yet — be the first!</Text>}
              </View>
              <TouchableOpacity style={styles.reportBtn} onPress={() => setCrewCarModal(true)}>
                <Text style={styles.reportBtnText}>Report</Text>
              </TouchableOpacity>
            </View>

            {crewCarModal && (
              <View style={styles.inlineModal}>
                <Text style={styles.modalTitle}>Report Crew Car</Text>
                <View style={styles.modalBtns}>
                  <TouchableOpacity style={styles.modalOption} onPress={async () => {
                    await supabase.from('crew_cars').insert({ icao, user_id: 'mitchell', available: true, cost: 'free' });
                    fetchCrewCar(); setCrewCarModal(false);
                  }}>
                    <Text style={styles.modalOptionText}>✅ Available</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.modalOption, { borderColor: '#ef4444' }]} onPress={async () => {
                    await supabase.from('crew_cars').insert({ icao, user_id: 'mitchell', available: false });
                    fetchCrewCar(); setCrewCarModal(false);
                  }}>
                    <Text style={[styles.modalOptionText, { color: '#ef4444' }]}>❌ Unavailable</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.modalOption, { borderColor: '#38BDF8' }]} onPress={() => {
                    setCrewCarModal(false);
                    Linking.openURL(`tel:+1`).catch(() => {});
                  }}>
                    <Text style={[styles.modalOptionText, { color: '#38BDF8' }]}>📞 Call FBO</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.modalCancel} onPress={() => setCrewCarModal(false)}>
                    <Text style={styles.modalCancelText}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        )}

        {activeTab === 'eat' && (placesLoading ? <LoadingPlaces /> : places.restaurants.length > 0 ? places.restaurants.map((r: any, i: number) => <PlaceCard key={i} place={r} />) : <EmptyPlaces label="restaurants" />)}
        {activeTab === 'stay' && (placesLoading ? <LoadingPlaces /> : places.hotels.length > 0 ? places.hotels.map((r: any, i: number) => <PlaceCard key={i} place={r} />) : <EmptyPlaces label="hotels" />)}
        {activeTab === 'golf' && (placesLoading ? <LoadingPlaces /> : places.golf.length > 0 ? places.golf.map((r: any, i: number) => <PlaceCard key={i} place={r} />) : <EmptyPlaces label="golf courses" />)}
        {activeTab === 'do' && (placesLoading ? <LoadingPlaces /> : places.things.length > 0 ? places.things.map((r: any, i: number) => <PlaceCard key={i} place={r} />) : <EmptyPlaces label="attractions" />)}

        <View style={{ height: 110 }} />
      </ScrollView>

      {/* Bucket List CTA */}
      <Animated.View style={{ transform: [{ scale: saveAnim }], margin: 16 }}>
        <TouchableOpacity
          style={[styles.saveBtn, inBucketList && styles.saveBtnActive]}
          onPress={handleSaveBucketList}
        >
          <Text style={styles.saveBtnText}>
            {inBucketList ? '✅  In My Bucket List' : '⭐  Save to Bucket List'}
          </Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function PlaceCard({ place }: { place: any }) {
  const [modalVisible, setModalVisible] = useState(false);
  const [details, setDetails] = useState<any>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  async function openPlaceDetails() {
    setModalVisible(true);
    if (details) return;
    setLoadingDetails(true);
    try {
      const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place.placeId}&fields=name,formatted_phone_number,website,opening_hours,rating,user_ratings_total,price_level,formatted_address&key=${GOOGLE_KEY}`;
      const res = await fetch(url);
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

  return (
    <>
      <TouchableOpacity style={styles.placeCard} onPress={openPlaceDetails}>
        <View style={styles.placeInfo}>
          <Text style={styles.placeName}>{place.name}</Text>
          <Text style={styles.placeType}>{place.type}</Text>
        </View>
        <View style={styles.placeMeta}>
          <Text style={styles.placeRating}>{place.rating}</Text>
          <Text style={styles.placeDistance}>{place.distanceMiles ? `${place.distanceMiles} mi` : place.distance}</Text>
        </View>
      </TouchableOpacity>

      <Modal visible={modalVisible} animationType="slide" presentationStyle="pageSheet">
        <View style={styles.placeModal}>
          <View style={styles.placeModalHeader}>
            <TouchableOpacity onPress={() => setModalVisible(false)}>
              <Text style={styles.placeModalClose}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.placeModalBody}>
            {loadingDetails ? (
              <ActivityIndicator color="#38BDF8" size="large" style={{ marginTop: 40 }} />
            ) : (
              <>
                <Text style={styles.placeModalName}>{details?.name || place.name}</Text>
                {details?.formatted_address && <Text style={styles.placeModalAddress}>{details.formatted_address}</Text>}
                <View style={styles.placeModalPills}>
                  {details?.rating && <View style={styles.pill}><Text style={styles.pillText}>⭐ {details.rating} ({details.user_ratings_total})</Text></View>}
                  {priceLevel && <View style={styles.pill}><Text style={styles.pillText}>{priceLevel}</Text></View>}
                  {isOpen !== undefined && (
                    <View style={[styles.pill, { backgroundColor: isOpen ? '#14532D' : '#450A0A' }]}>
                      <Text style={[styles.pillText, { color: isOpen ? '#22C55E' : '#EF4444' }]}>{isOpen ? '✓ Open Now' : '✗ Closed'}</Text>
                    </View>
                  )}
                  {place.distanceMiles && <View style={styles.pill}><Text style={styles.pillText}>📍 {place.distanceMiles} mi from airport</Text></View>}
                </View>
                {todayHours && <View style={styles.placeDetailRow}><Text style={styles.placeDetailIcon}>🕐</Text><Text style={styles.placeDetailText}>{todayHours}</Text></View>}
                {details?.formatted_phone_number && (
                  <TouchableOpacity style={styles.placeDetailRow} onPress={() => Linking.openURL(`tel:${details.formatted_phone_number}`)}>
                    <Text style={styles.placeDetailIcon}>📞</Text>
                    <Text style={[styles.placeDetailText, styles.placeDetailLink]}>{details.formatted_phone_number}</Text>
                  </TouchableOpacity>
                )}
                {details?.website && (
                  <TouchableOpacity style={styles.placeDetailRow} onPress={() => Linking.openURL(details.website)}>
                    <Text style={styles.placeDetailIcon}>🌐</Text>
                    <Text style={[styles.placeDetailText, styles.placeDetailLink]} numberOfLines={1}>{details.website.replace(/^https?:\/\//, '')}</Text>
                  </TouchableOpacity>
                )}
                <Text style={styles.placeModalSectionLabel}>OPEN IN MAPS</Text>
                <View style={styles.mapsRow}>
                  <TouchableOpacity style={styles.mapsBtn} onPress={() => openInMaps('apple')}><Text style={styles.mapsBtnText}>🍎 Apple Maps</Text></TouchableOpacity>
                  <TouchableOpacity style={styles.mapsBtn} onPress={() => openInMaps('google')}><Text style={styles.mapsBtnText}>🗺 Google Maps</Text></TouchableOpacity>
                </View>
              </>
            )}
          </ScrollView>
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

function EmptyPlaces({ label }: { label: string }) {
  return (
    <View style={styles.errorBox}>
      <Text style={styles.errorText}>No {label} found nearby</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#070B14' },

  // Hero
  hero: { height: 230, backgroundColor: '#0D1421', borderBottomWidth: 1, borderBottomColor: '#1E2D45' },
  heroImage: { position: 'absolute', width: '100%', height: '100%' },
  heroScrimTop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.18)' },
  heroScrimBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 210, backgroundColor: 'rgba(0,0,0,0.72)' },
  heroOverlay: { flex: 1, paddingTop: 60, paddingHorizontal: 20, paddingBottom: 16 },
  backBtn: { marginBottom: 10 },
  backText: { color: '#38BDF8', fontSize: 14, fontWeight: '600' },
  icao: { fontSize: 12, fontWeight: '700', color: '#38BDF8', letterSpacing: 2, marginBottom: 3 },
  airportName: { fontSize: 22, fontWeight: '800', color: '#F0F4FF', marginBottom: 3 },
  city: { fontSize: 13, color: '#8A9BB5', marginBottom: 6 },
  distPill: { backgroundColor: 'rgba(249,115,22,0.12)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, alignSelf: 'flex-start', borderWidth: 1, borderColor: 'rgba(249,115,22,0.35)', marginBottom: 10 },
  distLine: { fontSize: 14, color: '#F97316', fontWeight: '800', letterSpacing: 0.4 },
  heroMeta: { flexDirection: 'row', gap: 10 },
  metaPill: { backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 6, borderWidth: 1, borderColor: '#1E2D45' },
  metaText: { fontSize: 12, color: '#F0F4FF' },

  // Tabs
  tabBar: { flexDirection: 'row', backgroundColor: '#0D1421', borderBottomWidth: 1, borderBottomColor: '#1E2D45' },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabActive: { borderBottomWidth: 3, borderBottomColor: '#38BDF8' },
  tabText: { fontSize: 12, color: '#4A5B73', fontWeight: '600' },
  tabTextActive: { color: '#FFFFFF', fontWeight: '700' },
  content: { flex: 1, padding: 20 },

  // Section label
  sectionTitle: { fontSize: 11, fontWeight: '700', color: '#6A7B93', letterSpacing: 1.8, textTransform: 'uppercase', marginBottom: 12, marginTop: 8 },
  sectionTitleWhy: { fontSize: 12, color: '#8A9BB5', letterSpacing: 2.2 },

  // Quick actions
  actionRow: { flexDirection: 'row', gap: 10, marginBottom: 24 },
  actionBtn: { flex: 1, backgroundColor: '#0D1421', borderRadius: 12, paddingVertical: 16, alignItems: 'center', borderWidth: 1, borderColor: '#1E2D45', gap: 6 },
  actionIcon: { fontSize: 18 },
  actionBtnText: { fontSize: 11, color: '#8A9BB5', fontWeight: '700', textAlign: 'center' },

  // Weather
  loadingBox: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#0D1421', borderRadius: 12, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#1E2D45' },
  loadingText: { color: '#4A5B73', fontSize: 13 },
  errorBox: { backgroundColor: '#0D1421', borderRadius: 12, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#1E2D4560', alignItems: 'center' },
  errorText: { color: '#8A9BB5', fontSize: 13, marginBottom: 10 },
  retryBtn: { backgroundColor: '#1E2D45', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 },
  retryText: { color: '#F0F4FF', fontSize: 12, fontWeight: '600' },
  flightCatBanner: { borderRadius: 10, borderWidth: 1.5, paddingVertical: 14, paddingHorizontal: 16, marginBottom: 14, marginTop: 4, alignItems: 'center' },
  flightCatText: { fontSize: 15, fontWeight: '700' },
  weatherCard: { backgroundColor: '#0D1421', borderRadius: 12, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: '#1E2D45' },
  weatherRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: '#1E2D45' },
  weatherLabel: { fontSize: 13, color: '#4A5B73' },
  weatherValue: { fontSize: 13, color: '#F0F4FF', fontWeight: '600', textAlign: 'right', flex: 1, marginLeft: 16 },
  metarBox: { backgroundColor: '#070B14', borderRadius: 8, padding: 12, marginBottom: 20 },
  metarLabel: { fontSize: 9, color: '#1E2D45', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 6 },
  metarText: { fontSize: 11, color: '#4A5B73', fontFamily: 'Courier' },

  // Why Fly Here
  whyCard: { backgroundColor: '#0D1421', borderRadius: 14, padding: 16, marginBottom: 4, borderWidth: 1, borderColor: '#1E2D45' },
  whyDescription: { fontSize: 14, color: '#8A9BB5', lineHeight: 20, marginBottom: 12, fontStyle: 'italic' },
  whyRow: { flexDirection: 'row', gap: 10, marginBottom: 14, alignItems: 'flex-start' },
  whyDot: { fontSize: 16, color: '#38BDF8', lineHeight: 20, fontWeight: '700' },
  whyText: { flex: 1, fontSize: 14, color: '#D0D8E8', lineHeight: 20 },

  // Runways
  runwayGrid: { gap: 10, marginBottom: 4 },
  runwayCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#111827', borderRadius: 12, padding: 18, borderWidth: 1, borderColor: '#243550' },
  runwayIcon: { fontSize: 22 },
  runwayInfo: { flex: 1 },
  runwayId: { fontSize: 15, fontWeight: '700', color: '#F0F4FF', marginBottom: 3 },
  runwayMeta: { fontSize: 13, color: '#4A5B73' },
  emptyCard: { backgroundColor: '#0D1421', borderRadius: 12, padding: 16, marginBottom: 4, borderWidth: 1, borderColor: '#1E2D45', alignItems: 'center' },
  emptyText: { color: '#4A5B73', fontSize: 13 },

  // FBO
  fboCard: { backgroundColor: '#0D1421', borderRadius: 14, padding: 16, marginBottom: 4, borderWidth: 1, borderColor: '#1E2D45' },
  fboRow: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  fboIcon: { fontSize: 24, marginTop: 2 },
  fboInfo: { flex: 1 },
  fboName: { fontSize: 15, fontWeight: '700', color: '#F0F4FF', marginBottom: 4 },
  fboDetail: { fontSize: 13, color: '#4A5B73', lineHeight: 20 },

  // Crew car
  listItem: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#0D1421', borderRadius: 10, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: '#1E2D45' },
  listIcon: { fontSize: 18 },
  listText: { fontSize: 14, color: '#F0F4FF' },
  listSub: { fontSize: 11, color: '#4A5B73', marginTop: 2 },

  // Places
  placeCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#0D1421', borderRadius: 12, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: '#1E2D45' },
  placeInfo: { flex: 1 },
  placeName: { fontSize: 15, fontWeight: '700', color: '#F0F4FF', marginBottom: 3 },
  placeType: { fontSize: 12, color: '#4A5B73' },
  placeMeta: { alignItems: 'flex-end' },
  placeRating: { fontSize: 13, color: '#F0F4FF', marginBottom: 3 },
  placeDistance: { fontSize: 12, color: '#38BDF8' },
  placeModal: { flex: 1, backgroundColor: '#070B14' },
  placeModalHeader: { padding: 20, paddingTop: 60, alignItems: 'flex-end', borderBottomWidth: 1, borderBottomColor: '#1E2D45' },
  placeModalClose: { fontSize: 20, color: '#4A5B73' },
  placeModalBody: { padding: 20 },
  placeModalName: { fontSize: 26, fontWeight: '800', color: '#F0F4FF', marginBottom: 6 },
  placeModalAddress: { fontSize: 13, color: '#4A5B73', marginBottom: 16, lineHeight: 18 },
  placeModalPills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  pill: { backgroundColor: '#111827', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: '#1E2D45' },
  pillText: { fontSize: 12, color: '#8A9BB5', fontWeight: '600' },
  placeDetailRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#1E2D45' },
  placeDetailIcon: { fontSize: 18, width: 28 },
  placeDetailText: { fontSize: 15, color: '#F0F4FF', flex: 1 },
  placeDetailLink: { color: '#38BDF8' },
  placeModalSectionLabel: { fontSize: 11, fontWeight: '700', color: '#4A5B73', letterSpacing: 1.5, marginTop: 24, marginBottom: 12 },
  mapsRow: { flexDirection: 'row', gap: 12 },
  mapsBtn: { flex: 1, backgroundColor: '#0D1421', borderRadius: 14, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: '#1E2D45' },
  mapsBtnText: { color: '#F0F4FF', fontSize: 14, fontWeight: '700' },

  // Bucket list
  saveBtn: { backgroundColor: '#38BDF8', borderRadius: 14, paddingVertical: 20, alignItems: 'center' },
  saveBtnActive: { backgroundColor: '#0D1421', borderWidth: 2, borderColor: '#22c55e' },
  saveBtnText: { fontSize: 16, fontWeight: '800', color: '#fff' },

  // Crew car reporting
  reportBtn: { backgroundColor: '#1E2D45', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  reportBtnText: { color: '#38BDF8', fontSize: 12, fontWeight: '700' },
  inlineModal: { backgroundColor: '#0D1421', borderRadius: 16, padding: 20, marginBottom: 16, borderWidth: 1, borderColor: '#1E2D45' },
  modalTitle: { fontSize: 16, fontWeight: '700', color: '#F0F4FF', marginBottom: 16, textAlign: 'center' },
  modalBtns: { gap: 10 },
  modalOption: { backgroundColor: '#111827', borderRadius: 10, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: '#1E2D45' },
  modalOptionText: { color: '#F0F4FF', fontWeight: '600', fontSize: 14 },
  modalCancel: { padding: 14, alignItems: 'center' },
  modalCancelText: { color: '#4A5B73', fontSize: 14 },
});
