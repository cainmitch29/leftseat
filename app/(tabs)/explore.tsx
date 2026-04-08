import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Dimensions, FlatList, Image, Keyboard, PanResponder, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import WebView from 'react-native-webview';
import { MaterialCommunityIcons, Feather } from '@expo/vector-icons';
import airportsData from '../../assets/images/airports.json';
import { GOOGLE_KEY } from '../../utils/config';
import { useAuth } from '../../contexts/AuthContext';
import { useFocusEffect } from '@react-navigation/native';
import { fetchAirportHeroPhoto, fetchGooglePlacesTab } from '../../utils/googlePlaces';
import { getCachedCategory, setCachedCategory } from '../../utils/placesCache';
import { supabase } from '../../lib/supabase';
import { GlassSearchBar } from '../../components/GlassSearchBar';

const SCREEN_HEIGHT = Dimensions.get('window').height;
const SNAP_EXPANDED = 0;
const SNAP_COMPACT = Math.round(SCREEN_HEIGHT * 0.25); // initial open: ~35% visible
const SNAP_CLOSED = Math.round(SCREEN_HEIGHT * 0.65);

const BROWSE_H = Math.round(SCREEN_HEIGHT * 0.72);
const BROWSE_FULL = 0;
const BROWSE_PEEK = BROWSE_H - 230;
const BROWSE_COLLAPSED = BROWSE_H - 62;

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
  { id: 'fuel', label: 'Fuel' },
  { id: 'tower', label: 'Tower' },
  { id: 'restaurant', label: 'Food' },
  { id: 'hotel', label: 'Hotel' },
  { id: 'golf', label: 'Golf' },
  { id: 'attraction', label: 'Fun' },
  { id: 'courtesy_car', label: 'Car' },
];

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
// cruiseKts comes from the user's saved profile (via useCruiseSpeed hook).
// windComponent (kts) can be added later: positive = tailwind, negative = headwind.
//
// During climb + descent a typical GA single averages ~90 kts over ~30 nm.
// Deriving the overhead time from these two constants ensures the short-trip
// and standard-trip formulas are continuous at the boundary (no jump at 30 nm).
const CLIMB_DESCENT_NM = 30;
const CLIMB_DESCENT_AVG_KTS = 90; // avg ground speed during climb + descent

function estimateFlightTime(distNm: number, cruiseKts: number, windComponent = 0): string {
  const adjustedKts = cruiseKts + windComponent;

  let totalMin: number;
  if (distNm <= CLIMB_DESCENT_NM) {
    // Short trip: never reaches cruise altitude — entire flight at climb/descent avg speed
    totalMin = (distNm / CLIMB_DESCENT_AVG_KTS) * 60;
  } else {
    // Standard trip: fixed climb/descent segment + cruise segment
    const climbDescentMin = (CLIMB_DESCENT_NM / CLIMB_DESCENT_AVG_KTS) * 60; // 20 min
    const cruiseMin = ((distNm - CLIMB_DESCENT_NM) / adjustedKts) * 60;
    totalMin = climbDescentMin + cruiseMin;
  }

  const t = Math.round(totalMin);
  if (__DEV__) console.log('[time calc]', distNm, 'nm |', cruiseKts, 'kts |', t, 'min');
  if (t < 60) return `${t} min`;
  const h = Math.floor(t / 60);
  const m = t % 60;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
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
    if (airport.has_tower?.startsWith('ATCT')) score += 3;
    return score;
  }

  // Zoomed out: surface quality + gentle distance weight
  let score = 0;
  if (airport.fuel) score += 30;
  if (airport.has_tower?.startsWith('ATCT')) score += 20;
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
  /* Prevent WebKit from blurring tile images when scaling */
  .leaflet-tile {
    image-rendering: -webkit-optimize-contrast;
    image-rendering: crisp-edges;
  }
</style>
</head>
<body>
<div id="map"></div>
<script>
// Catch any JS error (e.g. Leaflet failed to load from CDN) and report to React Native
window.onerror = function(msg, src) {
  window.ReactNativeWebView && window.ReactNativeWebView.postMessage(
    JSON.stringify({ type: 'log', text: '[JS error] ' + msg + ' src=' + (src || '?') })
  );
};

var map = L.map('map', { zoomControl: false }).setView([${lat}, ${lng}], 7);

var TILE_URLS = {
  dark:      { url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', opts: { maxZoom: 20, subdomains: 'abcd' } },
  standard:  { url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', opts: { maxZoom: 20, subdomains: 'abcd' } },
  satellite: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', opts: { maxZoom: 20 } },
};
var currentTile = L.tileLayer(TILE_URLS.dark.url, TILE_URLS.dark.opts).addTo(map);

// Detect tile load failures — if several consecutive tiles fail, report to React Native
var _tileErrors = 0;
currentTile.on('tileerror', function() {
  _tileErrors++;
  sendMsg({ type: 'log', text: '[tile] load error #' + _tileErrors });
  if (_tileErrors >= 5) sendMsg({ type: 'tileError', count: _tileErrors });
});

map.createPane('vfrPane');
map.getPane('vfrPane').style.zIndex = 250;

var markersLayer = L.layerGroup().addTo(map);
var radiusCircle = null;
var userMarker = null;

var vfrLayer = null;
var VFR_URL = 'https://tiles.arcgis.com/tiles/ssFJjBXIUyZDrSYZ/arcgis/rest/services/VFR_Sectional/MapServer/tile/{z}/{y}/{x}';
function toggleVFR(enabled) {
  if (enabled && !vfrLayer) {
    vfrLayer = L.tileLayer(VFR_URL, {
      opacity: 0.85,
      minZoom: 6,
      maxZoom: 20,
      maxNativeZoom: 10,
      tileSize: 256,
      pane: 'vfrPane',
      attribution: '',
      detectRetina: true,
      updateWhenZooming: false,
      updateInterval: 200,
    });
    vfrLayer.addTo(map);
  } else if (!enabled && vfrLayer) {
    map.removeLayer(vfrLayer);
    vfrLayer = null;
  }
}

function setMapStyle(style) {
  var t = TILE_URLS[style] || TILE_URLS.dark;
  map.removeLayer(currentTile);
  currentTile = L.tileLayer(t.url, t.opts).addTo(map);
  if (vfrLayer) {
    vfrLayer.remove();
    vfrLayer.addTo(map);
  }
}

function sendMsg(obj) {
  window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(obj));
}

// Airport markers: tower airports blue, everything else orange
var AIRPORT_STYLE = { fillColor: '#FF4D00', radius: 7, fillOpacity: 0.9, color: '#ffffff', weight: 1.5 };
var TOWER_STYLE   = { fillColor: '#38BDF8', radius: 7, fillOpacity: 0.9, color: '#ffffff', weight: 1.5 };
var SELECTED_STYLE = { fillColor: '#FF4D00', radius: 10, fillOpacity: 1.0, color: '#ffffff', weight: 3 };
var SELECTED_TOWER_STYLE = { fillColor: '#38BDF8', radius: 10, fillOpacity: 1.0, color: '#ffffff', weight: 3 };

// Keyed by ident so we can restyle on selection
var markerMap = {};
var towerSet = {};
var selectedIdent = null;

function updateMarkers(data) {
  markersLayer.clearLayers();
  markerMap = {};
  towerSet = {};
  selectedIdent = null;
  data.forEach(function(a) {
    var hasTower = (a.has_tower || '').indexOf('ATCT') === 0;
    var baseStyle = hasTower ? TOWER_STYLE : AIRPORT_STYLE;
    var m = L.circleMarker([a.lat, a.lng], Object.assign({}, baseStyle));
    m.on('click', function(e) {
      L.DomEvent.stopPropagation(e);
      L.DomEvent.preventDefault(e);
      sendMsg({ type: 'tap', airport: a });
    });
    m.on('touchstart', function(e) {
      L.DomEvent.stopPropagation(e);
      L.DomEvent.preventDefault(e);
      sendMsg({ type: 'tap', airport: a });
    });
    var id = a.ident || a.icao || (a.lat + ',' + a.lng);
    markerMap[id] = m;
    if (hasTower) towerSet[id] = true;
    markersLayer.addLayer(m);
  });
}

function highlightMarker(ident) {
  // Reset previous
  if (selectedIdent && markerMap[selectedIdent]) {
    markerMap[selectedIdent].setStyle(Object.assign({}, towerSet[selectedIdent] ? TOWER_STYLE : AIRPORT_STYLE));
  }
  selectedIdent = ident;
  if (ident && markerMap[ident]) {
    markerMap[ident].setStyle(Object.assign({}, towerSet[ident] ? SELECTED_TOWER_STYLE : SELECTED_STYLE));
    markerMap[ident].bringToFront();
  }
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

var userHalo = null;
function updateUserLocation(lat, lng) {
  if (userHalo)   { map.removeLayer(userHalo);   userHalo = null; }
  if (userMarker) { map.removeLayer(userMarker); userMarker = null; }
  // Soft translucent halo
  userHalo = L.circleMarker([lat, lng], {
    radius: 16, fillColor: '#38BDF8', fillOpacity: 0.18,
    color: '#38BDF8', weight: 0,
  }).addTo(map);
  // GPS puck center
  userMarker = L.circleMarker([lat, lng], {
    radius: 9, fillColor: '#38BDF8', fillOpacity: 1,
    color: '#ffffff', weight: 2.5,
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

// ── Easter egg: DRZA ──────────────────────────────────────────────────────────
(function() {
  var DRZA_LAT = 16.9656, DRZA_LNG = 8.0001;
  var egg = L.circleMarker([DRZA_LAT, DRZA_LNG], {
    radius: 8, fillColor: '#FFD700', fillOpacity: 1,
    color: '#ffffff', weight: 2,
  }).addTo(map);
  function tapDrza(e) {
    L.DomEvent.stopPropagation(e);
    L.DomEvent.preventDefault(e);
    sendMsg({ type: 'tap', airport: { icao: 'DRZA', name: 'Agadez', city: 'Agadez', state: 'Niger', lat: DRZA_LAT, lng: DRZA_LNG, ident: 'DRZA' } });
  }
  egg.on('click', tapDrza);
  egg.on('touchstart', tapDrza);
})();

// Listen for messages from React Native
document.addEventListener('message', handleRNMessage);
window.addEventListener('message', handleRNMessage);
function handleRNMessage(e) {
  try {
    var msg = JSON.parse(e.data);
    if (msg.type === 'airports')       updateMarkers(msg.data);
    if (msg.type === 'highlight')      highlightMarker(msg.ident);
    if (msg.type === 'radius')         updateRadius(msg.lat, msg.lng, msg.meters);
    if (msg.type === 'userLocation')   updateUserLocation(msg.lat, msg.lng);
    if (msg.type === 'centerOn')       centerOn(msg.lat, msg.lng, msg.zoom);
    if (msg.type === 'setStyle')       setMapStyle(msg.style);
    if (msg.type === 'toggleVFR')      toggleVFR(msg.enabled);
  } catch(err) {}
}

sendMsg({ type: 'ready' });
</script>
</body>
</html>`;
}

export default function MapScreen() {
  const { user } = useAuth();
  const [cruiseSpeed, setCruiseSpeed] = useState(120);

  // Re-read cruise speed every time the Discover tab comes into focus so that
  // changes made in Pilot Information settings are picked up immediately.
  useFocusEffect(useCallback(() => {
    if (!user?.id) return;
    AsyncStorage.getItem(`userProfile:${user.id}`).then(raw => {
      if (!raw) return;
      try {
        const p = JSON.parse(raw);
        const s = Number(p.cruise_speed);
        if (s > 0) {
          setCruiseSpeed(s);
          if (__DEV__) console.log('[Discover] cruise speed loaded on focus:', s, 'kts');
        } else {
          if (__DEV__) console.log('[Discover] no cruise_speed in profile — using default 120 kts');
        }
      } catch (e) {
        if (__DEV__) console.warn('[Discover] failed to parse userProfile for cruise speed:', e);
      }
    });
  }, [user?.id]));

  const [location, setLocation] = useState<any>(null);
  const [activeFilters, setActiveFilters] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [radiusNm, setRadiusNm] = useState(0);
  const [customRadiusInput, setCustomRadiusInput] = useState('');

  // Load persisted radius on mount
  useEffect(() => {
    AsyncStorage.getItem('mapRadiusNm').then(saved => {
      if (saved) {
        const n = parseInt(saved, 10);
        if (n > 0) {
          setRadiusNm(n);
          if (__DEV__) console.log('[Map] restored radius from storage:', n, 'nm');
        }
      }
    }).catch(() => {});
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const mapHtml = useMemo(() => buildMapHtml(38.7, -90.6), []); // built once; location sent via postMessage after ready
  const [selectedAirport, setSelectedAirport] = useState<any>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapKey, setMapKey] = useState(0);       // increment to force WebView remount on retry
  const [mapError, setMapError] = useState(false); // true when map fails/times out
  const [search, setSearch] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [mapStyle, setMapStyle] = useState<'dark' | 'standard' | 'satellite'>('dark');
  const [vfrEnabled, setVfrEnabled] = useState(true);
  const [crewCarMap, setCrewCarMap] = useState<Record<string, any>>({});
  const [crewCarAvailableSet, setCrewCarAvailableSet] = useState<Set<string>>(new Set());
  const [browseListPlaces, setBrowseListPlaces] = useState<Record<string, { food: any | null; golf: any | null; hotel: any | null }>>({});
  const searchResults = useMemo(() => {
    if (search.length < 2) return [];
    const q = search.toLowerCase();
    return airports.filter(a =>
      (a.icao || a.id)?.toLowerCase().includes(q) ||
      a.name?.toLowerCase().includes(q) ||
      a.city?.toLowerCase().includes(q)
    ).slice(0, 6);
  }, [search]);
  function selectSearchResult(apt: any) {
    setSearch('');
    Keyboard.dismiss();
    setSelectedAirport(apt);
    webViewRef.current?.postMessage(JSON.stringify({ type: 'centerOn', lat: apt.lat, lng: apt.lng, zoom: 12 }));
  }
  // Zoom, center, and viewport bounds reported by the WebView after each pan/zoom
  const [mapView, setMapView] = useState({
    zoom: 7,
    centerLat: location?.latitude || 38.7, centerLng: location?.longitude || -90.6,
    swLat: 0, swLng: 0, neLat: 0, neLng: 0,
  });

  const sheetAnim = useRef(new Animated.Value(SNAP_CLOSED)).current;
  const [sheetAirport, setSheetAirport] = useState<any>(null);
  const [sheetPhoto, setSheetPhoto] = useState<string | null>(null);
  const [sheetPlaces, setSheetPlaces] = useState<{
    restaurant: any | null; hotel: any | null; golf: any | null; thing: any | null;
  }>({ restaurant: null, hotel: null, golf: null, thing: null });
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
      const snaps = [SNAP_EXPANDED, SNAP_COMPACT, SNAP_CLOSED];
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

  const browseAnim = useRef(new Animated.Value(BROWSE_COLLAPSED)).current;
  const browseCurSnap = useRef(BROWSE_COLLAPSED);
  // Tracks browse sheet — used when no airport is selected
  const locateBottom = browseAnim.interpolate({
    inputRange: [BROWSE_FULL, BROWSE_COLLAPSED],
    outputRange: [BROWSE_H + 12, 74],
    extrapolate: 'clamp',
  });

  // Tracks airport preview sheet — used when an airport is selected.
  // Sheet has maxHeight: SCREEN_HEIGHT * 0.60, so visible height = maxHeight - translateY.
  //   SNAP_EXPANDED (0)        → visible = 60%  → button at 60% + 12  (default open)
  //   SNAP_COMPACT (25%)       → visible = 35%  → button at 35% + 12  (drag-down state)
  //   SNAP_CLOSED (65%)        → visible = 0    → button at 74 (closed)
  const sheetLocateBottom = sheetAnim.interpolate({
    inputRange: [SNAP_EXPANDED, SNAP_COMPACT, SNAP_CLOSED],
    outputRange: [SCREEN_HEIGHT * 0.60 + 12, SCREEN_HEIGHT * 0.35 + 12, 74],
    extrapolate: 'clamp',
  });
  const browsePan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dy) > 3 && Math.abs(gs.dy) > Math.abs(gs.dx),
    onPanResponderGrant: () => { browseAnim.setOffset(browseCurSnap.current); browseAnim.setValue(0); },
    onPanResponderMove: Animated.event([null, { dy: browseAnim }], { useNativeDriver: false }),
    onPanResponderRelease: (_, gs) => {
      browseAnim.flattenOffset();
      const projected = browseCurSnap.current + gs.dy;
      const snaps = [BROWSE_FULL, BROWSE_PEEK, BROWSE_COLLAPSED];
      let target: number;
      if (gs.vy > 0.5) target = snaps.find(s => s > projected) ?? BROWSE_COLLAPSED;
      else if (gs.vy < -0.5) target = [...snaps].reverse().find(s => s < projected) ?? BROWSE_FULL;
      else target = snaps.reduce((a, b) => Math.abs(b - projected) < Math.abs(a - projected) ? b : a);
      browseCurSnap.current = target;
      Animated.spring(browseAnim, { toValue: target, useNativeDriver: false, bounciness: 2, speed: 18 }).start();
    },
  })).current;

  const webViewRef = useRef<any>(null);
  const router = useRouter();

  // Set radius and persist it for next session
  function applyRadius(nm: number) {
    if (__DEV__) console.log('[Map] radius set to:', nm, 'nm');
    setRadiusNm(nm);
    AsyncStorage.setItem('mapRadiusNm', String(nm)).catch(() => {});
  }

  // Validate and apply a custom radius from the text input
  function applyCustomRadius() {
    const n = parseInt(customRadiusInput, 10);
    if (!customRadiusInput.trim() || isNaN(n)) {
      if (__DEV__) console.log('[Map] custom radius rejected: not a number —', customRadiusInput);
      return;
    }
    if (n <= 0) {
      if (__DEV__) console.log('[Map] custom radius rejected: must be > 0');
      return;
    }
    if (n > 999) {
      if (__DEV__) console.log('[Map] custom radius rejected: exceeds 999 nm limit');
      return;
    }
    if (__DEV__) console.log('[Map] custom radius entered:', n, 'nm');
    applyRadius(n);
    setCustomRadiusInput('');
    Keyboard.dismiss();
  }

  const filtered = useMemo(() => {
    let result = airports;
    if (activeFilters.includes('fuel'))         result = result.filter(a => a.fuel);
    if (activeFilters.includes('tower'))        result = result.filter(a => a.has_tower?.startsWith('ATCT'));
    // Food filter: only airports with a food place within 1.5 statute miles of the airfield.
    // nearestFoodNm is stored in airports.json in nautical miles; × 1.15078 converts to statute miles.
    // 1.5 mi captures on-ramp, FBO, and immediately adjacent restaurants.
    // A strict 0.5 mi cutoff incorrectly excludes known on-ramp airports (e.g. KJEF shows 1.27 mi in
    // the static dataset because the FBO/terminal restaurant isn't well-listed in Google Places).
    // Airports with no food data (nearestFoodNm == null) are excluded — we require confirmed nearby food.
    if (activeFilters.includes('restaurant'))   result = result.filter(a => a.nearestFoodNm != null && a.nearestFoodNm * 1.15078 <= 1.5);
    if (activeFilters.includes('hotel'))        result = result.filter(a => a.nearestHotelNm == null || a.nearestHotelNm <= 5);
    if (activeFilters.includes('golf'))         result = result.filter(a => a.nearestGolfNm != null  && a.nearestGolfNm  <= 5);
    if (activeFilters.includes('attraction'))   result = result.filter(a => a.nearestAttractionNm == null || a.nearestAttractionNm <= 5);
    if (activeFilters.includes('courtesy_car')) result = result.filter(a => crewCarAvailableSet.has((a.icao || a.id || '').toUpperCase()));
    const beforeRadius = result.length;
    if (radiusNm > 0 && location) {
      if (__DEV__) console.log(`[Map] radius filter: anchor=(${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}) | radius=${radiusNm} nm | airports before=${beforeRadius}`);
      result = result.filter(a => getDistanceNm(location.latitude, location.longitude, a.lat, a.lng) <= radiusNm);
      if (__DEV__) console.log(`[Map] radius filter: airports after=${result.length} (removed ${beforeRadius - result.length})`);
    }
    return result;
  }, [activeFilters, radiusNm, location, crewCarAvailableSet]);

  // Top MAX_MARKERS airports with two-phase selection.
  const selectedMarkers = useMemo(() => {
    const { zoom, centerLat, centerLng } = mapView;
    const zoomedIn = zoom >= ZOOM_IN_THRESHOLD;

    // Zoomed in: only airports visible in the current viewport
    if (zoomedIn) {
      const { swLat, swLng, neLat, neLng } = mapView;
      const hasBounds = neLat !== 0 || swLat !== 0;
      const pool = hasBounds
        ? filtered.filter(a => a.lat >= swLat && a.lat <= neLat && a.lng >= swLng && a.lng <= neLng)
        : filtered;
      return pool
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

  useEffect(() => {
    if (!mapReady || !webViewRef.current) return;
    webViewRef.current.postMessage(JSON.stringify({ type: 'setStyle', style: mapStyle }));
  }, [mapStyle, mapReady]);

  // If the map hasn't signalled ready within 12 s, show a retry fallback.
  // Resets whenever the WebView is remounted (mapKey changes) or mapReady fires.
  useEffect(() => {
    if (mapReady) { setMapError(false); return; }
    const t = setTimeout(() => {
      if (!mapReady) {
        if (__DEV__) console.warn('[Map] mapReady not received after 12s — CDN or network may be blocked');
        setMapError(true);
      }
    }, 12000);
    return () => clearTimeout(t);
  }, [mapKey, mapReady]);

  useEffect(() => {
    if (!mapReady || !webViewRef.current) return;
    webViewRef.current.postMessage(JSON.stringify({ type: 'toggleVFR', enabled: vfrEnabled }));
  }, [vfrEnabled, mapReady]);

  // Send scored markers to WebView whenever they change
  useEffect(() => {
    if (!mapReady || !webViewRef.current) return;
    if (__DEV__) console.log('[Map] zoom:', mapView.zoom, '| filtered:', filtered.length, '| sending:', selectedMarkers.length);
    webViewRef.current.postMessage(JSON.stringify({ type: 'airports', data: selectedMarkers }));
  }, [selectedMarkers, mapReady]);

  // Load the set of ICAOs where the most-recent crew car report is "available".
  // Used by the courtesy_car filter — fetches all reports once and deduplicates.
  useEffect(() => {
    if (!activeFilters.includes('courtesy_car')) return;
    supabase.from('crew_cars').select('icao, available, reported_at')
      .order('reported_at', { ascending: false })
      .then(({ data }) => {
        const latest: Record<string, boolean> = {};
        for (const r of (data ?? [])) {
          if (!(r.icao in latest)) latest[r.icao] = !!r.available;
        }
        const s = new Set(Object.entries(latest).filter(([, v]) => v).map(([k]) => k));
        setCrewCarAvailableSet(s);
      });
  }, [activeFilters]);

  // Batch-fetch crew car status for all visible airports (for list/sheet display)
  useEffect(() => {
    const icaos = selectedMarkers.map((a: any) => (a.icao || a.id || '').toUpperCase()).filter(Boolean);
    if (!icaos.length) return;
    supabase.from('crew_cars').select('icao, available, reported_at').in('icao', icaos)
      .order('reported_at', { ascending: false })
      .then(({ data }) => {
        // Keep only the most-recent report per ICAO
        const map: Record<string, any> = {};
        for (const r of (data ?? [])) {
          if (!(r.icao in map)) map[r.icao] = r;
        }
        setCrewCarMap(map);
      });
  }, [selectedMarkers]);

  // Batch-fetch Supabase places cache for all visible airports.
  // 3 queries total (one per category using .in()), same tables as airport detail page.
  useEffect(() => {
    const icaos = selectedMarkers.map((a: any) => airportIdent(a).toUpperCase()).filter(Boolean);
    if (!icaos.length) { setBrowseListPlaces({}); return; }
    const now = new Date().toISOString();
    Promise.all([
      supabase.from('airport_places_cache').select('airport_icao, data').in('airport_icao', icaos).eq('category', 'restaurants').gt('expires_at', now),
      supabase.from('airport_places_cache').select('airport_icao, data').in('airport_icao', icaos).eq('category', 'golf').gt('expires_at', now),
      supabase.from('airport_places_cache').select('airport_icao, data').in('airport_icao', icaos).eq('category', 'hotels').gt('expires_at', now),
    ]).then(([foodRes, golfRes, hotelRes]) => {
      const result: Record<string, { food: any | null; golf: any | null; hotel: any | null }> = {};
      const ensure = (icao: string) => { if (!result[icao]) result[icao] = { food: null, golf: null, hotel: null }; };
      (foodRes.data ?? []).forEach((r: any) => { ensure(r.airport_icao); result[r.airport_icao].food  = r.data?.[0] ?? null; });
      (golfRes.data ?? []).forEach((r: any) => { ensure(r.airport_icao); result[r.airport_icao].golf  = r.data?.[0] ?? null; });
      (hotelRes.data ?? []).forEach((r: any) => { ensure(r.airport_icao); result[r.airport_icao].hotel = r.data?.[0] ?? null; });
      if (__DEV__) console.log(`[BrowseList] batch cache: ${Object.keys(result).length}/${icaos.length} airports have Supabase places data`);
      setBrowseListPlaces(result);
    }).catch(err => {
      if (__DEV__) console.warn('[BrowseList] batch places load error:', err);
    });
  }, [selectedMarkers]);

  // Dev log: what each row will actually show — fires once when data is ready, not on every render
  useEffect(() => {
    if (!__DEV__) return;
    selectedMarkers.slice(0, 8).forEach((a: any) => {
      const icao = airportIdent(a).toUpperCase();
      const cached = browseListPlaces[icao];
      const hasCrewCar = crewCarMap[icao]?.available === true;
      const foodLabel = cached?.food
        ? (cached.food.distanceMiles != null ? `${cached.food.name} • ${cached.food.distanceMiles} mi` : cached.food.name)
        : a.nearestFoodNm != null ? `Food • ${(a.nearestFoodNm * 1.15078).toFixed(1)} mi` : null;
      const golfLabel = cached?.golf
        ? (cached.golf.distanceMiles != null ? `${cached.golf.name} • ${cached.golf.distanceMiles} mi` : cached.golf.name)
        : a.nearestGolfName ? `${a.nearestGolfName} • ${a.nearestGolfDistanceMi != null ? a.nearestGolfDistanceMi + ' mi' : a.nearestGolfNm != null ? (a.nearestGolfNm * 1.15078).toFixed(1) + ' mi' : ''}` : a.nearestGolfNm != null ? `Golf • ${(a.nearestGolfNm * 1.15078).toFixed(1)} mi` : null;
      const hotelLabel = cached?.hotel
        ? (cached.hotel.distanceMiles != null ? `${cached.hotel.name} • ${cached.hotel.distanceMiles} mi` : cached.hotel.name)
        : a.nearestHotelNm != null ? `Stay • ${(a.nearestHotelNm * 1.15078).toFixed(1)} mi` : null;
      if (__DEV__) console.log(
        `[BrowseRow:${icao}]` +
        ` fuel=${a.fuel ? formatFuel(a.fuel) : 'none'}` +
        ` crewCar=${hasCrewCar}` +
        ` | food=${foodLabel ?? 'hidden'}` +
        ` | golf=${golfLabel ?? 'hidden'}` +
        ` | stay=${hotelLabel ?? 'hidden'}`
      );
    });
  }, [browseListPlaces, selectedMarkers, crewCarMap]);

  // Dev log: Food filter — fires when filter is toggled or visible airports change
  useEffect(() => {
    if (!__DEV__ || !activeFilters.includes('restaurant')) return;
    const FOOD_MI = 1.5;
    const allWithFood = airports.filter(a => a.nearestFoodNm != null);
    const passing     = allWithFood.filter(a => a.nearestFoodNm * 1.15078 <= FOOD_MI);
    const failing     = allWithFood.filter(a => a.nearestFoodNm * 1.15078 >  FOOD_MI);
    console.log(
      `[FoodFilter] threshold=${FOOD_MI} mi |` +
      ` PASS=${passing.length} airports |` +
      ` FAIL_FAR=${failing.length} (food >1.5 mi) |` +
      ` FAIL_NONE=${airports.length - allWithFood.length} (no food data)`
    );
    // Log each visible marker so you can verify name + distance
    selectedMarkers.slice(0, 8).forEach((a: any) => {
      const icao    = airportIdent(a).toUpperCase();
      const distMi  = +(a.nearestFoodNm * 1.15078).toFixed(2);
      const cached  = browseListPlaces[icao];
      const name    = cached?.food?.name ?? '(open airport page to cache name)';
      const cacheDist = cached?.food?.distanceMiles != null ? `cache=${cached.food.distanceMiles} mi` : 'no cache';
      console.log(`[FoodFilter:${icao}] PASS | dataset=${distMi} mi | ${cacheDist} | "${name}"`);
    });
  }, [activeFilters, selectedMarkers, browseListPlaces]);

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
      if (__DEV__) {
        console.log('[MapPreview] tapped:', airportIdent(selectedAirport));
        console.log('[MapPreview] opening at snap:', SNAP_EXPANDED, '→ visible ~60% of screen');
      }
      setSheetAirport(selectedAirport);
      setSheetPhoto(null);
      setSheetPlaces({ restaurant: null, hotel: null, golf: null, thing: null });
      fetchSheetPhoto(selectedAirport);
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
        if (__DEV__) console.log('[Map] WebView ready');
        setMapReady(true);
      } else if (msg.type === 'viewChanged') {
        if (__DEV__) console.log('[Map] viewport zoom:', msg.zoom, 'center:', msg.centerLat?.toFixed(2), msg.centerLng?.toFixed(2));
        setMapView({ zoom: msg.zoom, centerLat: msg.centerLat, centerLng: msg.centerLng, swLat: msg.swLat ?? 0, swLng: msg.swLng ?? 0, neLat: msg.neLat ?? 0, neLng: msg.neLng ?? 0 });
      } else if (msg.type === 'tap') {
        setSelectedAirport(msg.airport);
        const ident = msg.airport?.ident || msg.airport?.icao;
        webViewRef.current?.postMessage(JSON.stringify({ type: 'highlight', ident }));
      } else if (msg.type === 'mapTap') {
        setSelectedAirport(null);
        webViewRef.current?.postMessage(JSON.stringify({ type: 'highlight', ident: null }));
      } else if (msg.type === 'tileError') {
        if (__DEV__) console.warn('[Map] tile load failures:', msg.count, '— network or CDN issue');
        setMapError(true);
      } else if (msg.type === 'log') {
        if (__DEV__) console.log('[MapJS]', msg.text);
      }
    } catch (e) {
      console.error('[Map] handleMessage parse error:', e);
    }
  }, []);

  function goToAirport(airport: any) {
    if (__DEV__) console.log('[MapPreview] navigating to airport:', airportIdent(airport));
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


  function centerOnUser() {
    if (location && webViewRef.current) {
      webViewRef.current.postMessage(JSON.stringify({
        type: 'centerOn', lat: location.latitude, lng: location.longitude, zoom: 10,
      }));
    }
  }

  async function fetchSheetPhoto(apt: any) {
    const ident = airportIdent(apt); // icao → faa → id, same priority as goToAirport / airport.tsx
    const url = await fetchAirportHeroPhoto({
      icao: ident,
      lat: apt.lat,
      lng: apt.lng,
      heroImage: apt.heroImage,
    });
    if (__DEV__) {
      if (url) console.log(`[MapPreview:${ident}] hero image →`, url);
      else     console.log(`[MapPreview:${ident}] hero image → no result, showing fallback`);
    }
    setSheetPhoto(url);
  }

  async function fetchSheetPlaces(apt: any) {
    // Bug fix: use airportIdent (icao → faa → id) so FAA-only airports get a valid key.
    // Previously used apt.icao ?? apt.ident, but airports.json has no `ident` field —
    // any airport with icao:null would produce an empty string and return early with no data.
    const icao = airportIdent(apt).toUpperCase();
    if (!icao || icao === '?') return;

    // ── Step 1: check Supabase cache (same tables as airport detail page) ─────
    const [cachedRest, cachedHotels, cachedGolfRaw, cachedThings] = await Promise.all([
      getCachedCategory(icao, 'restaurants'),
      getCachedCategory(icao, 'hotels'),
      getCachedCategory(icao, 'golf'),
      getCachedCategory(icao, 'things'),
    ]);
    // Treat an empty golf array as a miss — same logic as airport.tsx.
    // Old broken fetches wrote [] to cache; this forces a fresh fetch to fix it.
    const cachedGolf = (cachedGolfRaw && cachedGolfRaw.length > 0) ? cachedGolfRaw : null;

    const allCached = !!(cachedRest && cachedHotels && cachedGolf && cachedThings);

    if (__DEV__) {
      console.log(
        `[MapPreview:${icao}] cache check —` +
        ` food=${cachedRest ? cachedRest.length : 'MISS'}` +
        ` golf=${cachedGolf ? cachedGolf.length : 'MISS'}` +
        ` stay=${cachedHotels ? cachedHotels.length : 'MISS'}` +
        ` do=${cachedThings ? cachedThings.length : 'MISS'}` +
        ` | source=${allCached ? 'cache (all)' : 'API needed for missing'}`
      );
    }

    let foodArr   = cachedRest   ?? null;
    let hotelArr  = cachedHotels ?? null;
    let golfArr   = cachedGolf   ?? null;
    let thingsArr = cachedThings ?? null;

    // ── Step 2: live fetch — only fetch eat tab for sheet preview (saves 75% API calls) ──
    if (!allCached && apt.lat != null && apt.lng != null) {
      try {
        // Only fetch eat tab live — other tabs will load when user opens airport detail
        if (!cachedRest) {
          const freshRest = await fetchGooglePlacesTab(apt.lat, apt.lng, 'eat', icao, apt.name ?? '', 'explore_sheet_food');
          if (freshRest) { foodArr = freshRest; setCachedCategory(icao, 'restaurants', freshRest); }
        }

      } catch (err) {
        if (__DEV__) console.warn(`[MapPreview:${icao}] live fetch error:`, err);
        // fall through — whatever was cached (or null) will be used below
      }
    }

    const result = {
      restaurant: foodArr?.[0]   ?? null,
      hotel:      hotelArr?.[0]  ?? null,
      golf:       golfArr?.[0]   ?? null,
      thing:      thingsArr?.[0] ?? null,
    };

    if (__DEV__) {
      const fmt = (label: string, p: any) =>
        p
          ? `${label}: "${p.name}" • ${p.distanceMiles != null ? p.distanceMiles + ' mi' : 'no dist'}`
          : `${label}: HIDDEN (no data)`;
      console.log(`[MapPreview:${icao}] rows →`);
      console.log('  ' + fmt('food', result.restaurant));
      console.log('  ' + fmt('golf', result.golf));
      console.log('  ' + fmt('stay', result.hotel));
      console.log('  ' + fmt('do',   result.thing));
    }

    setSheetPlaces(result);
  }


  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color="#38BDF8" size="large" />
        <Text style={styles.loadingText}>Getting your location...</Text>
      </View>
    );
  }


  return (
    <View style={styles.container}>
      {/* baseUrl:'https://localhost' is required on iOS WKWebView — without it the page
          has a null origin and iOS blocks cross-origin CDN requests (Leaflet + tile images). */}
      <WebView
        key={mapKey}
        ref={webViewRef}
        style={styles.map}
        source={{ html: mapHtml, baseUrl: 'https://localhost' }}
        onMessage={handleMessage}
        onError={e => console.error('[Map] WebView error:', e.nativeEvent)}
        onHttpError={e => console.error('[Map] WebView HTTP error:', e.nativeEvent.statusCode)}
        onLoadStart={() => { if (__DEV__) console.log('[Map] WebView onLoadStart — loading HTML'); }}
        onLoadEnd={() => { if (__DEV__) console.log('[Map] WebView onLoadEnd — HTML+scripts parsed'); }}
        javaScriptEnabled
        domStorageEnabled
        originWhitelist={['*']}
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        onTouchStart={Keyboard.dismiss}
      />
      {mapError && (
        <View style={styles.mapErrorOverlay}>
          <Feather name="map" size={48} color="#6B83A0" style={{ marginBottom: 4 }} />
          <Text style={styles.mapErrorTitle}>Map failed to load</Text>
          <Text style={styles.mapErrorSub}>Check your internet connection</Text>
          <TouchableOpacity
            style={styles.mapRetryBtn}
            onPress={() => {
              if (__DEV__) console.log('[Map] retry tapped — remounting WebView (key:', mapKey + 1, ')');
              setMapError(false);
              setMapReady(false);
              setMapKey(k => k + 1);
            }}
            activeOpacity={0.8}
          >
            <Text style={styles.mapRetryBtnTxt}>Tap to Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Search bar */}
      <View style={styles.searchWrap}>
        <View style={styles.searchRow}>
          <GlassSearchBar
            value={search}
            onChangeText={setSearch}
            placeholder="Search airport, city, or ICAO…"
            style={styles.glassBar}
          />
          <TouchableOpacity
            style={styles.routeBtn}
            onPress={() => router.push('/route' as any)}
            activeOpacity={0.75}
          >
            <Feather name="git-branch" size={17} color="#38BDF8" />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.filterBtn, (showFilters || activeFilters.length > 0) && styles.filterBtnActive]}
            onPress={() => setShowFilters(v => !v)}
          >
            <View style={styles.filterIcon}>
              <View style={[styles.filterLine, styles.filterLineTop]} />
              <View style={[styles.filterLine, styles.filterLineMid]} />
              <View style={[styles.filterLine, styles.filterLineBot]} />
            </View>
            {(activeFilters.length > 0 || radiusNm > 0) && (
              <View style={styles.filterBadge}>
                <Text style={styles.filterBadgeText}>{activeFilters.length + (radiusNm > 0 ? 1 : 0)}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
        {showFilters && search.length === 0 && (
          <View style={styles.filterPanel}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRowContent}>
              {FILTERS.map(f => (
                <TouchableOpacity
                  key={f.id}
                  style={[styles.filterChip, activeFilters.includes(f.id) && styles.filterChipActive]}
                  onPress={() => setActiveFilters(prev => prev.includes(f.id) ? prev.filter(x => x !== f.id) : [...prev, f.id])}
                >
                  <Text style={[styles.filterText, activeFilters.includes(f.id) && styles.filterTextActive]}>{f.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <View style={styles.styleRow}>
              {(['standard', 'dark', 'satellite'] as const).map(s => (
                <TouchableOpacity key={s} style={styles.styleOption} onPress={() => setMapStyle(s)}>
                  <View style={styles.styleRadio}>
                    {mapStyle === s && <View style={styles.styleRadioDot} />}
                  </View>
                  <Text style={[styles.styleLabel, mapStyle === s && styles.styleLabelActive]}>
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity style={styles.vfrRow} onPress={() => setVfrEnabled(v => !v)}>
              <View style={[styles.vfrCheck, vfrEnabled && styles.vfrCheckActive]}>
                {vfrEnabled && <Text style={styles.vfrCheckMark}>✓</Text>}
              </View>
              <Text style={[styles.styleLabel, vfrEnabled && styles.styleLabelActive]}>VFR Sectional Overlay</Text>
              {vfrEnabled && <Text style={styles.vfrBadge}>ON</Text>}
            </TouchableOpacity>

            {/* ── Radius filter ─────────────────────────────────────────── */}
            <View style={styles.radiusSectionDivider} />
            <View style={styles.radiusHeader}>
              <Text style={styles.radiusLabel}>RADIUS FROM YOUR LOCATION</Text>
              {radiusNm > 0 && (
                <TouchableOpacity onPress={() => applyRadius(0)}>
                  <Text style={styles.radiusClearBtn}>Clear</Text>
                </TouchableOpacity>
              )}
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.radiusScroll}>
              {[25, 50, 100, 200].map(nm => (
                <TouchableOpacity
                  key={nm}
                  style={[styles.radiusChip, radiusNm === nm && styles.radiusChipActive]}
                  onPress={() => applyRadius(radiusNm === nm ? 0 : nm)}
                >
                  <Text style={[styles.radiusChipText, radiusNm === nm && styles.radiusChipTextActive]}>
                    {nm} nm
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <View style={styles.radiusCustomRow}>
              <TextInput
                style={styles.radiusCustomInput}
                placeholder="Custom nm…"
                placeholderTextColor="#4A6080"
                value={customRadiusInput}
                onChangeText={setCustomRadiusInput}
                keyboardType="number-pad"
                returnKeyType="done"
                onSubmitEditing={applyCustomRadius}
                maxLength={4}
              />
              <TouchableOpacity
                style={[styles.radiusCustomApply, !customRadiusInput.trim() && styles.radiusCustomApplyDisabled]}
                onPress={applyCustomRadius}
                disabled={!customRadiusInput.trim()}
              >
                <Text style={styles.radiusCustomApplyText}>Apply</Text>
              </TouchableOpacity>
            </View>
            {radiusNm > 0 && (
              <Text style={styles.radiusActiveLabel}>
                Showing airports within {radiusNm} nm · {filtered.length} result{filtered.length !== 1 ? 's' : ''}
              </Text>
            )}
          </View>
        )}
        {searchResults.length > 0 && (
          <View style={styles.searchResults}>
            {searchResults.map((a, i) => (
              <Pressable key={i} style={({ pressed }) => [styles.searchResult, pressed && styles.searchResultPressed]} onPress={() => selectSearchResult(a)}>
                <Text style={styles.searchResultId}>{a.icao || a.id}</Text>
                <Text style={styles.searchResultName} numberOfLines={1}>{a.name} · {a.city}, {a.state}</Text>
              </Pressable>
            ))}
          </View>
        )}
        {search.length >= 2 && searchResults.length === 0 && (
          <View style={styles.searchEmpty}>
            <Text style={styles.searchEmptyText}>No airports match "{search}"</Text>
          </View>
        )}
      </View>

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
                keyboardDismissMode="on-drag"
                contentContainerStyle={{ paddingBottom: 32 }}
              >
                {/* Hero banner */}
                <View style={styles.sheetHero}>
                  {sheetPhoto
                    ? <Image source={{ uri: sheetPhoto }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
                    : <View style={styles.sheetHeroFallback} />
                  }
                  <View style={styles.sheetHeroOverlay} />
                </View>

                {/* ICAO + close */}
                <View style={styles.sheetHeader}>
                  <Text style={styles.sheetIdent}>{airportIdent(sheetAirport)}</Text>
                  <TouchableOpacity
                    onPress={() => setSelectedAirport(null)}
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  >
                    <Feather name="x" size={18} color="#6B83A0" />
                  </TouchableOpacity>
                </View>

                {/* Name + location */}
                <Text style={styles.sheetName}>{sheetAirport.name}</Text>
                <Text style={styles.sheetLocation}>{sheetAirport.city}, {sheetAirport.state}</Text>

                {/* Distance + flight time */}
                {distNm !== null && (() => {
                  if (__DEV__) console.log(`[MapPreview:${airportIdent(sheetAirport)}] dist: ${distNm} nm | time: ${estimateFlightTime(distNm, cruiseSpeed)}`);
                  return (
                    <View style={styles.sheetStats}>
                      <View style={styles.sheetStat}>
                        <Text style={styles.sheetStatValue}>{distNm} nm</Text>
                        <Text style={styles.sheetStatLabel}>Distance</Text>
                      </View>
                      <View style={styles.sheetStatDivider} />
                      <View style={styles.sheetStat}>
                        <Text style={styles.sheetStatValue}>{estimateFlightTime(distNm, cruiseSpeed)}</Text>
                        <Text style={styles.sheetStatLabel}>Est. Flight</Text>
                      </View>
                    </View>
                  );
                })()}

                {/* Fuel + elevation compact row */}
                <View style={styles.sheetQuickStats}>
                  {sheetAirport.fuel && (
                    <View style={styles.sheetQuickStat}>
                      <MaterialCommunityIcons name="gas-station" size={13} color="#38BDF8" />
                      <Text style={styles.sheetQuickStatText}>{formatFuel(sheetAirport.fuel)}</Text>
                    </View>
                  )}
                  {!sheetAirport.fuel && (
                    <View style={styles.sheetQuickStat}>
                      <MaterialCommunityIcons name="gas-station" size={13} color="#6B83A0" />
                      <Text style={[styles.sheetQuickStatText, { color: '#6B83A0' }]}>No fuel on record</Text>
                    </View>
                  )}
                  {sheetAirport.elevation != null && (
                    <View style={styles.sheetQuickStat}>
                      <MaterialCommunityIcons name="ruler" size={13} color="#6B83A0" />
                      <Text style={styles.sheetQuickStatText}>{Number(sheetAirport.elevation).toLocaleString()} ft</Text>
                    </View>
                  )}
                </View>

                {/* Crew car */}
                {(() => {
                  const crewCar = crewCarMap[(airportIdent(sheetAirport)).toUpperCase()];
                  if (__DEV__) console.log(`[MapPreview:${airportIdent(sheetAirport)}] crew car:`, crewCar?.available ?? 'not in map');
                  return crewCar?.available === true ? (
                    <View style={styles.sheetPlaceRow}>
                      <MaterialCommunityIcons name="car" size={14} color="#6B83A0" style={{ width: 20 }} />
                      <Text style={styles.sheetPlaceName}>Crew Car Reported</Text>
                    </View>
                  ) : null;
                })()}

                {/* Nearest amenities — one row per category, hidden if no data */}
                {sheetPlaces.restaurant && (() => {
                  const dist = sheetPlaces.restaurant.distanceMiles != null ? `${sheetPlaces.restaurant.distanceMiles} mi` : null;
                  if (__DEV__) console.log(`[MapPreview:${airportIdent(sheetAirport)}] food row: "${sheetPlaces.restaurant.name}" dist=${dist ?? 'FALLBACK'}`);
                  return (
                    <View style={styles.sheetPlaceRow}>
                      <MaterialCommunityIcons name="food" size={14} color="#6B83A0" style={{ width: 20 }} />
                      <Text style={styles.sheetPlaceName} numberOfLines={1}>{sheetPlaces.restaurant.name}</Text>
                      {dist ? <Text style={styles.sheetPlaceDist}>{dist}</Text> : null}
                    </View>
                  );
                })()}
                {sheetPlaces.golf && (() => {
                  const dist = sheetPlaces.golf.distanceMiles != null ? `${sheetPlaces.golf.distanceMiles} mi` : null;
                  if (__DEV__) console.log(`[MapPreview:${airportIdent(sheetAirport)}] golf row: "${sheetPlaces.golf.name}" dist=${dist ?? 'FALLBACK'}`);
                  return (
                    <View style={styles.sheetPlaceRow}>
                      <MaterialCommunityIcons name="golf" size={14} color="#6B83A0" style={{ width: 20 }} />
                      <Text style={styles.sheetPlaceName} numberOfLines={1}>{sheetPlaces.golf.name}</Text>
                      {dist ? <Text style={styles.sheetPlaceDist}>{dist}</Text> : null}
                    </View>
                  );
                })()}
                {sheetPlaces.hotel && (() => {
                  const dist = sheetPlaces.hotel.distanceMiles != null ? `${sheetPlaces.hotel.distanceMiles} mi` : null;
                  if (__DEV__) console.log(`[MapPreview:${airportIdent(sheetAirport)}] stay row: "${sheetPlaces.hotel.name}" dist=${dist ?? 'FALLBACK'}`);
                  return (
                    <View style={styles.sheetPlaceRow}>
                      <MaterialCommunityIcons name="bed" size={14} color="#6B83A0" style={{ width: 20 }} />
                      <Text style={styles.sheetPlaceName} numberOfLines={1}>{sheetPlaces.hotel.name}</Text>
                      {dist ? <Text style={styles.sheetPlaceDist}>{dist}</Text> : null}
                    </View>
                  );
                })()}
                {sheetPlaces.thing && (() => {
                  const dist = sheetPlaces.thing.distanceMiles != null ? `${sheetPlaces.thing.distanceMiles} mi` : null;
                  if (__DEV__) console.log(`[MapPreview:${airportIdent(sheetAirport)}] do row: "${sheetPlaces.thing.name}" dist=${dist ?? 'FALLBACK'}`);
                  return (
                    <View style={styles.sheetPlaceRow}>
                      <MaterialCommunityIcons name="flag-variant" size={14} color="#6B83A0" style={{ width: 20 }} />
                      <Text style={styles.sheetPlaceName} numberOfLines={1}>{sheetPlaces.thing.name}</Text>
                      {dist ? <Text style={styles.sheetPlaceDist}>{dist}</Text> : null}
                    </View>
                  );
                })()}
                {!sheetPlaces.restaurant && !sheetPlaces.golf && !sheetPlaces.hotel && !sheetPlaces.thing && (
                  <Text style={{ fontSize: 12, color: '#4A5B73', paddingVertical: 8 }}>
                    Tap "View Airport" for full details
                  </Text>
                )}
              </ScrollView>

              <TouchableOpacity style={styles.sheetBtn} onPress={() => goToAirport(sheetAirport)}>
                <Text style={styles.sheetBtnText}>View Airport</Text>
              </TouchableOpacity>
            </>
          );
        })()}
      </Animated.View>



      {/* Locate button — tracks airport sheet when selected, browse sheet otherwise */}
      <Animated.View style={[styles.locateBtn, { bottom: selectedAirport ? sheetLocateBottom : locateBottom }]}>
        <TouchableOpacity onPress={centerOnUser} activeOpacity={0.8} style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Feather name="map-pin" size={22} color="#F0F4FF" />
        </TouchableOpacity>
      </Animated.View>

      {/* Browse sheet */}
      <Animated.View style={[styles.browseSheet, { transform: [{ translateY: browseAnim }] }]}>
        {/* Top gradient fade — depth illusion */}
        <View style={styles.browseTopGradient} pointerEvents="none" />

        {/* Handle + count header */}
        <View style={styles.browseHandleArea} {...browsePan.panHandlers}>
          <View style={styles.browseHandle} />
          <View style={styles.browseHeaderRow}>
            <View style={styles.browseDot} />
            <Text style={styles.browseCount}>
              {selectedMarkers.length} AIRPORTS IN VIEW
            </Text>
          </View>
        </View>

        {/* Peek: horizontal cards */}
        <View style={styles.browseCardContainer}>
          <FlatList
            horizontal
            data={selectedMarkers}
            keyExtractor={(a: any, i) => a.icao || a.id || String(i)}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.browseCardScroll}
            renderItem={({ item: a }: { item: any }) => {
              const dist = location ? Math.round(getDistanceNm(location.latitude, location.longitude, a.lat, a.lng)) : null;
              const flightTime = dist != null ? estimateFlightTime(dist, cruiseSpeed) : null;
              const icao = airportIdent(a).toUpperCase();
              const cached = browseListPlaces[icao];
              const hasCrewCar = crewCarMap[icao]?.available === true;
              const hasFuel = !!a.fuel;
              const foodLabel = cached?.food
                ? (cached.food.distanceMiles != null ? `${cached.food.distanceMiles} mi` : 'Nearby')
                : a.nearestFoodNm != null ? `${(a.nearestFoodNm * 1.15078).toFixed(1)} mi` : null;
              const golfLabel = cached?.golf
                ? (cached.golf.distanceMiles != null ? `${cached.golf.distanceMiles} mi` : 'Nearby')
                : a.nearestGolfNm != null ? `${(a.nearestGolfNm * 1.15078).toFixed(1)} mi` : null;
              const hotelLabel = cached?.hotel
                ? (cached.hotel.distanceMiles != null ? `${cached.hotel.distanceMiles} mi` : 'Nearby')
                : a.nearestHotelNm != null ? `${(a.nearestHotelNm * 1.15078).toFixed(1)} mi` : null;
              return (
                <Pressable style={({ pressed }) => [styles.browseCard, pressed && styles.browseCardPressed]} onPress={() => goToAirport(a)}>
                  {/* Inner top glow line */}
                  <View style={styles.browseCardGlow} />

                  {/* ICAO + distance */}
                  <View style={styles.browseCardTopRow}>
                    <View style={styles.browseIcaoBadge}>
                      <Text style={styles.browseCardId}>{icao}</Text>
                    </View>
                    {dist !== null && (
                      <View style={styles.browseDistBadge}>
                        <Text style={styles.browseCardDist}>{dist}<Text style={styles.browseCardDistUnit}> nm</Text></Text>
                      </View>
                    )}
                  </View>

                  {/* Name */}
                  <Text style={styles.browseCardName} numberOfLines={2}>{a.name}</Text>
                  <Text style={styles.browseCardCity} numberOfLines={1}>{a.city}, {a.state}</Text>

                  {/* Fuel + crew car row */}
                  {(hasFuel || hasCrewCar) && (
                    <View style={styles.browseCardMetaRow}>
                      {hasFuel && (
                        <View style={styles.browseCardPill}>
                          <MaterialCommunityIcons name="gas-station" size={9} color="#38BDF8" />
                          <Text style={styles.browseCardPillTxt}>{formatFuel(a.fuel)}</Text>
                        </View>
                      )}
                      {hasCrewCar && (
                        <View style={styles.browseCardPill}>
                          <MaterialCommunityIcons name="car" size={9} color="#38BDF8" />
                          <Text style={styles.browseCardPillTxt}>Car</Text>
                        </View>
                      )}
                    </View>
                  )}

                  {/* Amenity pills */}
                  <View style={styles.browseCardAmenities}>
                    {foodLabel  && <View style={styles.browseCardAmenityPill}><MaterialCommunityIcons name="food" size={9} color="#6B83A0" /><Text style={styles.browseCardAmenityTxt}>🍔 {foodLabel}</Text></View>}
                    {golfLabel  && <View style={styles.browseCardAmenityPill}><MaterialCommunityIcons name="golf" size={9} color="#6B83A0" /><Text style={styles.browseCardAmenityTxt}>⛳ {golfLabel}</Text></View>}
                    {!golfLabel && hotelLabel && <View style={styles.browseCardAmenityPill}><MaterialCommunityIcons name="bed" size={9} color="#6B83A0" /><Text style={styles.browseCardAmenityTxt}>🛏 {hotelLabel}</Text></View>}
                  </View>

                  {/* Flight time footer */}
                  {flightTime && (
                    <Text style={styles.browseCardTime}>{flightTime}</Text>
                  )}
                </Pressable>
              );
            }}
          />
        </View>

        {/* Full: vertical list */}
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }} onScrollBeginDrag={Keyboard.dismiss}>
          {selectedMarkers.map((a: any, i: number) => {
            const dist = location ? Math.round(getDistanceNm(location.latitude, location.longitude, a.lat, a.lng)) : null;
            const icao = airportIdent(a).toUpperCase();
            const cached = browseListPlaces[icao];
            const hasCrewCar = crewCarMap[icao]?.available === true;
            const hasFuel = !!a.fuel;
            const foodLabel = cached?.food
              ? (cached.food.distanceMiles != null ? `${cached.food.name} · ${cached.food.distanceMiles} mi` : cached.food.name)
              : a.nearestFoodNm != null ? `Food · ${(a.nearestFoodNm * 1.15078).toFixed(1)} mi` : null;
            const golfLabel = cached?.golf
              ? (cached.golf.distanceMiles != null ? `${cached.golf.name} · ${cached.golf.distanceMiles} mi` : cached.golf.name)
              : a.nearestGolfName ? `${a.nearestGolfName}${a.nearestGolfDistanceMi != null ? ` · ${a.nearestGolfDistanceMi} mi` : a.nearestGolfNm != null ? ` · ${(a.nearestGolfNm * 1.15078).toFixed(1)} mi` : ''}` : a.nearestGolfNm != null ? `Golf · ${(a.nearestGolfNm * 1.15078).toFixed(1)} mi` : null;
            const hotelLabel = cached?.hotel
              ? (cached.hotel.distanceMiles != null ? `${cached.hotel.name} · ${cached.hotel.distanceMiles} mi` : cached.hotel.name)
              : a.nearestHotelNm != null ? `Stay · ${(a.nearestHotelNm * 1.15078).toFixed(1)} mi` : null;
            return (
              <Pressable key={a.icao || a.id || i} style={({ pressed }) => [styles.browseRow, pressed && styles.browseRowPressed]} onPress={() => goToAirport(a)}>
                {/* Left: identity */}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={styles.browseRowTopLine}>
                    <Text style={styles.browseRowId}>{icao}</Text>
                  </View>
                  <Text style={styles.browseRowName} numberOfLines={1}>{a.name}</Text>
                  <Text style={styles.browseRowCity}>{a.city}, {a.state}</Text>

                  {/* Inline pills: fuel + crew car */}
                  {(hasFuel || hasCrewCar) && (
                    <View style={styles.browseRowPills}>
                      {hasFuel && (
                        <View style={styles.browseRowPillBlue}>
                          <MaterialCommunityIcons name="gas-station" size={10} color="#38BDF8" />
                          <Text style={styles.browseRowPillBlueTxt}>{formatFuel(a.fuel)}</Text>
                        </View>
                      )}
                      {hasCrewCar && (
                        <View style={styles.browseRowPillGray}>
                          <MaterialCommunityIcons name="car" size={10} color="#6B83A0" />
                          <Text style={styles.browseRowPillGrayTxt}>Crew Car</Text>
                        </View>
                      )}
                    </View>
                  )}

                  {/* Amenities */}
                  {(foodLabel || golfLabel || hotelLabel) && (
                    <View style={styles.browseRowAmenities}>
                      {foodLabel  && <View style={styles.browseRowAmenityItem}><MaterialCommunityIcons name="food" size={11} color="#4E6A88" /><Text style={styles.browseRowAmenity} numberOfLines={1}>{foodLabel}</Text></View>}
                      {golfLabel  && <View style={styles.browseRowAmenityItem}><MaterialCommunityIcons name="golf" size={11} color="#4E6A88" /><Text style={styles.browseRowAmenity} numberOfLines={1}>{golfLabel}</Text></View>}
                      {hotelLabel && <View style={styles.browseRowAmenityItem}><MaterialCommunityIcons name="bed"  size={11} color="#4E6A88" /><Text style={styles.browseRowAmenity} numberOfLines={1}>{hotelLabel}</Text></View>}
                    </View>
                  )}
                </View>

                {/* Right: distance + time */}
                {dist !== null && (
                  <View style={styles.browseRowDistGroup}>
                    <Text style={styles.browseRowDist}>{dist}<Text style={styles.browseRowDistUnit}> nm</Text></Text>
                    <Text style={styles.browseRowTime}>{estimateFlightTime(dist, cruiseSpeed)}</Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </ScrollView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#060B16' },
  map: { flex: 1, backgroundColor: '#060B16' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, backgroundColor: '#060B16' },
  mapErrorOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: '#060B16', alignItems: 'center', justifyContent: 'center', gap: 8 },
  mapErrorTitle: { fontSize: 18, fontWeight: '700', color: '#F0F4FF' },
  mapErrorSub: { fontSize: 13, color: '#6B83A0', marginBottom: 16 },
  mapRetryBtn: { backgroundColor: '#1E3A5F', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 32, borderWidth: 1, borderColor: '#38BDF8' },
  mapRetryBtnTxt: { color: '#38BDF8', fontSize: 15, fontWeight: '700' },
  loadingText: { color: '#6B83A0', fontSize: 14 },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  sheet: { position: 'absolute', bottom: 0, left: 0, right: 0, maxHeight: SCREEN_HEIGHT * 0.60, backgroundColor: '#0D1421', borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderColor: '#1E2D45', paddingHorizontal: 20, paddingBottom: 90 },
  sheetHero: { height: 100, marginHorizontal: -20, marginBottom: 12, overflow: 'hidden', backgroundColor: '#111827' },
  sheetHeroFallback: { ...StyleSheet.absoluteFillObject, backgroundColor: '#111827' },
  sheetHeroOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.20)' },
  sheetHandleArea: { alignItems: 'center', paddingTop: 12, paddingBottom: 12, marginHorizontal: -20 },
  sheetHandle: { width: 40, height: 4, backgroundColor: '#1E2D45', borderRadius: 2 },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  sheetIdent: { fontSize: 13, fontWeight: '700', color: '#38BDF8', letterSpacing: 1 },
  sheetClose: { color: '#6B83A0' },
  sheetName: { fontSize: 20, fontWeight: '700', color: '#F0F4FF', marginBottom: 2 },
  sheetLocation: { fontSize: 13, color: '#6B83A0', marginBottom: 8 },
  sheetStats: { flexDirection: 'row', backgroundColor: '#111827', borderRadius: 14, padding: 12, marginBottom: 12, alignItems: 'center' },
  sheetStat: { flex: 1, alignItems: 'center' },
  sheetStatValue: { fontSize: 22, fontWeight: '700', color: '#F0F4FF', marginBottom: 2 },
  sheetStatLabel: { fontSize: 11, color: '#6B83A0', textTransform: 'uppercase', letterSpacing: 0.8 },
  sheetStatDivider: { width: 1, height: 36, backgroundColor: '#1E2D45' },
  sheetQuickStats: { flexDirection: 'row', gap: 14, marginBottom: 8, flexWrap: 'wrap' },
  sheetQuickStat: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  sheetQuickStatText: { fontSize: 12, color: '#C8D8EE', fontWeight: '600' },
  sheetPlaceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderTopWidth: 1, borderTopColor: '#111827' },
  sheetPlaceName: { flex: 1, fontSize: 12, color: '#C8D8EE', fontWeight: '500' },
  sheetPlaceDist: { fontSize: 12, color: '#6B83A0', fontWeight: '600' },
  sheetBtn: { backgroundColor: '#38BDF8', borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  sheetBtnText: { color: '#0D1421', fontSize: 16, fontWeight: '700' },
  topButtons: { position: 'absolute', top: 60, right: 16, gap: 10 },
  iconBtn: { backgroundColor: '#0D1421', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#1E2D45', minWidth: 48, alignItems: 'center' },
  iconBtnActive: { backgroundColor: '#38BDF8', borderColor: '#38BDF8' },
  iconBtnText: { fontSize: 20, color: '#F0F4FF' },
  iconBtnTextActive: { color: '#0D1421', fontSize: 13, fontWeight: '700' },
  radiusPanel: { position: 'absolute', top: 60, left: 16, right: 72, backgroundColor: '#0D1421', borderRadius: 16, padding: 14, borderWidth: 1, borderColor: '#1E2D45' },
  radiusSectionDivider: { height: 1, backgroundColor: '#1E2D45', marginVertical: 10 },
  radiusHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  radiusLabel: { fontSize: 11, fontWeight: '700', color: '#6B83A0', letterSpacing: 1.2, textTransform: 'uppercase' },
  radiusClearBtn: { fontSize: 12, color: '#38BDF8', fontWeight: '600' },
  radiusCount: { fontSize: 12, fontWeight: '700', color: '#FF4D00' },
  radiusScroll: { gap: 8, flexDirection: 'row', marginBottom: 10 },
  radiusChip: { backgroundColor: '#111827', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: '#1E2D45' },
  radiusChipActive: { backgroundColor: '#38BDF8', borderColor: '#38BDF8' },
  radiusChipText: { fontSize: 13, color: '#6B83A0', fontWeight: '600' },
  radiusChipTextActive: { color: '#0D1421', fontWeight: '700' },
  radiusCustomRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 6 },
  radiusCustomInput: { flex: 1, backgroundColor: '#111827', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9, color: '#F0F4FF', fontSize: 14, borderWidth: 1, borderColor: '#1E2D45' },
  radiusCustomApply: { backgroundColor: '#38BDF8', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 9 },
  radiusCustomApplyDisabled: { opacity: 0.35 },
  radiusCustomApplyText: { fontSize: 14, fontWeight: '700', color: '#0D1421' },
  radiusActiveLabel: { fontSize: 11, color: '#FF4D00', fontWeight: '600', marginTop: 4 },
  filterChip: { backgroundColor: 'rgba(13,20,33,0.92)', borderRadius: 20, paddingHorizontal: 13, paddingVertical: 7, borderWidth: 1, borderColor: '#1E2D45' },
  filterChipActive: { backgroundColor: '#38BDF8', borderColor: '#38BDF8' },
  filterText: { fontSize: 12, color: '#6B83A0', fontWeight: '600' },
  filterTextActive: { color: '#0D1421' },
  filterRow: { marginTop: 8, marginHorizontal: -4 },
  filterRowContent: { paddingHorizontal: 4, gap: 7 },
  // ── Browse sheet ────────────────────────────────────────────────────────────
  browseSheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0, height: BROWSE_H,
    backgroundColor: '#080E1C',
    borderTopLeftRadius: 26, borderTopRightRadius: 26,
    borderWidth: 1, borderColor: 'rgba(56,189,248,0.14)',
    overflow: 'hidden',
  },
  browseTopGradient: {
    position: 'absolute', top: 0, left: 0, right: 0, height: 60,
    backgroundColor: 'rgba(56,189,248,0.03)', zIndex: 1,
  },
  browseHandleArea: { alignItems: 'center', paddingTop: 12, paddingBottom: 10, zIndex: 2 },
  browseHandle: { width: 36, height: 3.5, backgroundColor: 'rgba(56,189,248,0.25)', borderRadius: 2, marginBottom: 10 },
  browseHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  browseDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#38BDF8', opacity: 0.7 },
  browseCount: { fontSize: 11, fontWeight: '700', color: '#4E6A88', letterSpacing: 1.4 },
  // ── Horizontal cards ────────────────────────────────────────────────────────
  browseCardContainer: { height: 208, flexShrink: 0 },
  browseCardScroll: { paddingHorizontal: 14, paddingBottom: 12, paddingTop: 2, gap: 10 },
  browseCard: {
    width: 162, height: 188, backgroundColor: '#07111E',
    borderRadius: 16, padding: 12,
    borderWidth: 1, borderColor: 'rgba(56,189,248,0.20)',
    flexShrink: 0, overflow: 'hidden',
  },
  browseCardPressed: { backgroundColor: '#0C1929', borderColor: 'rgba(56,189,248,0.40)' },
  cardTopHighlight: { position: 'absolute', top: 0, left: 0, right: 0, height: 1, backgroundColor: 'rgba(255,255,255,0.08)' },
  browseCardGlow: { position: 'absolute', top: 0, left: 0, right: 0, height: 1, backgroundColor: 'rgba(56,189,248,0.30)' },
  browseCardTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  browseIcaoBadge: {
    backgroundColor: 'rgba(56,189,248,0.10)', borderRadius: 6,
    paddingHorizontal: 6, paddingVertical: 2,
    borderWidth: 1, borderColor: 'rgba(56,189,248,0.20)',
  },
  browseCardId: { fontSize: 12, fontWeight: '800', color: '#38BDF8', letterSpacing: 0.8 },
  browseDistBadge: { alignItems: 'flex-end' },
  browseCardDist: { fontSize: 13, fontWeight: '700', color: '#C8D8EE' },
  browseCardDistUnit: { fontSize: 10, fontWeight: '500', color: '#4E6A88' },
  browseCardDistSmall: { fontSize: 11, fontWeight: '700', color: '#C8D8EE' },
  browseCardName: { fontSize: 13, fontWeight: '700', color: '#E8F0FC', lineHeight: 17, marginBottom: 1 },
  browseCardCity: { fontSize: 10, color: '#4E6A88', fontWeight: '500', marginBottom: 6 },
  browseCardMetaRow: { flexDirection: 'row', gap: 5, marginBottom: 5, flexWrap: 'wrap' },
  browseCardPill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: 'rgba(56,189,248,0.08)', borderRadius: 20,
    paddingHorizontal: 6, paddingVertical: 2,
    borderWidth: 1, borderColor: 'rgba(56,189,248,0.16)',
  },
  browseCardPillTxt: { fontSize: 10, fontWeight: '700', color: '#38BDF8' },
  browseCardFuel: { fontSize: 10, fontWeight: '700', color: '#38BDF8' },
  browseCardAmenities: { flexDirection: 'column', gap: 3, marginTop: 'auto' as any },
  browseCardAmenityPill: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  browseCardAmenityItem: { fontSize: 10, color: '#4E6A88', lineHeight: 14 },
  browseCardAmenityTxt: { fontSize: 10, color: '#4E6A88', lineHeight: 14 },
  browseCardTime: { fontSize: 10, fontWeight: '600', color: '#38BDF8', opacity: 0.7, marginTop: 4 },
  // ── Vertical list rows ───────────────────────────────────────────────────────
  browseRow: {
    flexDirection: 'row', alignItems: 'flex-start',
    paddingHorizontal: 18, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: 'rgba(56,189,248,0.07)', gap: 12,
  },
  browseRowPressed: { backgroundColor: 'rgba(56,189,248,0.04)' },
  browseRowTopLine: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  browseRowDistGroup: { alignItems: 'flex-end', gap: 2, paddingTop: 2 },
  browseRowId: { fontSize: 12, fontWeight: '800', color: '#38BDF8', letterSpacing: 0.8 },
  browseRowName: { fontSize: 15, fontWeight: '700', color: '#E8F0FC', marginBottom: 1 },
  browseRowCity: { fontSize: 11, color: '#4E6A88', marginBottom: 5 },
  browseRowDist: { fontSize: 16, fontWeight: '800', color: '#C8D8EE' },
  browseRowDistUnit: { fontSize: 11, fontWeight: '500', color: '#4E6A88' },
  browseRowTime: { fontSize: 11, color: '#38BDF8', fontWeight: '600', opacity: 0.8 },
  browseRowMetaRow: { flexDirection: 'row', gap: 12, marginBottom: 3, flexWrap: 'wrap' },
  browseRowFuel: { fontSize: 11, color: '#38BDF8', fontWeight: '700' },
  browseRowCrewCar: { fontSize: 11, color: '#6B83A0' },
  browseRowPills: { flexDirection: 'row', gap: 6, marginBottom: 5, flexWrap: 'wrap' },
  browseRowPillBlue: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(56,189,248,0.08)', borderRadius: 20,
    paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: 'rgba(56,189,248,0.16)',
  },
  browseRowPillBlueTxt: { fontSize: 11, fontWeight: '700', color: '#38BDF8' },
  browseRowPillGray: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(107,131,160,0.08)', borderRadius: 20,
    paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: 'rgba(107,131,160,0.15)',
  },
  browseRowPillGrayTxt: { fontSize: 11, fontWeight: '600', color: '#6B83A0' },
  browseRowAmenities: { gap: 3 },
  browseRowAmenityItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  browseRowAmenity: { fontSize: 11, color: '#4E6A88', lineHeight: 16 },
  filterPanel: { backgroundColor: 'rgba(13,20,33,0.96)', borderRadius: 16, marginTop: 8, padding: 12, borderWidth: 1, borderColor: '#1E2D45', gap: 12 },
  styleRow: { flexDirection: 'row', gap: 20 },
  styleOption: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  styleRadio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: '#38BDF8', alignItems: 'center', justifyContent: 'center' },
  styleRadioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#38BDF8' },
  styleLabel: { fontSize: 13, color: '#6B83A0', fontWeight: '600' },
  styleLabelActive: { color: '#F0F4FF' },
  vfrRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 4, borderTopWidth: 1, borderTopColor: '#1E2D45' },
  vfrCheck: { width: 18, height: 18, borderRadius: 4, borderWidth: 2, borderColor: '#38BDF8', alignItems: 'center', justifyContent: 'center' },
  vfrCheckActive: { backgroundColor: '#38BDF8' },
  vfrCheckMark: { fontSize: 11, color: '#0D1421', fontWeight: '900' },
  vfrBadge: { marginLeft: 'auto' as any, fontSize: 10, fontWeight: '800', color: '#38BDF8', letterSpacing: 1 },
  locateBtn: { position: 'absolute', right: 16, width: 48, height: 48, borderRadius: 24, backgroundColor: '#0D1421', borderWidth: 1, borderColor: '#1E2D45', alignItems: 'center', justifyContent: 'center', zIndex: 5 },
  searchWrap: { position: 'absolute', top: 60, left: 16, right: 16, zIndex: 10 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  glassBar: { flex: 1, marginHorizontal: 0, height: 52 },
  routeBtn: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#0D1421', borderWidth: 1, borderColor: '#1E2D45', alignItems: 'center', justifyContent: 'center' },
  filterBtn: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#0D1421', borderWidth: 1, borderColor: '#1E2D45', alignItems: 'center', justifyContent: 'center' },
  filterBtnActive: { backgroundColor: '#38BDF8', borderColor: '#38BDF8' },
  filterIcon: { gap: 4, alignItems: 'center' },
  filterLine: { height: 2, backgroundColor: '#8A9BB5', borderRadius: 1 },
  filterLineTop: { width: 18 },
  filterLineMid: { width: 13 },
  filterLineBot: { width: 8 },
  filterBadge: { position: 'absolute', top: 8, right: 8, width: 16, height: 16, borderRadius: 8, backgroundColor: '#FF4D00', alignItems: 'center', justifyContent: 'center' },
  filterBadgeText: { fontSize: 9, fontWeight: '800', color: '#fff' },
  searchBox: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: '#0D1421', borderRadius: 26, paddingHorizontal: 16, height: 52, borderWidth: 1, borderColor: '#1E2D45' },
  searchIcon: { fontSize: 14, marginRight: 10, opacity: 0.7 },
  searchInput: { flex: 1, color: '#F0F4FF', fontSize: 14, fontWeight: '500' },
  searchClear: { color: '#6B83A0', fontSize: 14, paddingLeft: 10 },
  searchResults: { backgroundColor: '#0D1421', borderRadius: 14, marginTop: 6, borderWidth: 1, borderColor: 'rgba(56,189,248,0.16)', overflow: 'hidden' },
  searchEmpty: { backgroundColor: '#0D1421', borderRadius: 14, marginTop: 6, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', paddingHorizontal: 14, paddingVertical: 12 },
  searchEmptyText: { color: '#4E6E8A', fontSize: 13 },
  searchResult: { paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(56,189,248,0.1)' },
  searchResultPressed: { backgroundColor: 'rgba(249,115,22,0.07)' },
  searchResultId: { fontSize: 17, fontWeight: '900', color: '#FF4D00', marginBottom: 2, letterSpacing: 0.5 },
  searchResultName: { fontSize: 13, fontWeight: '500', color: '#C8D8EE' },
});
