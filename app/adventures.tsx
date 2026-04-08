import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { MaterialCommunityIcons, Feather } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import {
  Alert, ActivityIndicator, FlatList, KeyboardAvoidingView, Modal,
  Platform, ScrollView, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native';
import { WebView } from 'react-native-webview';
import airportsData from '../assets/images/airports.json';
import { supabase } from '../lib/supabase';
import { GlassSearchBar } from '../components/GlassSearchBar';

const HOME_ICAO = 'KSUS';
const airports: any[] = airportsData as any[];

// Today's date as YYYY-MM-DD for the date input default
function todayString(): string {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function getDistanceNm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3440.065;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function buildMapHtml(airports: any[], homeIcao: string): string {
  const markers = airports.map(a => ({
    icao: a.icao,
    lat: a.lat,
    lng: a.lng,
    isHome: a.icao === homeIcao,
  }));
  const markersJson = JSON.stringify(markers);

  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body { width:100%; height:100%; background:#0A1628; }
  #map { width:100%; height:100%; }
</style>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
</head>
<body>
<div id="map"></div>
<script>
var map = L.map('map', {
  center: [37.5, -94],
  zoom: 5,
  zoomControl: false,
  attributionControl: false,
});

L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
  maxZoom: 18,
}).addTo(map);

var markers = ${markersJson};
var home = markers.find(function(m){ return m.isHome; });

markers.forEach(function(m) {
  if (!m.isHome && home) {
    L.polyline([[home.lat, home.lng], [m.lat, m.lng]], {
      color: '#1E6BFF',
      weight: 1.5,
      opacity: 0.4,
      dashArray: '4,6',
    }).addTo(map);
  }
});

markers.forEach(function(m) {
  var size = m.isHome ? 16 : 12;
  var color = m.isHome ? '#FFD700' : '#38BDF8';
  var border = m.isHome ? '#FFA500' : '#1E6BFF';

  var icon = L.divIcon({
    className: '',
    html: '<div style="width:' + size + 'px;height:' + size + 'px;border-radius:50%;background:' + color + ';border:2.5px solid ' + border + ';box-shadow:0 0 6px ' + color + '88;"></div>',
    iconSize: [size, size],
    iconAnchor: [size/2, size/2],
  });

  var label = m.isHome ? m.icao + ' (Home)' : m.icao;
  L.marker([m.lat, m.lng], { icon: icon })
    .bindTooltip(label, { permanent: false, direction: 'top', className: 'airport-tooltip' })
    .addTo(map);
});

if (markers.length > 1) {
  var latlngs = markers.map(function(m){ return [m.lat, m.lng]; });
  map.fitBounds(latlngs, { padding: [30, 30] });
}
</script>
</body>
</html>`;
}

// ─── States tile-grid map ────────────────────────────────────────────────────
// Each row/col position approximates the geographic location of the state.
// Visited states are highlighted; all others stay dark.
const STATES_GRID: (string | null)[][] = [
  [null, null, null, null, null, null, null, null, null, null, null, 'ME'],
  ['WA', 'MT', 'ND', 'MN', 'WI', null, 'MI', null, null, 'VT', 'NH', null],
  ['OR', 'ID', 'WY', 'SD', 'IA', 'IL', 'IN', 'OH', 'PA', 'NY', 'CT', 'MA'],
  [null, 'NV', 'CO', 'NE', 'MO', 'KY', 'WV', 'VA', 'MD', 'NJ', 'RI', null],
  ['CA', 'UT', 'KS', null, 'TN', 'NC', null, 'DC', 'DE', null, null, null],
  [null, 'AZ', 'NM', 'OK', 'AR', 'SC', null, null, null, null, null, null],
  [null, null, null, 'TX', 'LA', 'MS', 'AL', 'GA', null, null, null, null],
  [null, null, null, null, null, null, null, null, 'FL', null, null, null],
  ['HI', null, null, null, null, null, null, null, 'AK', null, null, null],
];
const GRID_COLS = 12;
const GRID_ROWS = STATES_GRID.length;

const STATE_NAMES: Record<string, string> = {
  AK: 'Alaska', AL: 'Alabama', AR: 'Arkansas', AZ: 'Arizona', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DC: 'Washington D.C.', DE: 'Delaware', FL: 'Florida',
  GA: 'Georgia', HI: 'Hawaii', IA: 'Iowa', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', MA: 'Massachusetts',
  MD: 'Maryland', ME: 'Maine', MI: 'Michigan', MN: 'Minnesota', MO: 'Missouri',
  MS: 'Mississippi', MT: 'Montana', NC: 'North Carolina', ND: 'North Dakota', NE: 'Nebraska',
  NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NV: 'Nevada', NY: 'New York',
  OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island',
  SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VA: 'Virginia', VT: 'Vermont', WA: 'Washington', WI: 'Wisconsin', WV: 'West Virginia',
  WY: 'Wyoming',
};

// One representative airport per state used to calculate nearest unvisited state.
const STATE_REP_AIRPORTS: Record<string, { icao: string; name: string; lat: number; lng: number }> = {
  AK: { icao: 'PANC', name: 'Ted Stevens Anchorage Intl',        lat: 61.17, lng: -149.99 },
  AL: { icao: 'KBHM', name: 'Birmingham-Shuttlesworth Intl',     lat: 33.56, lng:  -86.75 },
  AR: { icao: 'KLIT', name: 'Bill & Hillary Clinton Natl',        lat: 34.73, lng:  -92.22 },
  AZ: { icao: 'KPHX', name: 'Phoenix Sky Harbor Intl',           lat: 33.43, lng: -112.01 },
  CA: { icao: 'KLAX', name: 'Los Angeles Intl',                  lat: 33.94, lng: -118.41 },
  CO: { icao: 'KDEN', name: 'Denver Intl',                       lat: 39.86, lng: -104.67 },
  CT: { icao: 'KBDL', name: 'Bradley Intl',                      lat: 41.94, lng:  -72.68 },
  DC: { icao: 'KDCA', name: 'Reagan National',                   lat: 38.85, lng:  -77.04 },
  DE: { icao: 'KILG', name: 'Wilmington Airport',                lat: 39.68, lng:  -75.61 },
  FL: { icao: 'KMCO', name: 'Orlando Intl',                      lat: 28.43, lng:  -81.31 },
  GA: { icao: 'KATL', name: 'Hartsfield-Jackson Atlanta Intl',   lat: 33.64, lng:  -84.43 },
  HI: { icao: 'PHNL', name: 'Daniel K. Inouye Intl',            lat: 21.32, lng: -157.92 },
  IA: { icao: 'KDSM', name: 'Des Moines Intl',                   lat: 41.53, lng:  -93.66 },
  ID: { icao: 'KBOI', name: 'Boise Airport',                     lat: 43.56, lng: -116.22 },
  IL: { icao: 'KORD', name: "Chicago O'Hare Intl",               lat: 41.98, lng:  -87.91 },
  IN: { icao: 'KIND', name: 'Indianapolis Intl',                  lat: 39.72, lng:  -86.29 },
  KS: { icao: 'KICT', name: 'Wichita Dwight D. Eisenhower Natl', lat: 37.65, lng:  -97.43 },
  KY: { icao: 'KSDF', name: 'Louisville Intl',                   lat: 38.17, lng:  -85.74 },
  LA: { icao: 'KMSY', name: 'Louis Armstrong New Orleans Intl',  lat: 29.99, lng:  -90.26 },
  MA: { icao: 'KBOS', name: 'Logan Intl',                        lat: 42.36, lng:  -71.01 },
  MD: { icao: 'KBWI', name: 'Baltimore/Washington Intl',         lat: 39.17, lng:  -76.67 },
  ME: { icao: 'KPWM', name: 'Portland Intl Jetport',             lat: 43.65, lng:  -70.31 },
  MI: { icao: 'KDTW', name: 'Detroit Metropolitan',              lat: 42.21, lng:  -83.35 },
  MN: { icao: 'KMSP', name: 'Minneapolis-St. Paul Intl',         lat: 44.88, lng:  -93.22 },
  MO: { icao: 'KSTL', name: 'St. Louis Lambert Intl',            lat: 38.75, lng:  -90.37 },
  MS: { icao: 'KJAN', name: 'Jackson-Medgar Wiley Evers Intl',   lat: 32.31, lng:  -90.08 },
  MT: { icao: 'KBZN', name: 'Bozeman Yellowstone Intl',          lat: 45.78, lng: -111.15 },
  NC: { icao: 'KCLT', name: 'Charlotte Douglas Intl',            lat: 35.21, lng:  -80.94 },
  ND: { icao: 'KBIS', name: 'Bismarck Municipal',                lat: 46.77, lng: -100.75 },
  NE: { icao: 'KOMA', name: 'Eppley Airfield',                   lat: 41.30, lng:  -95.89 },
  NH: { icao: 'KMHT', name: 'Manchester-Boston Regional',        lat: 42.93, lng:  -71.44 },
  NJ: { icao: 'KEWR', name: 'Newark Liberty Intl',               lat: 40.69, lng:  -74.17 },
  NM: { icao: 'KABQ', name: 'Albuquerque Intl Sunport',          lat: 35.04, lng: -106.61 },
  NV: { icao: 'KLAS', name: 'Harry Reid Intl',                   lat: 36.08, lng: -115.15 },
  NY: { icao: 'KJFK', name: 'John F. Kennedy Intl',              lat: 40.64, lng:  -73.78 },
  OH: { icao: 'KCMH', name: 'John Glenn Columbus Intl',          lat: 39.99, lng:  -82.89 },
  OK: { icao: 'KOKC', name: 'Will Rogers World',                 lat: 35.39, lng:  -97.60 },
  OR: { icao: 'KPDX', name: 'Portland Intl',                     lat: 45.59, lng: -122.60 },
  PA: { icao: 'KPHL', name: 'Philadelphia Intl',                 lat: 39.87, lng:  -75.24 },
  RI: { icao: 'KPVD', name: 'T.F. Green Airport',               lat: 41.73, lng:  -71.43 },
  SC: { icao: 'KCAE', name: 'Columbia Metropolitan',             lat: 33.94, lng:  -81.12 },
  SD: { icao: 'KRAP', name: 'Rapid City Regional',               lat: 44.04, lng: -103.06 },
  TN: { icao: 'KBNA', name: 'Nashville Intl',                    lat: 36.12, lng:  -86.68 },
  TX: { icao: 'KDFW', name: 'Dallas/Fort Worth Intl',            lat: 32.90, lng:  -97.04 },
  UT: { icao: 'KSLC', name: 'Salt Lake City Intl',               lat: 40.79, lng: -111.98 },
  VA: { icao: 'KIAD', name: 'Dulles Intl',                       lat: 38.94, lng:  -77.46 },
  VT: { icao: 'KBTV', name: 'Burlington Intl',                   lat: 44.47, lng:  -73.15 },
  WA: { icao: 'KSEA', name: 'Seattle-Tacoma Intl',               lat: 47.45, lng: -122.31 },
  WI: { icao: 'KMKE', name: 'Milwaukee Mitchell Intl',           lat: 42.95, lng:  -87.90 },
  WV: { icao: 'KCRW', name: 'Yeager Airport',                    lat: 38.37, lng:  -81.59 },
  WY: { icao: 'KCYS', name: 'Cheyenne Regional',                 lat: 41.15, lng: -104.81 },
};

function findNextState(
  visitedStates: Set<string>,
  homeLat: number,
  homeLng: number,
): { stateAbbr: string; stateName: string; nm: number; icao: string; airportName: string } | null {
  let best: { stateAbbr: string; stateName: string; nm: number; icao: string; airportName: string } | null = null;
  for (const [abbr, rep] of Object.entries(STATE_REP_AIRPORTS)) {
    if (visitedStates.has(abbr)) continue;
    const nm = Math.round(getDistanceNm(homeLat, homeLng, rep.lat, rep.lng));
    if (!best || nm < best.nm) {
      best = { stateAbbr: abbr, stateName: STATE_NAMES[abbr] ?? abbr, nm, icao: rep.icao, airportName: rep.name };
    }
  }
  return best;
}

function buildStatesGridHtml(visitedList: string[]): string {
  const visited = new Set(visitedList);
  let cells = '';
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) {
      const abbr = STATES_GRID[r][c];
      if (!abbr) { cells += '<div></div>'; continue; }
      const hit = visited.has(abbr);
      const bg     = hit ? '#0E2F55' : '#0A1220';
      const fg     = hit ? '#38BDF8' : '#1A2535';
      const border = hit ? '#2A6EA6' : '#0F1A26';
      cells += `<div class="cell${hit ? ' hit' : ''}" data-state="${abbr}" style="background:${bg};color:${fg};border-color:${border};">${abbr}</div>`;
    }
  }
  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:100%;height:100%;background:#070B14;overflow:hidden}
  .grid{display:grid;grid-template-columns:repeat(${GRID_COLS},1fr);grid-template-rows:repeat(${GRID_ROWS},1fr);gap:2px;width:100%;height:100%;padding:6px}
  .cell{border-radius:4px;border:1px solid transparent;display:flex;align-items:center;justify-content:center;font-family:-apple-system,system-ui,sans-serif;font-size:8px;font-weight:700;letter-spacing:0.3px}
  .cell.hit{box-shadow:0 0 8px #38BDF828;cursor:pointer}
  .cell.hit:active{opacity:0.6}
</style></head><body><div class="grid">${cells}</div>
<script>
document.querySelectorAll('.hit').forEach(function(el){
  el.addEventListener('click',function(){
    if(window.ReactNativeWebView){window.ReactNativeWebView.postMessage(el.getAttribute('data-state'));}
  });
});
</script></body></html>`;
}

// Search airports.json by ICAO prefix or name substring
function searchAirports(query: string): any[] {
  if (query.length < 2) return [];
  const q = query.toUpperCase();
  const results: any[] = [];
  for (const a of airports) {
    const icao = (a.icao || a.faa || a.id || '').toUpperCase();
    const name = (a.name || '').toUpperCase();
    if (icao.startsWith(q) || name.includes(q)) {
      results.push(a);
      if (results.length >= 10) break;
    }
  }
  return results;
}

export default function AdventuresScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [mapAirports, setMapAirports] = useState<any[]>([]);
  const [recentAirports, setRecentAirports] = useState<any[]>([]);
  const [stats, setStats] = useState({ airports: 0, states: 0, longestNm: 0, totalNm: 0 });
  const [mapHtml, setMapHtml] = useState('');
  const [statesMapHtml, setStatesMapHtml] = useState(() => buildStatesGridHtml([]));
  const [allVisited, setAllVisited] = useState<any[]>([]);
  const [selectedState, setSelectedState] = useState<string | null>(null);
  const [nextState, setNextState] = useState<{ stateAbbr: string; stateName: string; nm: number; icao: string; airportName: string } | null>(null);

  // Add Past Flight modal state
  const [showModal, setShowModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  const [flightDate, setFlightDate] = useState(todayString());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    loadAdventures();
  }, [user]);

  async function loadAdventures() {
    if (!user) {
      setNextState(findNextState(new Set(), 38.66, -90.65));
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from('visited_airports')
      .select('*')
      .eq('user_id', user.id)
      .order('visited_at', { ascending: false });

    if (error) { console.error('[Adventures] fetch error:', error.message); setLoading(false); return; }
    if (!data || data.length === 0) {
      setNextState(findNextState(new Set(), 38.66, -90.65));
      setLoading(false);
      return;
    }

    const seen = new Set<string>();
    const unique: any[] = [];
    for (const row of data) {
      if (!seen.has(row.icao)) {
        seen.add(row.icao);
        unique.push(row);
      }
    }

    const hasHome = unique.some(a => a.icao === HOME_ICAO);
    const allMapAirports = hasHome ? unique : [
      { icao: HOME_ICAO, name: 'Spirit of St. Louis', lat: 38.66, lng: -90.65, state: 'MO' },
      ...unique,
    ];

    const recent = data.filter(a => a.icao !== HOME_ICAO).slice(0, 10);

    const visitedIcaos = new Set(data.filter(a => a.icao !== HOME_ICAO).map(a => a.icao));
    const visitedStates = new Set(data.filter(a => a.icao !== HOME_ICAO && a.state).map(a => a.state));
    const home = allMapAirports.find(a => a.icao === HOME_ICAO);
    let longestNm = 0;
    let totalNm = 0;
    const homeLat = home?.lat ?? 38.66;
    const homeLng = home?.lng ?? -90.65;
    // Longest = farthest unique destination. Total = sum of every individual logged flight.
    for (const a of unique) {
      if (a.icao !== HOME_ICAO && a.lat && a.lng) {
        const nm = Math.round(getDistanceNm(homeLat, homeLng, a.lat, a.lng));
        if (nm > longestNm) longestNm = nm;
      }
    }
    for (const r of data) {
      if (r.icao !== HOME_ICAO && r.lat && r.lng) {
        totalNm += Math.round(getDistanceNm(homeLat, homeLng, r.lat, r.lng));
      }
    }

    setAllVisited(data);
    setMapAirports(allMapAirports);
    setRecentAirports(recent);
    setStats({ airports: visitedIcaos.size, states: visitedStates.size, longestNm, totalNm });
    setMapHtml(buildMapHtml(allMapAirports, HOME_ICAO));
    setStatesMapHtml(buildStatesGridHtml(Array.from(visitedStates)));
    setNextState(findNextState(visitedStates, homeLat, homeLng));
    setLoading(false);
  }

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

  // ── Add Past Flight modal logic ──────────────────────────────────────────

  function openModal() {
    setSearchQuery('');
    setSearchResults([]);
    setSelected(null);
    setFlightDate(todayString());
    setSaveError(null);
    setSaveSuccess(false);
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
  }

  function handleSearch(text: string) {
    setSearchQuery(text);
    setSelected(null);
    setSaveError(null);
    setSearchResults(searchAirports(text));
  }

  function selectAirport(a: any) {
    setSelected(a);
    setSearchQuery((a.icao || a.faa || a.id) + ' — ' + a.name);
    setSearchResults([]);
  }

  async function saveFlight() {
    if (!selected) return;
    setSaving(true);
    setSaveError(null);

    // Parse the date; fall back to now if invalid
    let visitedAt: string;
    const parsed = Date.parse(flightDate);
    if (!isNaN(parsed)) {
      visitedAt = new Date(parsed).toISOString();
    } else {
      visitedAt = new Date().toISOString();
    }

    const icao = (selected.icao || selected.faa || selected.id || '').toUpperCase();
    const { error } = await supabase.from('visited_airports').insert({
      user_id: user?.id ?? 'anonymous',
      icao,
      name: selected.name ?? null,
      city: selected.city ?? null,
      state: selected.state ?? null,
      lat: selected.lat ?? null,
      lng: selected.lng ?? null,
      visited_at: visitedAt,
    });

    if (error) {
      console.error('[AddFlight] insert error:', error.message);
      setSaveError('Could not save. Check your connection and try again.');
      setSaving(false);
      return;
    }

    setSaveSuccess(true);
    setSaving(false);
    // Refresh Adventures data behind the modal
    loadAdventures();
    // Auto-close after a beat so user sees the success state
    setTimeout(() => closeModal(), 900);
  }

  // ── Delete a logged flight entry ─────────────────────────────────────────

  function confirmDelete(entry: any) {
    Alert.alert(
      'Remove Flight',
      `Remove logged visit to ${entry.icao}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => removeEntry(entry) },
      ],
    );
  }

  async function removeEntry(entry: any) {
    if (!entry.id) return;
    const { error } = await supabase
      .from('visited_airports')
      .delete()
      .eq('id', entry.id);
    if (error) { console.error('[Adventures] delete error:', error.message); return; }
    loadAdventures(); // refreshes stats, map, and recent list
  }

  // ── Render ───────────────────────────────────────────────────────────────

  const statsRows = [
    { label: 'Airports Visited', value: String(stats.airports) },
    { label: 'States Flown',     value: String(stats.states) },
    { label: 'Longest Flight',   value: stats.longestNm > 0 ? `${stats.longestNm.toLocaleString()} nm` : '—' },
    { label: 'Total Flown',      value: stats.totalNm > 0   ? `${stats.totalNm.toLocaleString()} nm`   : '—' },
  ];

  // Unique airports for the tapped state (most-recent-first, deduped by ICAO)
  const stateAirports: any[] = (() => {
    if (!selectedState) return [];
    const seen = new Set<string>();
    return allVisited.filter(a => {
      if (a.state !== selectedState || a.icao === HOME_ICAO) return false;
      if (seen.has(a.icao)) return false;
      seen.add(a.icao);
      return true;
    });
  })();

  return (
    <>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
            <Text style={styles.backArrow}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>My Adventures</Text>
          <TouchableOpacity onPress={openModal} style={styles.addBtn} activeOpacity={0.7}>
            <Text style={styles.addBtnText}>+ Add</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color="#38BDF8" size="large" />
            <Text style={styles.loadingText}>Loading your flights...</Text>
          </View>
        ) : (
          <>
            {/* Stats card — 2×2 grid */}
            <View style={styles.statsCard}>
              <View style={styles.statsRow}>
                <View style={[styles.statItem, styles.statBorderRight, styles.statBorderBottom]}>
                  <Text style={styles.statValue}>{statsRows[0].value}</Text>
                  <Text style={styles.statLabel}>{statsRows[0].label}</Text>
                </View>
                <View style={[styles.statItem, styles.statBorderBottom]}>
                  <Text style={styles.statValue}>{statsRows[1].value}</Text>
                  <Text style={styles.statLabel}>{statsRows[1].label}</Text>
                </View>
              </View>
              <View style={styles.statsRow}>
                <View style={[styles.statItem, styles.statBorderRight]}>
                  <Text style={styles.statValue}>{statsRows[2].value}</Text>
                  <Text style={styles.statLabel}>{statsRows[2].label}</Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={styles.statValue}>{statsRows[3].value}</Text>
                  <Text style={styles.statLabel}>{statsRows[3].label}</Text>
                </View>
              </View>
            </View>

            {/* States flown tile grid */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>States Flown · {stats.states} / 50</Text>
              <View style={styles.statesMapContainer}>
                <WebView
                  source={{ html: statesMapHtml }}
                  style={styles.statesMap}
                  scrollEnabled={false}
                  javaScriptEnabled
                  originWhitelist={['*']}
                  onMessage={(e) => setSelectedState(e.nativeEvent.data)}
                />
              </View>
            </View>

            {/* Next State to Unlock */}
            <View style={styles.nextStateSection}>
              <Text style={styles.sectionTitle}>Next State to Unlock</Text>
              {nextState === null ? (
                <View style={styles.nextStateCard}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Feather name="award" size={16} color="#34C77B" />
                    <Text style={styles.nextStateAll}>All 50 states unlocked!</Text>
                  </View>
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.nextStateCard}
                  activeOpacity={0.7}
                  onPress={() => {
                    const rep = STATE_REP_AIRPORTS[nextState.stateAbbr];
                    goToAirport({ icao: rep.icao, name: rep.name, city: '', state: nextState.stateAbbr, lat: rep.lat, lng: rep.lng });
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.nextStateName}>{nextState.stateName}</Text>
                    <Text style={styles.nextStateSub}>{nextState.nm.toLocaleString()} nm from {HOME_ICAO}</Text>
                    <Text style={styles.nextStateIcao}>Suggested: {nextState.icao} · {nextState.airportName}</Text>
                  </View>
                  <Text style={styles.nextStateChevron}>›</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Airport dot map */}
            {mapHtml !== '' && (
              <View style={styles.mapContainer}>
                <WebView
                  source={{ html: mapHtml }}
                  style={styles.map}
                  scrollEnabled={false}
                  javaScriptEnabled
                  originWhitelist={['*']}
                />
              </View>
            )}

            {/* Recent airports */}
            {recentAirports.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Recent Airports</Text>
                <View style={styles.listCard}>
                  {recentAirports.map((a, i) => (
                    <View
                      key={`${a.icao}-${a.visited_at}`}
                      style={[styles.listRow, i < recentAirports.length - 1 && styles.listRowBorder]}
                    >
                      {/* Main tap area — opens airport detail */}
                      <TouchableOpacity
                        style={styles.listRowMain}
                        activeOpacity={0.6}
                        onPress={() => goToAirport(a)}
                      >
                        <View style={styles.listIconWrap}>
                          <MaterialCommunityIcons name="airplane" size={16} color="#38BDF8" />
                        </View>
                        <View style={styles.listInfo}>
                          <Text style={styles.listIcao}>{a.icao}</Text>
                          <Text style={styles.listName}>{a.name ?? ''}{a.state ? ` · ${a.state}` : ''}</Text>
                        </View>
                        <Text style={styles.listDate}>
                          {new Date(a.visited_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </Text>
                      </TouchableOpacity>

                      {/* Delete button */}
                      <TouchableOpacity
                        style={styles.listDeleteBtn}
                        onPress={() => confirmDelete(a)}
                        hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
                      >
                        <Feather name="x" size={14} color="#4A5B73" />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {recentAirports.length === 0 && (
              <View style={styles.empty}>
                <MaterialCommunityIcons name="airplane-landing" size={36} color="#6B83A0" style={{ opacity: 0.4, marginBottom: 8 }} />
                <Text style={styles.emptyTitle}>No flights logged yet</Text>
                <Text style={styles.emptyText}>Tap "+ Add" above or use "I've Flown Here" on any airport page</Text>
              </View>
            )}
          </>
        )}
      </ScrollView>

      {/* ── State Detail Modal ────────────────────────────────────────── */}
      <Modal
        visible={selectedState !== null}
        animationType="slide"
        transparent
        statusBarTranslucent
        onRequestClose={() => setSelectedState(null)}
      >
        <View style={styles.modalBackdrop}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setSelectedState(null)} />
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{selectedState ? (STATE_NAMES[selectedState] ?? selectedState) : ''}</Text>
              <TouchableOpacity onPress={() => setSelectedState(null)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                <Feather name="x" size={18} color="#4A5B73" />
              </TouchableOpacity>
            </View>
            {stateAirports.length === 0 ? (
              <Text style={styles.stateModalEmpty}>No airports logged in this state yet.</Text>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false}>
                {stateAirports.map((a, i) => (
                  <TouchableOpacity
                    key={`${a.icao}-${i}`}
                    style={[styles.stateAirportRow, i < stateAirports.length - 1 && styles.stateAirportBorder]}
                    onPress={() => { setSelectedState(null); setTimeout(() => goToAirport(a), 300); }}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.stateAirportIcao}>{a.icao}</Text>
                    <View style={styles.stateAirportInfo}>
                      <Text style={styles.stateAirportName} numberOfLines={1}>{a.name ?? a.icao}</Text>
                      <Text style={styles.stateAirportDate}>
                        {new Date(a.visited_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </Text>
                    </View>
                    <Text style={styles.stateAirportChevron}>›</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* ── Add Past Flight Modal ─────────────────────────────────────── */}
      <Modal
        visible={showModal}
        animationType="slide"
        transparent
        statusBarTranslucent
        onRequestClose={closeModal}
      >
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={closeModal} />

          <View style={styles.modalSheet}>
            {/* Modal header */}
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Past Flight</Text>
              <TouchableOpacity onPress={closeModal} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                <Feather name="x" size={18} color="#4A5B73" />
              </TouchableOpacity>
            </View>

            {saveSuccess ? (
              <View style={styles.successWrap}>
                <Feather name="check-circle" size={22} color="#34C77B" />
                <Text style={styles.successText}>Flight added!</Text>
              </View>
            ) : (
              <>
                {/* Airport search */}
                <Text style={styles.modalLabel}>AIRPORT</Text>
                <GlassSearchBar
                  value={searchQuery}
                  onChangeText={handleSearch}
                  placeholder="Search ICAO or airport name…"
                  style={styles.glassBar}
                />

                {/* Search results */}
                {searchResults.length > 0 && (
                  <FlatList
                    data={searchResults}
                    keyExtractor={(item) => item.id || item.icao || item.faa}
                    style={styles.resultsList}
                    keyboardShouldPersistTaps="handled"
                    renderItem={({ item }) => (
                      <TouchableOpacity
                        style={styles.resultRow}
                        onPress={() => selectAirport(item)}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.resultIcao}>{item.icao || item.faa || item.id}</Text>
                        <View style={styles.resultInfo}>
                          <Text style={styles.resultName} numberOfLines={1}>{item.name}</Text>
                          <Text style={styles.resultLocation}>{item.city}{item.state ? `, ${item.state}` : ''}</Text>
                        </View>
                      </TouchableOpacity>
                    )}
                    ItemSeparatorComponent={() => <View style={styles.resultDivider} />}
                  />
                )}

                {/* Selected airport confirmation */}
                {selected && (
                  <View style={styles.selectedCard}>
                    <Text style={styles.selectedIcao}>{selected.icao || selected.faa || selected.id}</Text>
                    <Text style={styles.selectedName}>{selected.name}</Text>
                    <Text style={styles.selectedLocation}>{selected.city}{selected.state ? `, ${selected.state}` : ''}</Text>
                  </View>
                )}

                {/* Date */}
                <Text style={[styles.modalLabel, { marginTop: 16 }]}>DATE FLOWN (YYYY-MM-DD)</Text>
                <TextInput
                  style={styles.dateInput}
                  value={flightDate}
                  onChangeText={setFlightDate}
                  placeholder="2026-03-14"
                  placeholderTextColor="#4A5B73"
                  keyboardType="numbers-and-punctuation"
                  returnKeyType="done"
                  maxLength={10}
                />

                {/* Error */}
                {saveError && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 }}>
                    <Feather name="alert-triangle" size={13} color="#F59E0B" />
                    <Text style={styles.modalError}>{saveError}</Text>
                  </View>
                )}

                {/* Save button */}
                <TouchableOpacity
                  style={[styles.saveBtn, (!selected || saving) && styles.saveBtnDisabled]}
                  onPress={saveFlight}
                  disabled={!selected || saving}
                  activeOpacity={0.8}
                >
                  {saving
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={styles.saveBtnText}>Save Flight</Text>
                  }
                </TouchableOpacity>
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#060B16' },
  content: { paddingBottom: 60 },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 60,
    paddingBottom: 16,
    paddingHorizontal: 16,
  },
  backBtn: { width: 44, alignItems: 'center' },
  backArrow: { fontSize: 34, color: '#38BDF8', lineHeight: 38, fontWeight: '300' },
  headerTitle: { fontSize: 20, fontWeight: '700', color: '#F0F4FF' },
  addBtn: {
    width: 64, alignItems: 'flex-end',
    backgroundColor: '#0D1E35', borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: 1, borderColor: '#1E3A5F',
  },
  addBtnText: { fontSize: 13, fontWeight: '700', color: '#38BDF8' },

  // Stats / map / list (unchanged)
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80, gap: 16 },
  loadingText: { color: '#4A5B73', fontSize: 14 },
  statsCard: {
    backgroundColor: '#0A1628',
    borderRadius: 18, borderWidth: 1, borderColor: '#1E3A5F',
    marginHorizontal: 16, marginBottom: 16, overflow: 'hidden',
  },
  statsRow: { flexDirection: 'row' },
  statItem: { flex: 1, alignItems: 'center', paddingVertical: 18 },
  statBorderRight: { borderRightWidth: 1, borderRightColor: '#1E3A5F' },
  statBorderBottom: { borderBottomWidth: 1, borderBottomColor: '#1E3A5F' },
  statValue: { fontSize: 20, fontWeight: '700', color: '#38BDF8', marginBottom: 4 },
  statLabel: { fontSize: 10, color: '#4A5B73', textAlign: 'center', fontWeight: '600', letterSpacing: 0.3 },
  statesMapContainer: {
    height: 220, borderRadius: 18, overflow: 'hidden',
    borderWidth: 1, borderColor: '#1E3A5F',
  },
  statesMap: { flex: 1, backgroundColor: '#060B16' },
  mapContainer: {
    height: 260, marginHorizontal: 16, marginBottom: 20,
    borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: '#1E3A5F',
  },
  map: { flex: 1, backgroundColor: '#0A1628' },
  section: { marginHorizontal: 16 },
  sectionTitle: {
    fontSize: 11, fontWeight: '700', color: '#4A5B73',
    letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 12,
  },
  listCard: {
    backgroundColor: '#0A1628', borderRadius: 18,
    borderWidth: 1, borderColor: '#1E3A5F', overflow: 'hidden',
  },
  listRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 14, paddingHorizontal: 16, gap: 10,
  },
  listRowBorder: { borderBottomWidth: 1, borderBottomColor: '#1E3A5F' },
  listRowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  listIconWrap: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: '#0D1E35', alignItems: 'center', justifyContent: 'center',
  },
  listIcon: { fontSize: 16 },
  listInfo: { flex: 1 },
  listIcao: { fontSize: 15, fontWeight: '700', color: '#F0F4FF', marginBottom: 2 },
  listName: { fontSize: 12, color: '#4A5B73' },
  listDate: { fontSize: 12, color: '#4A5B73', fontWeight: '500' },
  listDeleteBtn: { paddingLeft: 6, paddingVertical: 4 },
  listDeleteIcon: { fontSize: 14, color: '#4A5B73', fontWeight: '700' },
  empty: { alignItems: 'center', justifyContent: 'center', paddingTop: 60, paddingHorizontal: 40, gap: 12 },
  emptyIcon: { fontSize: 48, marginBottom: 8 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: '#F0F4FF', textAlign: 'center' },
  emptyText: { fontSize: 14, color: '#4A5B73', textAlign: 'center', lineHeight: 22 },

  // Next State to Unlock
  nextStateSection: { marginHorizontal: 16, marginTop: 20, marginBottom: 20 },
  nextStateCard: {
    backgroundColor: '#0A1628', borderRadius: 16,
    borderWidth: 1, borderColor: '#1E3A5F',
    padding: 16, flexDirection: 'row', alignItems: 'center',
  },
  nextStateName: { fontSize: 17, fontWeight: '700', color: '#F0F4FF', marginBottom: 4 },
  nextStateSub:  { fontSize: 12, color: '#4A5B73', marginBottom: 3 },
  nextStateIcao: { fontSize: 12, color: '#38BDF8', fontWeight: '600' },
  nextStateAll:     { fontSize: 14, color: '#34C77B', fontWeight: '600' },
  nextStateChevron: { fontSize: 22, color: '#4A5B73', fontWeight: '300', lineHeight: 24, marginLeft: 12 },

  // State detail modal rows
  stateModalEmpty: { fontSize: 14, color: '#4A5B73', fontStyle: 'italic', paddingVertical: 20, textAlign: 'center' },
  stateAirportRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, gap: 12 },
  stateAirportBorder: { borderBottomWidth: 1, borderBottomColor: '#1E3A5F' },
  stateAirportIcao: { fontSize: 13, fontWeight: '700', color: '#38BDF8', letterSpacing: 0.5, width: 48 },
  stateAirportInfo: { flex: 1 },
  stateAirportName: { fontSize: 14, fontWeight: '600', color: '#E0E8F5', marginBottom: 2 },
  stateAirportDate: { fontSize: 11, color: '#4A5B73' },
  stateAirportChevron: { fontSize: 20, color: '#4A5B73', fontWeight: '300', lineHeight: 22 },

  // Modal
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
  modalSheet: {
    backgroundColor: '#0A1628',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingTop: 20, paddingBottom: 40,
    borderTopWidth: 1, borderColor: '#1E3A5F',
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 20,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#F0F4FF' },
  modalClose: { fontSize: 18, color: '#4A5B73', fontWeight: '600' },
  modalLabel: {
    fontSize: 10, fontWeight: '700', color: '#4A5B73',
    letterSpacing: 1.5, marginBottom: 8,
  },
  glassBar: { marginHorizontal: 0, marginBottom: 12 },

  // Search
  searchInput: {
    backgroundColor: '#0D1421', borderRadius: 12,
    borderWidth: 1, borderColor: '#1E2D45',
    paddingHorizontal: 14, paddingVertical: 13,
    fontSize: 15, color: '#F0F4FF',
    marginBottom: 4,
  },
  resultsList: { maxHeight: 220, marginBottom: 4 },
  resultRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 11, paddingHorizontal: 14,
    backgroundColor: '#0D1421', gap: 12,
  },
  resultIcao: { fontSize: 13, fontWeight: '700', color: '#38BDF8', width: 52 },
  resultInfo: { flex: 1 },
  resultName: { fontSize: 14, fontWeight: '600', color: '#F0F4FF' },
  resultLocation: { fontSize: 12, color: '#4A5B73', marginTop: 1 },
  resultDivider: { height: 1, backgroundColor: '#1E2D45' },

  // Selected airport
  selectedCard: {
    backgroundColor: '#071510', borderRadius: 12,
    borderWidth: 1, borderColor: '#1E5C35',
    padding: 14, marginTop: 8,
  },
  selectedIcao: { fontSize: 12, fontWeight: '700', color: '#34C77B', letterSpacing: 1, marginBottom: 3 },
  selectedName: { fontSize: 15, fontWeight: '700', color: '#F0F4FF', marginBottom: 2 },
  selectedLocation: { fontSize: 13, color: '#4A7A5B' },

  // Date
  dateInput: {
    backgroundColor: '#0D1421', borderRadius: 12,
    borderWidth: 1, borderColor: '#1E2D45',
    paddingHorizontal: 14, paddingVertical: 13,
    fontSize: 15, color: '#F0F4FF',
  },

  // Error / Save
  modalError: { fontSize: 13, color: '#F87171', marginTop: 12, lineHeight: 18 },
  saveBtn: {
    backgroundColor: '#38BDF8', borderRadius: 14,
    paddingVertical: 16, alignItems: 'center', marginTop: 20,
  },
  saveBtnDisabled: { opacity: 0.4 },
  saveBtnText: { fontSize: 16, fontWeight: '800', color: '#fff' },

  // Success
  successWrap: { alignItems: 'center', paddingVertical: 40, gap: 12 },
  successIcon: { fontSize: 48 },
  successText: { fontSize: 20, fontWeight: '700', color: '#34C77B' },
});
