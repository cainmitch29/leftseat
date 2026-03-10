import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { WebView } from 'react-native-webview';
import airportsData from '../../assets/images/airports.json';

const airports: any[] = airportsData;

const FILTERS = [
  { id: 'fuel', label: '⛽ Fuel' },
  { id: 'tower', label: '🗼 Tower' },
  { id: 'restaurant', label: '🍽 Food' },
  { id: 'hotel', label: '🏨 Hotel' },
  { id: 'golf', label: '⛳ Golf' },
  { id: 'attraction', label: '🎯 Fun' },
  { id: 'courtesy_car', label: '🚗 Car' },
];

export default function MapScreen() {
  const [location, setLocation] = useState<any>(null);
  const [activeFilters, setActiveFilters] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [sectionalOn, setSectionalOn] = useState(false);
  const router = useRouter();

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

  function getFilteredAirports() {
    let filtered = airports;
    if (activeFilters.includes('fuel')) filtered = filtered.filter(a => a.fuel);
    if (activeFilters.includes('tower')) filtered = filtered.filter(a => a.has_tower === 'ATCT');
    return filtered;
  }

  function toggleFilter(id: string) {
    setActiveFilters(prev =>
      prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id]
    );
  }

  function buildMapHTML() {
    const filtered = getFilteredAirports();
    const lat = location?.latitude || 38.7;
    const lng = location?.longitude || -90.6;

    const airportMarkers = filtered.slice(0, 300).map(a => `
      L.circleMarker([${a.lat}, ${a.lng}], {
        radius: 6,
        fillColor: '#e8440a',
        color: '#fff',
        weight: 1.5,
        opacity: 1,
        fillOpacity: 0.9
      }).addTo(map).bindPopup(\`
        <div style="font-family:sans-serif;min-width:160px">
          <div style="color:#e8440a;font-weight:700;font-size:13px">${a.icao || a.id}</div>
          <div style="font-weight:700;font-size:14px;margin:2px 0">${a.name}</div>
          <div style="color:#666;font-size:12px">${a.city}, ${a.state}</div>
          ${a.fuel ? `<div style="font-size:11px;margin-top:4px">⛽ ${a.fuel}</div>` : ''}
          ${a.elevation ? `<div style="font-size:11px">📏 ${a.elevation} ft</div>` : ''}
          <button onclick="window.ReactNativeWebView.postMessage('${a.icao || a.id}')"
            style="margin-top:8px;background:#e8440a;color:white;border:none;padding:6px 12px;border-radius:6px;font-weight:700;width:100%;cursor:pointer">
            View Airport →
          </button>
        </div>
      \`);
    `).join('\n');

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
        <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
        <style>
          body { margin: 0; padding: 0; }
          #map { width: 100vw; height: 100vh; }
          .leaflet-popup-content-wrapper { border-radius: 10px; }
          #sectionalBtn {
            position: fixed; top: 50px; right: 10px; z-index: 1000;
            background: #0D1421; color: #38BDF8; border: 2px solid #38BDF8;
            padding: 8px 14px; border-radius: 8px; font-weight: 700;
            font-size: 13px; cursor: pointer;
          }
          #sectionalBtn.active { background: #38BDF8; color: #0D1421; }
        </style>
      </head>
      <body>
        <div id="map"></div>
        <button id="sectionalBtn" onclick="toggleSectional()">✈️ Sectional</button>
        <script>
          var map = L.map('map').setView([${lat}, ${lng}], 7);

var baseLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap',
            maxZoom: 19
          }).addTo(map);

          var sectionalLayer = L.tileLayer(
            'https://t.skyvector.com/tiles/301/{z}/{x}/{y}.jpg',
            { opacity: 0.85, attribution: '© SkyVector', maxZoom: 11 }
          );

          var sectionalOn = false;
          function toggleSectional() {
            sectionalOn = !sectionalOn;
            var btn = document.getElementById('sectionalBtn');
            if (sectionalOn) {
              map.addLayer(sectionalLayer);
              btn.classList.add('active');
            } else {
              map.removeLayer(sectionalLayer);
              btn.classList.remove('active');
            }
          }

          // User location
          L.circleMarker([${lat}, ${lng}], {
            radius: 10, fillColor: '#3b82f6', color: '#fff',
            weight: 2, opacity: 1, fillOpacity: 1
          }).addTo(map).bindPopup('📍 You are here');

          ${airportMarkers}
        </script>
      </body>
      </html>
    `;
  }

  function handleMessage(event: any) {
    const icaoId = event.nativeEvent.data;
    const airport = airports.find(a => (a.icao || a.id) === icaoId);
    if (airport) {
      router.push({
        pathname: '/airport',
        params: {
          icao: airport.icao || airport.id,
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
      <WebView
        style={styles.map}
        source={{ html: buildMapHTML() }}
        onMessage={handleMessage}
        javaScriptEnabled
        key={activeFilters.join(',') + sectionalOn}
      />

      {/* Filter Bar */}
      <View style={styles.filterContainer}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
          {FILTERS.map(f => (
            <TouchableOpacity
              key={f.id}
              style={[styles.filterChip, activeFilters.includes(f.id) && styles.filterChipActive]}
              onPress={() => toggleFilter(f.id)}
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
  map: { flex: 1 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, backgroundColor: '#070B14' },
  loadingText: { color: '#4A5B73', fontSize: 14 },
  filterContainer: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: '#070B14', borderTopWidth: 1, borderTopColor: '#1E2D45',
    paddingBottom: 30, paddingTop: 12,
  },
  filterScroll: { paddingHorizontal: 16, gap: 8 },
  filterChip: {
    backgroundColor: '#0D1421', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8,
    borderWidth: 1, borderColor: '#1E2D45',
  },
  filterChipActive: { backgroundColor: '#38BDF8', borderColor: '#38BDF8' },
  filterText: { fontSize: 13, color: '#4A5B73', fontWeight: '600' },
  filterTextActive: { color: '#0D1421' },
});
