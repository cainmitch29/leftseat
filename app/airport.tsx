import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import WeatherWidget from '../components/WeatherWidget';
import { supabase } from '../lib/supabase';

const GOOGLE_KEY = 'AIzaSyAP7EitXnoZAhammN6w1RhvFJ2DoZnfd1k';

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
  const router = useRouter();

  const { icao, name, city, state, lat, lng, elevation, fuel, runways: runwaysParam } = useLocalSearchParams();

  const airport = {
    icao: icao || 'KSBA',
    name: name || 'Santa Barbara Municipal',
    city: city && state ? `${city}, ${state}` : 'Santa Barbara, CA',
    elevation: elevation ? `${elevation} ft MSL` : '—',
    fuel: fuel || '—',
  };

  const airportLat = lat ? parseFloat(lat as string) : null;
  const airportLng = lng ? parseFloat(lng as string) : null;

  useEffect(() => {
    fetchWeather();
    fetchRunways();
    fetchAirportPhoto();
    fetchAirportPhoto();
    fetchCrewCar();
    if (airportLat && airportLng) {
      fetchPlaces(airportLat, airportLng);
    } else {
      fetchAirportCoords();
    }
  }, [icao]);

  useEffect(() => {
    async function checkBucketList() {
      const { data } = await supabase
        .from('bucket_list')
        .select('id')
        .eq('user_id', 'mitchell')
        .eq('icao', icao)
        .single();
      if (data) setInBucketList(true);
    }
    checkBucketList();
  }, [icao]);

  async function toggleBucketList() {
    const userId = 'mitchell';
    if (inBucketList) {
      await supabase.from('bucket_list').delete().eq('user_id', userId).eq('icao', icao);
      setInBucketList(false);
    } else {
      await supabase.from('bucket_list').insert({
        user_id: userId,
        icao: icao,
        name: name,
        city: city,
        state: state,
        lat: airportLat,
        lng: airportLng,
        elevation: elevation ? parseInt(elevation as string) : null,
        fuel: fuel,
      });
      setInBucketList(true);
    }
  }

  async function fetchAirportPhoto() {
    try {
      const query = encodeURIComponent(`${name} airport`);
      const res = await fetch(
        `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${query}&inputtype=textquery&fields=photos&key=${GOOGLE_KEY}`
      );
      const data = await res.json();
      const ref = data.candidates?.[0]?.photos?.[0]?.photo_reference;
      if (ref) {
        setHeroPhoto(`https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photoreference=${ref}&key=${GOOGLE_KEY}`);
      }
    } catch (e) {
      console.log('Photo error:', e);
    }
  }
async function fetchCrewCar() {
    try {
      const { data } = await supabase
        .from('crew_cars')
        .select('*')
        .eq('icao', icao)
        .order('reported_at', { ascending: false })
        .limit(1)
        .single();
      if (data) setCrewCar(data);
    } catch (e) {
      setCrewCar(null);
    }
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
        console.log('Raw METAR data:', JSON.stringify(data[0]).slice(0, 500));
      } else {
        setWeatherError(true);
      }
    } catch (e) {
      setWeatherError(true);
    } finally {
      setWeatherLoading(false);
    }
  }

  async function fetchRunways() {
    try {
      if (runwaysParam) {
        const parsed = JSON.parse(runwaysParam as string);
        if (parsed && parsed.length > 0) {
          setRunways(parsed);
          return;
        }
      }
      setRunways([{ id: 'No runway data available', length: null, surface: '' }]);
    } catch (e) {
      setRunways([{ id: 'No runway data available', length: null, surface: '' }]);<Text style={styles.sectionTitle}>Crew Car</Text>

            {crewCarModal && (
              <View style={styles.modal}>
                <Text style={styles.modalTitle}>Report Crew Car</Text>
                <View style={styles.modalBtns}>
                  {['free', 'paid', 'donation'].map(cost => (
                    <TouchableOpacity
                      key={cost}
                      style={styles.modalOption}
                      onPress={async () => {
                        await supabase.from('crew_cars').insert({
                          icao, user_id: 'mitchell', available: true, cost,
                        });
                        fetchCrewCar();
                        setCrewCarModal(false);
                      }}
                    >
                      <Text style={styles.modalOptionText}>✅ {cost.charAt(0).toUpperCase() + cost.slice(1)}</Text>
                    </TouchableOpacity>
                  ))}
                  <TouchableOpacity
                    style={[styles.modalOption, { borderColor: '#ef4444' }]}
                    onPress={async () => {
                      await supabase.from('crew_cars').insert({
                        icao, user_id: 'mitchell', available: false,
                      });
                      fetchCrewCar();
                      setCrewCarModal(false);
                    }}
                  >
                    <Text style={[styles.modalOptionText, { color: '#ef4444' }]}>❌ Not Available</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.modalCancel}
                    onPress={() => setCrewCarModal(false)}
                  >
                    <Text style={styles.modalCancelText}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
    }
  }

  async function fetchAirportCoords() {
    try {
      const id = (icao || 'KSBA').toString().toUpperCase();
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${id}+airport&format=json&limit=1`,
        { headers: { 'User-Agent': 'LeftSeatApp/1.0' } }
      );
      const data = await res.json();
      if (data && data.length > 0) {
        fetchPlaces(parseFloat(data[0].lat), parseFloat(data[0].lon));
      } else {
        setPlacesLoading(false);
      }
    } catch (e) {
      setPlacesLoading(false);
    }
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
        restRes.json(), hotelRes.json(), golfRes.json(), thingsRes.json()
      ]);

      function parseResults(data: any) {
        return (data.results || []).slice(0, 6).map((p: any) => ({
          name: p.name,
          type: p.types?.[0]?.replace(/_/g, ' ') || '',
          rating: p.rating ? `${p.rating} ⭐ (${p.user_ratings_total})` : 'No rating',
          distance: p.vicinity || '',
          open: p.opening_hours?.open_now,
          lat: p.geometry?.location?.lat,
          lng: p.geometry?.location?.lng,
          photo: p.photos?.[0]?.photo_reference || null,
        }));
      }

      setPlaces({
        restaurants: parseResults(restData),
        hotels: parseResults(hotelData),
        golf: parseResults(golfData),
        things: parseResults(thingsData),
      });
    } catch (e) {
      console.log('Places error:', e);
    } finally {
      setPlacesLoading(false);
    }
  }

  function parseMetar(raw: any) {
    const windDir = raw.wdir ?? '—';
    const windSpd = raw.wspd ?? '—';
    const windGust = raw.wgst ? ` G${raw.wgst}` : '';
    const vis = raw.visib ?? '—';
    const temp = raw.temp != null ? `${raw.temp}°C / ${Math.round(raw.temp * 9 / 5 + 32)}°F` : '—';
    const dewpoint = raw.dewp != null ? `${raw.dewp}°C` : '—';
    const altimeter = raw.altim != null ? `${raw.altim.toFixed(2)} inHg` : '—';
const clouds = raw.clouds && raw.clouds.length > 0
  ? raw.clouds.map((c: any) => `${c.cover} ${c.base ? (c.base).toLocaleString() + ' ft' : ''}`).join(', ')
  : 'Clear';
// Calculate flight category from visibility and clouds
let flightCat = 'VFR';
const visNum = parseFloat(raw.visib) || 10;
const cloudBase = raw.clouds && raw.clouds.length > 0 ? (raw.clouds[0].base || 999) * 100 : 99900;
if (visNum < 1 || cloudBase < 500) flightCat = 'LIFR';
else if (visNum < 3 || cloudBase < 1000) flightCat = 'IFR';
else if (visNum <= 5 || cloudBase <= 3000) flightCat = 'MVFR';
else flightCat = 'VFR';
    const metar = raw.rawOb || '—';
    const catColor = flightCat === 'VFR' ? '#22c55e' : flightCat === 'MVFR' ? '#3b82f6' : flightCat === 'IFR' ? '#ef4444' : '#a855f7';
    return { windDir, windSpd, windGust, vis, temp, dewpoint, altimeter, clouds, flightCat, catColor, metar };
  }

  function flightConditionLabel(cat: string) {
    if (cat === 'VFR') return '✅ VFR — Good to go';
    if (cat === 'MVFR') return '🔵 MVFR — Marginal';
    if (cat === 'IFR') return '🔴 IFR — Instrument conditions';
    if (cat === 'LIFR') return '🟣 LIFR — Low IFR';
    return cat;
  }

  const tabs = ['info', 'eat', 'stay', 'golf', 'do'];
  const tabLabels: Record<string, string> = { info: 'Info', eat: '🍽 Eat', stay: '🏨 Stay', golf: '⛳ Golf', do: '🎯 Do' };

  return (
    <View style={styles.container}>
      {/* Hero */}
      <View style={styles.hero}>
        {heroPhoto && (
          <Image source={{ uri: heroPhoto }} style={styles.heroImage} resizeMode="cover" />
        )}
        <View style={styles.heroOverlay}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.icao}>{airport.icao}</Text>
          <Text style={styles.airportName}>{airport.name}</Text>
          <Text style={styles.city}>{airport.city}</Text>
          <View style={styles.heroMeta}>
            <View style={styles.metaPill}><Text style={styles.metaText}>⛽ {airport.fuel}</Text></View>
            <View style={styles.metaPill}><Text style={styles.metaText}>📏 {airport.elevation}</Text></View>
          </View>
        </View>
      </View>

      {/* Tabs */}
      <View style={styles.tabBar}>
        {tabs.map(tab => (
          <TouchableOpacity key={tab} style={[styles.tab, activeTab === tab && styles.tabActive]} onPress={() => setActiveTab(tab)}>
            <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>{tabLabels[tab]}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Content */}
      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>

        {activeTab === 'info' && (
          <View>
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
  <View style={[styles.flightCatBanner, { borderColor: weather.catColor, marginTop: 4 }]}>
    <Text style={[styles.flightCatText, { color: weather.catColor }]}>
      {flightConditionLabel(weather.flightCat)}
    </Text>
  </View>
  <View style={styles.weatherRow}>
    <Text style={styles.weatherLabel}>Wind</Text>
    <Text style={styles.weatherValue}>{weather.windDir}° at {weather.windSpd}{weather.windGust} kts</Text>
  </View>
  <View style={styles.weatherRow}>
    <Text style={styles.weatherLabel}>Visibility</Text>
    <Text style={styles.weatherValue}>{weather.vis} SM</Text>
  </View>
  <View style={styles.weatherRow}>
    <Text style={styles.weatherLabel}>Clouds</Text>
    <Text style={styles.weatherValue}>{weather.clouds}</Text>
  </View>
  <View style={styles.weatherRow}>
    <Text style={styles.weatherLabel}>Temperature</Text>
    <Text style={styles.weatherValue}>{weather.temp}</Text>
  </View>
  <View style={styles.weatherRow}>
    <Text style={styles.weatherLabel}>Dewpoint</Text>
    <Text style={styles.weatherValue}>{weather.dewpoint}</Text>
  </View>
  <View style={styles.weatherRow}>
    <Text style={styles.weatherLabel}>Altimeter</Text>
    <Text style={styles.weatherValue}>{weather.altimeter}</Text>
  </View>
  <View style={[styles.metarBox, { marginBottom: 0, marginTop: 8 }]}>
    <Text style={styles.metarLabel}>RAW METAR</Text>
    <Text style={styles.metarText}>{weather.metar}</Text>
  </View>
</View>
            )}

            <Text style={styles.sectionTitle}>Runways</Text>
            {runways.length > 0 ? runways.map((rwy: any, i: number) => (
              <View key={i} style={styles.listItem}>
                <Text style={styles.listIcon}>🛬</Text>
                <View>
                  <Text style={styles.listText}>Runway {rwy.id}</Text>
                  <Text style={styles.listSub}>{rwy.length ? `${rwy.length} ft` : ''}{rwy.surface ? ` · ${rwy.surface}` : ''}</Text>
                </View>
              </View>
            )) : (
              <View style={styles.listItem}>
                <Text style={styles.listIcon}>🛬</Text>
                <Text style={styles.listText}>Runway data unavailable</Text>
              </View>
            )}

            <Text style={styles.sectionTitle}>Crew Car</Text>
            <View style={styles.listItem}>
              <Text style={styles.listIcon}>🚗</Text>
              <View style={{ flex: 1 }}>
                {crewCar ? (
                  <>
                    <Text style={styles.listText}>
                      {crewCar.available ? '✅ Available' : '❌ Not Available'}
                      {crewCar.cost ? ` · ${crewCar.cost}` : ''}
                    </Text>
                    {crewCar.notes ? <Text style={styles.listSub}>{crewCar.notes}</Text> : null}
                  </>
                ) : (
                  <Text style={styles.listText}>No reports yet</Text>
                )}
              </View>
              <TouchableOpacity
                style={styles.reportBtn}
                onPress={() => setCrewCarModal(true)}
              >
                <Text style={styles.reportBtnText}>Report</Text>
              </TouchableOpacity>
            </View>

            {crewCarModal && (
              <View style={styles.modal}>
                <Text style={styles.modalTitle}>Report Crew Car</Text>
                <View style={styles.modalBtns}>
                  {['free', 'paid', 'donation'].map(cost => (
                    <TouchableOpacity
                      key={cost}
                      style={styles.modalOption}
                      onPress={async () => {
                        await supabase.from('crew_cars').insert({
                          icao, user_id: 'mitchell', available: true, cost,
                        });
                        fetchCrewCar();
                        setCrewCarModal(false);
                      }}
                    >
                      <Text style={styles.modalOptionText}>✅ {cost.charAt(0).toUpperCase() + cost.slice(1)}</Text>
                    </TouchableOpacity>
                  ))}
                  <TouchableOpacity
                    style={[styles.modalOption, { borderColor: '#ef4444' }]}
                    onPress={async () => {
                      await supabase.from('crew_cars').insert({
                        icao, user_id: 'mitchell', available: false,
                      });
                      fetchCrewCar();
                      setCrewCarModal(false);
                    }}
                  >
                    <Text style={[styles.modalOptionText, { color: '#ef4444' }]}>❌ Not Available</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.modalCancel}
                    onPress={() => setCrewCarModal(false)}
                  >
                    <Text style={styles.modalCancelText}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        )}

        {activeTab === 'eat' && (
          placesLoading ? <LoadingPlaces /> :
          places.restaurants.length > 0 ? places.restaurants.map((r: any, i: number) => <PlaceCard key={i} place={r} />) :
          <EmptyPlaces label="restaurants" />
        )}
        {activeTab === 'stay' && (
          placesLoading ? <LoadingPlaces /> :
          places.hotels.length > 0 ? places.hotels.map((r: any, i: number) => <PlaceCard key={i} place={r} />) :
          <EmptyPlaces label="hotels" />
        )}
        {activeTab === 'golf' && (
          placesLoading ? <LoadingPlaces /> :
          places.golf.length > 0 ? places.golf.map((r: any, i: number) => <PlaceCard key={i} place={r} />) :
          <EmptyPlaces label="golf courses" />
        )}
        {activeTab === 'do' && (
          placesLoading ? <LoadingPlaces /> :
          places.things.length > 0 ? places.things.map((r: any, i: number) => <PlaceCard key={i} place={r} />) :
          <EmptyPlaces label="attractions" />
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      <TouchableOpacity
        style={[styles.saveBtn, inBucketList && styles.saveBtnActive]}
        onPress={toggleBucketList}
      >
        <Text style={styles.saveBtnText}>
          {inBucketList ? '✅ In Bucket List' : '＋ Add to Bucket List'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

function PlaceCard({ place }: { place: any }) {
  function openMaps() {
    Alert.alert(
      place.name,
      'Open in maps?',
      [
        {
          text: 'Apple Maps',
          onPress: () => Linking.openURL(`maps://?q=${encodeURIComponent(place.name)}&ll=${place.lat},${place.lng}`),
        },
        {
          text: 'Google Maps',
          onPress: () => Linking.openURL(`comgooglemaps://?q=${encodeURIComponent(place.name)}&center=${place.lat},${place.lng}`),
        },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  }

  return (
    <TouchableOpacity style={styles.placeCard} onPress={openMaps}>
      <View style={styles.placeInfo}>
        <Text style={styles.placeName}>{place.name}</Text>
        <Text style={styles.placeType}>{place.type}</Text>
      </View>
      <View style={styles.placeMeta}>
        <Text style={styles.placeRating}>{place.rating}</Text>
        <Text style={styles.placeDistance}>{place.distance}</Text>
      </View>
    </TouchableOpacity>
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#070B14' },
  hero: { height: 220, backgroundColor: '#0D1421', borderBottomWidth: 1, borderBottomColor: '#1E2D45' },
  heroImage: { position: 'absolute', width: '100%', height: '100%' },
  heroOverlay: { flex: 1, paddingTop: 60, paddingHorizontal: 20, paddingBottom: 20, backgroundColor: 'rgba(0,0,0,0.45)' },
  backBtn: { marginBottom: 12 },
  backText: { color: '#38BDF8', fontSize: 14, fontWeight: '600' },
  icao: { fontSize: 13, fontWeight: '700', color: '#38BDF8', letterSpacing: 2, marginBottom: 4 },
  airportName: { fontSize: 22, fontWeight: '800', color: '#F0F4FF', marginBottom: 4 },
  city: { fontSize: 14, color: '#8A9BB5', marginBottom: 12 },
  heroMeta: { flexDirection: 'row', gap: 10 },
  metaPill: { backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: '#1E2D45' },
  metaText: { fontSize: 12, color: '#F0F4FF' },
  tabBar: { flexDirection: 'row', backgroundColor: '#0D1421', borderBottomWidth: 1, borderBottomColor: '#1E2D45' },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabActive: { borderBottomWidth: 2, borderBottomColor: '#38BDF8' },
  tabText: { fontSize: 12, color: '#4A5B73', fontWeight: '600' },
  tabTextActive: { color: '#F0F4FF' },
  content: { flex: 1, padding: 20 },
  sectionTitle: { fontSize: 11, fontWeight: '700', color: '#4A5B73', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 12, marginTop: 8 },
  loadingBox: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#0D1421', borderRadius: 12, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#1E2D45' },
  loadingText: { color: '#4A5B73', fontSize: 13 },
  errorBox: { backgroundColor: '#0D1421', borderRadius: 12, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#1E2D4560', alignItems: 'center' },
  errorText: { color: '#8A9BB5', fontSize: 13, marginBottom: 10 },
  retryBtn: { backgroundColor: '#1E2D45', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 },
  retryText: { color: '#F0F4FF', fontSize: 12, fontWeight: '600' },
  flightCatBanner: { borderRadius: 10, borderWidth: 1.5, padding: 14, marginBottom: 14, alignItems: 'center' },
  flightCatText: { fontSize: 15, fontWeight: '700' },
  weatherCard: { backgroundColor: '#0D1421', borderRadius: 12, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: '#1E2D45' },
  weatherRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#1E2D45' },
  weatherLabel: { fontSize: 13, color: '#4A5B73' },
  weatherValue: { fontSize: 13, color: '#F0F4FF', fontWeight: '600', textAlign: 'right', flex: 1, marginLeft: 16 },
  metarBox: { backgroundColor: '#070B14', borderRadius: 8, padding: 12, marginBottom: 20 },
  metarLabel: { fontSize: 9, color: '#1E2D45', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 6 },
  metarText: { fontSize: 11, color: '#4A5B73', fontFamily: 'Courier' },
  listItem: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#0D1421', borderRadius: 10, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: '#1E2D45' },
  listIcon: { fontSize: 18 },
  listText: { fontSize: 14, color: '#F0F4FF' },
  listSub: { fontSize: 11, color: '#4A5B73', marginTop: 2 },
  placeCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#0D1421', borderRadius: 12, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: '#1E2D45' },
  placeInfo: { flex: 1 },
  placeName: { fontSize: 15, fontWeight: '700', color: '#F0F4FF', marginBottom: 3 },
  placeType: { fontSize: 12, color: '#4A5B73' },
  placeMeta: { alignItems: 'flex-end' },
  placeRating: { fontSize: 13, color: '#F0F4FF', marginBottom: 3 },
  placeDistance: { fontSize: 12, color: '#38BDF8' },
  saveBtn: { margin: 16, backgroundColor: '#38BDF8', borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  saveBtnActive: { backgroundColor: '#0D1421', borderWidth: 2, borderColor: '#22c55e' },
  saveBtnText: { fontSize: 16, fontWeight: '800', color: '#fff' },
  reportBtn: { backgroundColor: '#1E2D45', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  reportBtnText: { color: '#38BDF8', fontSize: 12, fontWeight: '700' },
  modal: { backgroundColor: '#0D1421', borderRadius: 16, padding: 20, marginBottom: 16, borderWidth: 1, borderColor: '#1E2D45' },
  modalTitle: { fontSize: 16, fontWeight: '700', color: '#F0F4FF', marginBottom: 16, textAlign: 'center' },
  modalBtns: { gap: 10 },
  modalOption: { backgroundColor: '#111827', borderRadius: 10, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: '#1E2D45' },
  modalOptionText: { color: '#F0F4FF', fontWeight: '600', fontSize: 14 },
  modalCancel: { padding: 14, alignItems: 'center' },
  modalCancelText: { color: '#4A5B73', fontSize: 14 },
});