import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Dimensions, PanResponder, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import WebView from 'react-native-webview';
import airportsData from '../../assets/images/airports.json';
import { getWhyFlyHere } from '../../utils/whyFlyHere';

const SCREEN_HEIGHT = Dimensions.get('window').height;
const SNAP_EXPANDED = 0;
const SNAP_PEEK = Math.round(SCREEN_HEIGHT * 0.35);
const SNAP_CLOSED = Math.round(SCREEN_HEIGHT * 0.65);
import { GOOGLE_KEY } from '../../utils/config';

const FUEL_LABELS: Record<string, string> = { A: 'Jet A', 'A+': 'Jet A+', B: 'Jet B' };
function formatFuel(fuel: string): string {
  return fuel.split(',').map(f => FUEL_LABELS[f.trim()] ?? f.trim()).join(' / ');
}

// Pre-filter at module load: keep any airport with valid coords and at least one identifier.
// FAA/local identifiers (e.g. "3S8", "MO8") are sufficient — ICAO not required.
const airports: any[] = (airportsData as any[]).filter(
  a => a.lat != null && a.lng != null && (a.icao || a.faa || a.id)
);

/** Best available identifier for display: ICAO → FAA → local id */
function airportIdent(a: any): string {
  return a.icao || a.faa || a.id || '?';
}

const FILTERS = [
  { id: 'fuel', label: '⛽ Fuel' },
  { id: 'tower', label: '🗼 Tower' },
  { id: 'restaurant', label: '🍽 Food' },
  { id: 'hotel', label: '🏨 Hotel' },
  { id: 'golf', label: '⛳ Golf' },
  { id: 'attraction', label: '🎯 Fun' },
  { id: 'courtesy_car', label: '🚗 Car' },
];

const RADIUS_OPTIONS = [0, 50, 100, 150, 200, 250, 300, 400, 500];
const NM_TO_METERS = 1852;
const MAX_MARKERS = 200;
// Leaflet zoom threshold: >= ZOOM_IN_THRESHOLD means "zoomed in" (city/local level)
const ZOOM_IN_THRESHOLD = 9;

function getDistanceNm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 3440.065;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getDistanceMiles(lat1: number, lng1: number, lat2: number, lng2: number) {
  return getDistanceNm(lat1, lng1, lat2, lng2) * 1.15078;
}

// ─── Flight time model ───────────────────────────────────────────────────────
// Separates climb/descent from cruise rather than using a single average speed.
// windComponent (kts) can be added later: positive = tailwind, negative = headwind.
const CRUISE_KTS = 150;
// During climb + descent a typical GA single averages ~90 kts over ~30 nm.
// Deriving the overhead time from these two constants ensures the short-trip
// and standard-trip formulas are continuous at the boundary (no jump at 30 nm).
const CLIMB_DESCENT_NM = 30;
const CLIMB_DESCENT_AVG_KTS = 90; // avg ground speed during climb + descent

function estimateFlightTime(distNm: number, windComponent = 0): string {
  const cruiseKts = CRUISE_KTS + windComponent;

  let totalMin: number;
  if (distNm <= CLIMB_DESCENT_NM) {
    // Short trip: never reaches cruise altitude — entire flight at climb/descent avg speed
    totalMin = (distNm / CLIMB_DESCENT_AVG_KTS) * 60;
  } else {
    // Standard trip: fixed climb/descent segment + cruise segment
    const climbDescentMin = (CLIMB_DESCENT_NM / CLIMB_DESCENT_AVG_KTS) * 60; // 20 min
    const cruiseMin = ((distNm - CLIMB_DESCENT_NM) / cruiseKts) * 60;
    totalMin = climbDescentMin + cruiseMin;
  }

  const t = Math.round(totalMin);
  if (t < 60) return `${t} min`;
  const h = Math.floor(t / 60);
  const m = t % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
// ─────────────────────────────────────────────────────────────────────────────

function maxRunwayLength(airport: any): number {
  if (!airport.runways || airport.runways.length === 0) return 0;
  return Math.max(...airport.runways.map((r: any) => r.length || 0));
}

/**
 * Score an airport for display priority.
 *
 * Zoomed OUT (regional view): surface usefulness matters most.
 *   Fuel (+30), tower (+20), long runway (+15/+8), gentle distance penalty.
 *
 * Zoomed IN (local view): nearest to center wins, with small bonuses for
 *   fuel and tower to break ties between equidistant airports.
 */
function scoreAirport(airport: any, centerLat: number, centerLng: number, zoomedIn: boolean): number {
  const dist = getDistanceNm(centerLat, centerLng, airport.lat, airport.lng);

  if (zoomedIn) {
    // Closest first; fuel/tower as tiebreaker
    let score = -dist * 10;
    if (airport.fuel) score += 5;
    if (airport.has_tower === 'ATCT') score += 3;
    return score;
  }

  // Zoomed out: surface quality + gentle distance weight
  let score = 0;
  if (airport.fuel) score += 30;
  if (airport.has_tower === 'ATCT') score += 20;
  const rl = maxRunwayLength(airport);
  if (rl >= 5000) score += 15;
  else if (rl >= 3000) score += 8;
  score -= dist * 0.1; // slight penalty for being far from center
  return score;
}

// Leaflet map HTML — dark CartoDB tiles, orange circle markers, postMessage bridge
function buildMapHtml(lat: number, lng: number): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:#070B14; }
  #map { width:100vw; height:100vh; }
  .leaflet-control-attribution { display:none; }
  .leaflet-control-zoom { border:none !important; }
  .leaflet-control-zoom a {
    background:#0D1421 !important; color:#F0F4FF !important;
    border:1px solid #1E2D45 !important; border-radius:8px !important;
    margin-bottom:4px !important; width:32px !important; height:32px !important;
    line-height:32px !important; font-size:18px !important;
  }
  .leaflet-control-zoom a:hover { background:#1E2D45 !important; }
</style>
</head>
<body>
<div id="map"></div>
<script>
var map = L.map('map', { zoomControl: true }).setView([${lat}, ${lng}], 7);

L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
  maxZoom: 20, subdomains: 'abcd'
}).addTo(map);

var markersLayer = L.layerGroup().addTo(map);
var radiusCircle = null;
var userMarker = null;

function sendMsg(obj) {
  window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(obj));
}

// Tier a marker by usefulness:
//   tower + fuel  → blue   (#38BDF8) r7  — full-service, stand out most
//   tower only    → purple (#A78BFA) r6  — controlled airspace
//   fuel only     → orange (#F97316) r6  — practical fuel stop
//   basic field   → slate  (#64748B) r5  — least prominent
function markerStyle(a) {
  var hasTower = a.has_tower === 'ATCT';
  var hasFuel  = !!a.fuel;
return { fillColor: '#38BDF8', radius: 9 };
return { fillColor: '#A78BFA', radius: 8 };
return { fillColor: '#F97316', radius: 8 };
return { fillColor: '#64748B', radius: 7 };
}

s
function handleAirportTap(e) {
  L.DomEvent.stopPropagation(e);
  L.DomEvent.preventDefault(e);
  sendMsg({ type: 'tap', airport: a });
}

m.on('click', handleAirportTap);
m.on('touchstart', handleAirportTap);
m.on('mousedown', handleAirportTap);
    markersLayer.addLayer(m);
  });
}

function updateRadius(lat, lng, radiusMeters) {
  if (radiusCircle) { map.removeLayer(radiusCircle); radiusCircle = null; }
  if (radiusMeters > 0) {
    radiusCircle = L.circle([lat, lng], {
      radius: radiusMeters,
      fillColor: '#38BDF8', fillOpacity: 0.06,
      color: '#38BDF8', weight: 2, opacity: 0.6,
    }).addTo(map);
  }
}

function updateUserLocation(lat, lng) {
  if (userMarker) { map.removeLayer(userMarker); }
  userMarker = L.circleMarker([lat, lng], {
    radius: 7, fillColor: '#38BDF8', fillOpacity: 1,
    color: '#ffffff', weight: 2,
  }).addTo(map);
}

function centerOn(lat, lng, zoom) {
  map.setView([lat, lng], zoom || map.getZoom());
}

// Debounced viewport reporting to React Native
var moveTimer;

map.on('moveend zoomend', function() {
  clearTimeout(moveTimer);

  moveTimer = setTimeout(function() {
    var c = map.getCenter();
    var b = map.getBounds();

    sendMsg({
      type: 'viewChanged',
      zoom: map.getZoom(),
      centerLat: c.lat,
      centerLng: c.lng,
      swLat: b.getSouth(),
      swLng: b.getWest(),
      neLat: b.getNorth(),
      neLng: b.getEast(),
    });
  }, 0);
});

// send initial viewport immediately on map load
setTimeout(function() {
  var c = map.getCenter();
  var b = map.getBounds();
  sendMsg({
    type: 'viewChanged',
    zoom: map.getZoom(),
    centerLat: c.lat, centerLng: c.lng,
    swLat: b.getSouth(), swLng: b.getWest(),
    neLat: b.getNorth(), neLng: b.getEast(),
  });
}, 300);

map.on('click', function(e) {
  sendMsg({ type: 'mapTap' });
});

// Listen for messages from React Native
document.addEventListener('message', handleRNMessage);
window.addEventListener('message', handleRNMessage);
function handleRNMessage(e) {
  try {
    var msg = JSON.parse(e.data);
    if (msg.type === 'airports')       updateMarkers(msg.data);
    if (msg.type === 'radius')         updateRadius(msg.lat, msg.lng, msg.meters);
    if (msg.type === 'userLocation')   updateUserLocation(msg.lat, msg.lng);
    if (msg.type === 'centerOn')       centerOn(msg.lat, msg.lng, msg.zoom);
  } catch(err) {}
}

sendMsg({ type: 'ready' });
</script>
</body>
</html>`;
}

export default function MapScreen() {
  const [location, setLocation] = useState<any>(null);
  const [activeFilters, setActiveFilters] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [radiusNm, setRadiusNm] = useState(0);
  const [showRadiusPanel, setShowRadiusPanel] = useState(false);
  const [selectedAirport, setSelectedAirport] = useState<any>(null);
  const [mapReady, setMapReady] = useState(false);
  // Zoom, center, and viewport bounds reported by the WebView after each pan/zoom
  const [mapView, setMapView] = useState({
    zoom: 7,
    centerLat: location?.latitude || 38.7, centerLng: location?.longitude || -90.6,
    swLat: 0, swLng: 0, neLat: 0, neLng: 0,
  });

  const sheetAnim = useRef(new Animated.Value(SNAP_CLOSED)).current;
  const [sheetAirport, setSheetAirport] = useState<any>(null);
  const [sheetPlaces, setSheetPlaces] = useState<any>(null);
  const currentSnapRef = useRef(SNAP_CLOSED);

  const sheetPan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, gs) =>
      Math.abs(gs.dy) > 3 && Math.abs(gs.dy) > Math.abs(gs.dx),
    onPanResponderGrant: () => {
      sheetAnim.setOffset(currentSnapRef.current);
      sheetAnim.setValue(0);
    },
    onPanResponderMove: Animated.event([null, { dy: sheetAnim }], { useNativeDriver: false }),
    onPanResponderRelease: (_, gs) => {
      sheetAnim.flattenOffset();
      const projected = currentSnapRef.current + gs.dy;
      const snaps = [SNAP_EXPANDED, SNAP_PEEK, SNAP_CLOSED];
      let target: number;
      if (gs.vy > 0.5) {
        target = snaps.find(s => s > projected) ?? SNAP_CLOSED;
      } else if (gs.vy < -0.5) {
        target = [...snaps].reverse().find(s => s < projected) ?? SNAP_EXPANDED;
      } else {
        target = snaps.reduce((a, b) =>
          Math.abs(b - projected) < Math.abs(a - projected) ? b : a
        );
      }
      currentSnapRef.current = target;
      Animated.spring(sheetAnim, {
        toValue: target,
        useNativeDriver: false,
        bounciness: 2,
        speed: 18,
      }).start(() => {
        if (target === SNAP_CLOSED) setSelectedAirport(null);
      });
    },
  })).current;

  const webViewRef = useRef<any>(null);
  const router = useRouter();

  const filtered = useMemo(() => {
    let result = airports;
    if (activeFilters.includes('fuel')) result = result.filter(a => a.fuel);
    if (activeFilters.includes('tower')) result = result.filter(a => a.has_tower === 'ATCT');
    if (radiusNm > 0 && location) {
      result = result.filter(a => getDistanceNm(location.latitude, location.longitude, a.lat, a.lng) <= radiusNm);
    }
    return result;
  }, [activeFilters, radiusNm, location]);

  // Top MAX_MARKERS airports with two-phase selection.
  const selectedMarkers = useMemo(() => {
    const { zoom, centerLat, centerLng } = mapView;
    const zoomedIn = zoom >= ZOOM_IN_THRESHOLD;

    // Zoomed in: pure proximity to map center (user is navigating a local area)
    if (zoomedIn) {
      return filtered
        .map(a => ({ ...a, _score: scoreAirport(a, centerLat, centerLng, true) }))
        .sort((a: any, b: any) => b._score - a._score)
        .slice(0, MAX_MARKERS);
    }

    // Zoomed out: two-phase 50/50 selection
    const NEAR_SLOTS = 2; // keep a small home-airport bias
    const FILL_SLOTS = MAX_MARKERS - NEAR_SLOTS; // most markers come from visable screen area

    const userLat = location?.latitude ?? centerLat;
    const userLng = location?.longitude ?? centerLng;

    // Phase 1 — 10 airports closest to the user's GPS location
    const nearUser = filtered
      .map(a => ({ ...a, _userDist: getDistanceNm(userLat, userLng, a.lat, a.lng) }))
      .sort((a: any, b: any) => a._userDist - b._userDist)
      .slice(0, NEAR_SLOTS);

    const nearUserIds = new Set(nearUser.map((a: any) => a.icao || a.id));

    // Phase 2 — 10 highest-utility airports inside the visible viewport
    // If bounds aren't available yet, fall back to scoring by distance from center.
    const { swLat, swLng, neLat, neLng } = mapView;
    const hasBounds = neLat !== 0 || swLat !== 0;
    const inViewport = hasBounds
      ? filtered.filter(a => !nearUserIds.has(a.icao || a.id) && a.lat >= swLat && a.lat <= neLat && a.lng >= swLng && a.lng <= neLng)
      : filtered.filter(a => !nearUserIds.has(a.icao || a.id));

    const GRID_ROWS = 10;
const GRID_COLS = 15;

const cellHeight = (neLat - swLat) / GRID_ROWS;
const cellWidth = (neLng - swLng) / GRID_COLS;

const gridBest: any[] = [];

for (let row = 0; row < GRID_ROWS; row++) {
  for (let col = 0; col < GRID_COLS; col++) {
    const cellSouth = swLat + row * cellHeight;
    const cellNorth = cellSouth + cellHeight;
    const cellWest = swLng + col * cellWidth;
    const cellEast = cellWest + cellWidth;

    const cellAirports = inViewport.filter(
      a =>
        a.lat >= cellSouth &&
        a.lat < cellNorth &&
        a.lng >= cellWest &&
        a.lng < cellEast
    );

    if (cellAirports.length > 0) {
      const bestInCell = cellAirports
        .map(a => ({ ...a, _score: scoreAirport(a, centerLat, centerLng, false) }))
        .sort((a: any, b: any) => b._score - a._score)[0];

      gridBest.push(bestInCell);
    }
  }
}

const fillAirports = gridBest
  .sort((a: any, b: any) => b._score - a._score)
  .slice(0, FILL_SLOTS);

    return [...nearUser, ...fillAirports];
  }, [filtered, mapView, location]);

  // Send scored markers to WebView whenever they change
  useEffect(() => {
    if (!mapReady || !webViewRef.current) return;
    console.log('[Map] zoom:', mapView.zoom, '| filtered:', filtered.length, '| sending:', selectedMarkers.length);
    webViewRef.current.postMessage(JSON.stringify({ type: 'airports', data: selectedMarkers }));
  }, [selectedMarkers, mapReady]);

  // Send radius circle whenever it changes
  useEffect(() => {
    if (!mapReady || !webViewRef.current || !location) return;
    webViewRef.current.postMessage(JSON.stringify({
      type: 'radius',
      lat: location.latitude,
      lng: location.longitude,
      meters: radiusNm * NM_TO_METERS,
    }));
  }, [radiusNm, location, mapReady]);

  // Send user location dot whenever location is known
  useEffect(() => {
    if (!mapReady || !webViewRef.current || !location) return;
    webViewRef.current.postMessage(JSON.stringify({
      type: 'userLocation',
      lat: location.latitude,
      lng: location.longitude,
    }));
  }, [location, mapReady]);

  useEffect(() => {
    if (selectedAirport) {
      setSheetAirport(selectedAirport);
      setSheetPlaces(null);
      fetchSheetPlaces(selectedAirport);
      currentSnapRef.current = SNAP_EXPANDED;
      sheetAnim.stopAnimation();
      Animated.spring(sheetAnim, {
        toValue: SNAP_EXPANDED,
        useNativeDriver: false,
        bounciness: 3,
        speed: 16,
      }).start();
    } else {
      setSheetPlaces(null);
      currentSnapRef.current = SNAP_CLOSED;
      sheetAnim.stopAnimation();
      Animated.spring(sheetAnim, {
        toValue: SNAP_CLOSED,
        useNativeDriver: false,
        bounciness: 3,
        speed: 16,
      }).start();
    }
  }, [selectedAirport]);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({});
        setLocation(loc.coords);
      } else {
        setLocation({ latitude: 38.7, longitude: -90.6 });
      }
      setLoading(false);
    })();
  }, []);

  const handleMessage = useCallback((event: any) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type === 'ready') {
        setMapReady(true);
      } else if (msg.type === 'viewChanged') {
        setMapView({ zoom: msg.zoom, centerLat: msg.centerLat, centerLng: msg.centerLng, swLat: msg.swLat ?? 0, swLng: msg.swLng ?? 0, neLat: msg.neLat ?? 0, neLng: msg.neLng ?? 0 });
      } else if (msg.type === 'tap') {
        setSelectedAirport(msg.airport);
      } else if (msg.type === 'mapTap') {
        setSelectedAirport(null);
      }
    } catch {}
  }, []);

  function goToAirport(airport: any) {
    router.push({
      pathname: '/airport',
      params: {
        icao: airportIdent(airport),
        name: airport.name,
        city: airport.city,
        state: airport.state,
        lat: airport.lat,
        lng: airport.lng,
        elevation: airport.elevation,
        fuel: airport.fuel,
        runways: airport.runways ? JSON.stringify(airport.runways) : null,
      }
    });
  }

  function selectRadius(nm: number) {
    setRadiusNm(nm);
    setSelectedAirport(null);
    if (nm > 0 && location && webViewRef.current) {
      const zoom = nm <= 50 ? 10 : nm <= 150 ? 8 : nm <= 300 ? 7 : 6;
      webViewRef.current.postMessage(JSON.stringify({
        type: 'centerOn', lat: location.latitude, lng: location.longitude, zoom,
      }));
    }
  }

  function centerOnUser() {
    setSelectedAirport(null);
    if (location && webViewRef.current) {
      webViewRef.current.postMessage(JSON.stringify({
        type: 'centerOn', lat: location.latitude, lng: location.longitude, zoom: 9,
      }));
    }
  }

  async function fetchSheetPlaces(apt: any) {
    const aptLat = apt.lat;
    const aptLng = apt.lng;
    if (!aptLat || !aptLng) return;
    try {
      const radius = 8000;
      const base = `https://maps.googleapis.com/maps/api/place/nearbysearch/json`;
      const [restRes, hotelRes, golfRes, thingsRes] = await Promise.all([
        fetch(`${base}?location=${aptLat},${aptLng}&radius=${radius}&type=restaurant&key=${GOOGLE_KEY}`),
        fetch(`${base}?location=${aptLat},${aptLng}&radius=${radius}&type=lodging&key=${GOOGLE_KEY}`),
        fetch(`${base}?location=${aptLat},${aptLng}&radius=${radius}&keyword=golf+course&key=${GOOGLE_KEY}`),
        fetch(`${base}?location=${aptLat},${aptLng}&radius=${radius}&type=tourist_attraction&key=${GOOGLE_KEY}`),
      ]);
      const [restData, hotelData, golfData, thingsData] = await Promise.all([
        restRes.json(), hotelRes.json(), golfRes.json(), thingsRes.json(),
      ]);
      function parseResults(data: any) {
        return (data.results || [])
          .sort((a: any, b: any) =>
            (a.geometry?.location?.lat ? getDistanceMiles(aptLat, aptLng, a.geometry.location.lat, a.geometry.location.lng) : 999) -
            (b.geometry?.location?.lat ? getDistanceMiles(aptLat, aptLng, b.geometry.location.lat, b.geometry.location.lng) : 999)
          )
          .slice(0, 6)
          .map((p: any) => ({
            name: p.name,
            type: p.types?.[0]?.replace(/_/g, ' ') || '',
            rating: p.rating ? `${p.rating} ⭐ (${p.user_ratings_total})` : 'No rating',
            distanceMiles: p.geometry?.location?.lat
              ? Math.round(getDistanceMiles(aptLat, aptLng, p.geometry.location.lat, p.geometry.location.lng) * 10) / 10
              : null,
          }));
      }
      setSheetPlaces({
        restaurants: parseResults(restData),
        hotels: parseResults(hotelData),
        golf: parseResults(golfData),
        things: parseResults(thingsData),
      });
    } catch { /* leave sheetPlaces null — falls back to static */ }
  }

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color="#38BDF8" size="large" />
        <Text style={styles.loadingText}>Getting your location...</Text>
      </View>
    );
  }

  const mapHtml = buildMapHtml(
    location?.latitude || 38.7,
    location?.longitude || -90.6
  );

  return (
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        style={styles.map}
        source={{ html: mapHtml }}
        onMessage={handleMessage}
        javaScriptEnabled
        domStorageEnabled
        originWhitelist={['*']}
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
      />

      {selectedAirport && (
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={() => setSelectedAirport(null)}
        />
      )}

      <Animated.View
        style={[styles.sheet, { transform: [{ translateY: sheetAnim }] }]}
        pointerEvents={selectedAirport ? 'auto' : 'none'}
      >
        {sheetAirport && (() => {
          const distNm = location
            ? Math.round(getDistanceNm(location.latitude, location.longitude, sheetAirport.lat, sheetAirport.lng))
            : null;
          return (
            <>
              <View style={styles.sheetHandleArea} {...sheetPan.panHandlers}>
                <View style={styles.sheetHandle} />
              </View>
              <ScrollView
                showsVerticalScrollIndicator={false}
                bounces={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ paddingBottom: 32 }}
              >
                <View style={styles.sheetHeader}>
                  <Text style={styles.sheetIdent}>{airportIdent(sheetAirport)}</Text>
                  <TouchableOpacity
                    onPress={() => setSelectedAirport(null)}
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  >
                    <Text style={styles.sheetClose}>✕</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.sheetName}>{sheetAirport.name}</Text>
                <Text style={styles.sheetLocation}>{sheetAirport.city}, {sheetAirport.state}</Text>

                {distNm !== null && (
                  <View style={styles.sheetStats}>
                    <View style={styles.sheetStat}>
                      <Text style={styles.sheetStatValue}>{distNm} nm</Text>
                      <Text style={styles.sheetStatLabel}>Distance</Text>
                    </View>
                    <View style={styles.sheetStatDivider} />
                    <View style={styles.sheetStat}>
                      <Text style={styles.sheetStatValue}>{estimateFlightTime(distNm)}</Text>
                      <Text style={styles.sheetStatLabel}>Est. Flight</Text>
                    </View>
                  </View>
                )}

                <View style={styles.sheetDetails}>
                  {sheetAirport.fuel ? (
                    <View style={styles.sheetDetailRow}>
                      <Text style={styles.sheetDetailIcon}>⛽</Text>
                      <Text style={styles.sheetDetailLabel}>Fuel</Text>
                      <Text style={styles.sheetDetailValue}>{formatFuel(sheetAirport.fuel)}</Text>
                    </View>
                  ) : (
                    <View style={styles.sheetDetailRow}>
                      <Text style={styles.sheetDetailIcon}>⛽</Text>
                      <Text style={styles.sheetDetailLabel}>Fuel</Text>
                      <Text style={[styles.sheetDetailValue, { color: '#4A5B73' }]}>None on record</Text>
                    </View>
                  )}
                  {sheetAirport.elevation != null && (
                    <View style={styles.sheetDetailRow}>
                      <Text style={styles.sheetDetailIcon}>📏</Text>
                      <Text style={styles.sheetDetailLabel}>Elevation</Text>
                      <Text style={styles.sheetDetailValue}>{Number(sheetAirport.elevation).toLocaleString()} ft</Text>
                    </View>
                  )}
                  {maxRunwayLength(sheetAirport) > 0 && (
                    <View style={styles.sheetDetailRow}>
                      <Text style={styles.sheetDetailIcon}>🛬</Text>
                      <Text style={styles.sheetDetailLabel}>Longest Runway</Text>
                      <Text style={styles.sheetDetailValue}>{maxRunwayLength(sheetAirport).toLocaleString()} ft</Text>
                    </View>
                  )}
                </View>

                <View style={styles.whySection}>
                  <Text style={styles.whySectionTitle}>Why fly here</Text>
                  {getWhyFlyHere(sheetAirport, sheetPlaces ?? undefined).map((bullet, i) => (
                    <View key={i} style={styles.whyBullet}>
                      <Text style={styles.whyBulletDot}>·</Text>
                      <Text style={styles.whyBulletText}>{bullet}</Text>
                    </View>
                  ))}
                </View>

              </ScrollView>

              <TouchableOpacity style={styles.sheetBtn} onPress={() => goToAirport(sheetAirport)}>
                <Text style={styles.sheetBtnText}>View Airport</Text>
              </TouchableOpacity>
            </>
          );
        })()}
      </Animated.View>

      <View style={styles.topButtons}>
        <TouchableOpacity style={styles.iconBtn} onPress={centerOnUser}>
          <Text style={styles.iconBtnText}>📍</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.iconBtn, showRadiusPanel && styles.iconBtnActive]}
          onPress={() => setShowRadiusPanel(v => !v)}
        >
          <Text style={[styles.iconBtnText, showRadiusPanel && styles.iconBtnTextActive]}>
            {radiusNm > 0 ? `${radiusNm}nm` : '🔵'}
          </Text>
        </TouchableOpacity>
      </View>

      {showRadiusPanel && (
        <View style={styles.radiusPanel}>
          <View style={styles.radiusHeader}>
            <Text style={styles.radiusLabel}>RADIUS FILTER</Text>
            {radiusNm > 0 && <Text style={styles.radiusCount}>{filtered.length} airports in range</Text>}
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.radiusScroll}>
            {RADIUS_OPTIONS.map(nm => (
              <TouchableOpacity
                key={nm}
                style={[styles.radiusChip, radiusNm === nm && styles.radiusChipActive]}
                onPress={() => selectRadius(nm)}
              >
                <Text style={[styles.radiusChipText, radiusNm === nm && styles.radiusChipTextActive]}>
                  {nm === 0 ? 'Off' : `${nm} nm`}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      <View style={styles.filterContainer}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
          {FILTERS.map(f => (
            <TouchableOpacity
              key={f.id}
              style={[styles.filterChip, activeFilters.includes(f.id) && styles.filterChipActive]}
              onPress={() => {
                setActiveFilters(prev => prev.includes(f.id) ? prev.filter(x => x !== f.id) : [...prev, f.id]);
                setSelectedAirport(null);
              }}
            >
              <Text style={[styles.filterText, activeFilters.includes(f.id) && styles.filterTextActive]}>
                {f.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#070B14' },
  map: { flex: 1, backgroundColor: '#070B14' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, backgroundColor: '#070B14' },
  loadingText: { color: '#4A5B73', fontSize: 14 },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  sheet: { position: 'absolute', bottom: 0, left: 0, right: 0, maxHeight: SCREEN_HEIGHT * 0.60, backgroundColor: '#0D1421', borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderColor: '#1E2D45', paddingHorizontal: 20, paddingBottom: 90 },
  sheetHandleArea: { alignItems: 'center', paddingTop: 12, paddingBottom: 12, marginHorizontal: -20 },
  sheetHandle: { width: 40, height: 4, backgroundColor: '#1E2D45', borderRadius: 2 },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  sheetIdent: { fontSize: 13, fontWeight: '700', color: '#38BDF8', letterSpacing: 1 },
  sheetClose: { fontSize: 18, color: '#4A5B73' },
  sheetName: { fontSize: 20, fontWeight: '700', color: '#F0F4FF', marginBottom: 2 },
  sheetLocation: { fontSize: 13, color: '#4A5B73', marginBottom: 16 },
  sheetStats: { flexDirection: 'row', backgroundColor: '#111827', borderRadius: 14, padding: 16, marginBottom: 16, alignItems: 'center' },
  sheetStat: { flex: 1, alignItems: 'center' },
  sheetStatValue: { fontSize: 22, fontWeight: '700', color: '#F0F4FF', marginBottom: 2 },
  sheetStatLabel: { fontSize: 11, color: '#4A5B73', textTransform: 'uppercase', letterSpacing: 0.8 },
  sheetStatDivider: { width: 1, height: 36, backgroundColor: '#1E2D45' },
  sheetDetails: { gap: 12, marginBottom: 24 },
  sheetDetailRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sheetDetailIcon: { fontSize: 16, width: 24 },
  sheetDetailLabel: { fontSize: 13, color: '#4A5B73', flex: 1 },
  sheetDetailValue: { fontSize: 13, fontWeight: '600', color: '#8A9BB5' },
  whySection: { marginTop: 4, marginBottom: 8 },
  whySectionTitle: { fontSize: 11, fontWeight: '700', color: '#4A5B73', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 10 },
  whyBullet: { flexDirection: 'row', gap: 8, marginBottom: 6 },
  whyBulletDot: { fontSize: 16, color: '#38BDF8', lineHeight: 20, marginTop: -1 },
  whyBulletText: { fontSize: 13, color: '#8A9BB5', flex: 1, lineHeight: 20 },
  sheetBtn: { backgroundColor: '#38BDF8', borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  sheetBtnText: { color: '#0D1421', fontSize: 16, fontWeight: '700' },
  topButtons: { position: 'absolute', top: 60, right: 16, gap: 10 },
  iconBtn: { backgroundColor: '#0D1421', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#1E2D45', minWidth: 48, alignItems: 'center' },
  iconBtnActive: { backgroundColor: '#38BDF8', borderColor: '#38BDF8' },
  iconBtnText: { fontSize: 20, color: '#F0F4FF' },
  iconBtnTextActive: { color: '#0D1421', fontSize: 13, fontWeight: '700' },
  radiusPanel: { position: 'absolute', top: 60, left: 16, right: 72, backgroundColor: '#0D1421', borderRadius: 16, padding: 14, borderWidth: 1, borderColor: '#1E2D45' },
  radiusHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  radiusLabel: { fontSize: 11, fontWeight: '700', color: '#4A5B73', letterSpacing: 1.2, textTransform: 'uppercase' },
  radiusCount: { fontSize: 12, fontWeight: '700', color: '#F97316' },
  radiusScroll: { gap: 8 },
  radiusChip: { backgroundColor: '#111827', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: '#1E2D45' },
  radiusChipActive: { backgroundColor: '#38BDF8', borderColor: '#38BDF8' },
  radiusChipText: { fontSize: 13, color: '#4A5B73', fontWeight: '600' },
  radiusChipTextActive: { color: '#0D1421', fontWeight: '700' },
  filterContainer: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#070B14', borderTopWidth: 1, borderTopColor: '#1E2D45', paddingBottom: 30, paddingTop: 12 },
  filterScroll: { paddingHorizontal: 16, gap: 8 },
  filterChip: { backgroundColor: '#0D1421', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: '#1E2D45' },
  filterChipActive: { backgroundColor: '#38BDF8', borderColor: '#38BDF8' },
  filterText: { fontSize: 13, color: '#4A5B73', fontWeight: '600' },
  filterTextActive: { color: '#0D1421' },
});
