import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import MapView, { Circle, Marker, PROVIDER_DEFAULT, UrlTile } from 'react-native-maps';
import airportsData from '../../assets/images/airports.json';

// Pre-filter at module load: drop airports with no ICAO code (reduces 4748 → ~2355).
// This runs once, not on every render.
const airports: any[] = (airportsData as any[]).filter(
  a => a.icao && a.icao.length === 4 && a.lat != null && a.lng != null
);

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
const MAX_MARKERS = 50;           // strict cap — 50 simple markers at a time
const DEBOUNCE_MS = 300;          // wait for gesture to settle
const EMERGENCY_RADIUS_NM = 100;  // fallback radius when zoomed way out
const INITIAL_DELTA = 8;
const SECTIONAL_URL = 'https://tiles.arcgis.com/tiles/ssFJjBXIUyZDrSYZ/arcgis/rest/services/VFR_Sectional/MapServer/tile/{z}/{y}/{x}';

type MapBounds = {
  centerLat: number;
  centerLng: number;
  neLat: number;
  neLng: number;
  swLat: number;
  swLng: number;
};

function getDistanceNm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 3440.065;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function boundsFromRegion(lat: number, lng: number, latDelta: number, lngDelta: number): MapBounds {
  return {
    centerLat: lat,
    centerLng: lng,
    neLat: lat + latDelta / 2,
    neLng: lng + lngDelta / 2,
    swLat: lat - latDelta / 2,
    swLng: lng - lngDelta / 2,
  };
}

export default function MapScreen() {
  const [location, setLocation] = useState<any>(null);
  const [activeFilters, setActiveFilters] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [radiusNm, setRadiusNm] = useState(0);
  const [showRadiusPanel, setShowRadiusPanel] = useState(false);
  const [showSectional, setShowSectional] = useState(false);
  const [mapBounds, setMapBounds] = useState<MapBounds | null>(null);
  // Selected airport for the bottom info panel — replaces per-marker Callout
  const [selectedAirport, setSelectedAirport] = useState<any>(null);

  const mapRef = useRef<any>(null);
  const regionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();

  // All airports matching active filters. Only runs haversine when radius is set.
  const filtered = useMemo(() => {
    let result = airports;
    if (activeFilters.includes('fuel')) result = result.filter(a => a.fuel);
    if (activeFilters.includes('tower')) result = result.filter(a => a.has_tower === 'ATCT');
    if (radiusNm > 0 && location) {
      result = result.filter(a => getDistanceNm(location.latitude, location.longitude, a.lat, a.lng) <= radiusNm);
    }
    return result;
  }, [activeFilters, radiusNm, location]);

  // Viewport-culled, capped list. Only recalculates after the debounced region update.
  const visibleMarkers = useMemo(() => {
    if (!mapBounds) return [];

    const { centerLat, centerLng, neLat, neLng, swLat, swLng } = mapBounds;
    const latBuf = (neLat - swLat) * 0.05;
    const lngBuf = (neLng - swLng) * 0.05;

    const inViewport = filtered.filter(a =>
      a.lat >= swLat - latBuf &&
      a.lat <= neLat + latBuf &&
      a.lng >= swLng - lngBuf &&
      a.lng <= neLng + lngBuf
    );

    // Emergency: zoomed way out → use haversine radius instead of the giant viewport
    let candidates = inViewport;
    if (inViewport.length > MAX_MARKERS * 4) {
      candidates = filtered.filter(
        a => getDistanceNm(centerLat, centerLng, a.lat, a.lng) <= EMERGENCY_RADIUS_NM
      );
      console.log('[Map] EMERGENCY fallback — radius', EMERGENCY_RADIUS_NM, 'nm, candidates:', candidates.length);
    }

    // Sort by Manhattan distance from center, keep nearest MAX_MARKERS
    const result = candidates
      .map(a => ({ ...a, _d: Math.abs(a.lat - centerLat) + Math.abs(a.lng - centerLng) }))
      .sort((a: any, b: any) => a._d - b._d)
      .slice(0, MAX_MARKERS);

    console.log(
      '[Map] dataset:', airports.length,
      '| viewport:', inViewport.length,
      '| rendering:', result.length,
      '| clustering: DISABLED'
    );

    return result;
  }, [filtered, mapBounds]);

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

  // Seed initial viewport from location on first load
  useEffect(() => {
    if (location && !mapBounds) {
      setMapBounds(boundsFromRegion(location.latitude, location.longitude, INITIAL_DELTA, INITIAL_DELTA));
    }
  }, [location]);

  // Debounced so we don't recompute markers on every scroll frame
  const handleRegionChangeComplete = useCallback((region: any) => {
    console.log('[Map] region update — lat:', region.latitude.toFixed(2), 'delta:', region.latitudeDelta.toFixed(3));
    if (regionTimerRef.current) clearTimeout(regionTimerRef.current);
    regionTimerRef.current = setTimeout(() => {
      setMapBounds(boundsFromRegion(region.latitude, region.longitude, region.latitudeDelta, region.longitudeDelta));
    }, DEBOUNCE_MS);
  }, []);

  function toggleFilter(id: string) {
    setActiveFilters(prev => prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id]);
    setSelectedAirport(null);
  }

  function selectRadius(nm: number) {
    setRadiusNm(nm);
    setSelectedAirport(null);
    if (nm > 0 && location && mapRef.current) {
      const delta = (nm / 60) * 2.5;
      mapRef.current.animateToRegion({ latitude: location.latitude, longitude: location.longitude, latitudeDelta: delta, longitudeDelta: delta }, 600);
    }
  }

  function goToAirport(airport: any) {
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

  function centerOnUser() {
    setSelectedAirport(null);
    if (location && mapRef.current) {
      const delta = radiusNm > 0 ? (radiusNm / 60) * 2.5 : 5;
      mapRef.current.animateToRegion({ latitude: location.latitude, longitude: location.longitude, latitudeDelta: delta, longitudeDelta: delta }, 500);
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
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={PROVIDER_DEFAULT}
        initialRegion={{
          latitude: location?.latitude || 38.7,
          longitude: location?.longitude || -90.6,
          latitudeDelta: INITIAL_DELTA,
          longitudeDelta: INITIAL_DELTA,
        }}
        mapType={showSectional ? 'satellite' : 'standard'}
        showsUserLocation
        showsCompass
        showsScale
        moveOnMarkerPress={false}
        onPress={() => setSelectedAirport(null)}
        onRegionChangeComplete={handleRegionChangeComplete}
      >
        {showSectional && (
          <UrlTile
            urlTemplate={SECTIONAL_URL}
            maximumZ={11}
            minimumZ={4}
            tileSize={256}
            opacity={0.85}
            shouldReplaceMapContent={false}
            flipY={false}
          />
        )}

        {radiusNm > 0 && location && (
          <Circle
            center={{ latitude: location.latitude, longitude: location.longitude }}
            radius={radiusNm * NM_TO_METERS}
            fillColor="rgba(56, 189, 248, 0.08)"
            strokeColor="rgba(56, 189, 248, 0.6)"
            strokeWidth={2}
          />
        )}

        {visibleMarkers.map((airport) => (
          <Marker
            key={airport.icao || airport.id}
            coordinate={{ latitude: airport.lat, longitude: airport.lng }}
            tracksViewChanges={false}
            onPress={() => setSelectedAirport(airport)}
          />
        ))}
      </MapView>

      {/* Airport info panel — appears when a marker is tapped, replaces per-marker Callout */}
      {selectedAirport && (
        <View style={styles.infoPanel}>
          <View style={styles.infoPanelRow}>
            <View style={styles.infoPanelLeft}>
              <Text style={styles.infoPanelIcao}>{selectedAirport.icao || selectedAirport.id}</Text>
              <Text style={styles.infoPanelName}>{selectedAirport.name}</Text>
              <Text style={styles.infoPanelCity}>{selectedAirport.city}, {selectedAirport.state}</Text>
              <View style={styles.infoPanelMeta}>
                {selectedAirport.fuel && <Text style={styles.infoPanelTag}>⛽ {selectedAirport.fuel}</Text>}
                {selectedAirport.elevation && <Text style={styles.infoPanelTag}>📏 {selectedAirport.elevation} ft</Text>}
                {radiusNm > 0 && location && (
                  <Text style={styles.infoPanelTag}>
                    📍 {Math.round(getDistanceNm(location.latitude, location.longitude, selectedAirport.lat, selectedAirport.lng))} nm
                  </Text>
                )}
              </View>
            </View>
            <TouchableOpacity style={styles.infoPanelBtn} onPress={() => goToAirport(selectedAirport)}>
              <Text style={styles.infoPanelBtnText}>View →</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <View style={styles.topButtons}>
        <TouchableOpacity style={styles.iconBtn} onPress={centerOnUser}>
          <Text style={styles.iconBtnText}>📍</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.iconBtn, showRadiusPanel && styles.iconBtnActive]}
          onPress={() => { setShowRadiusPanel(v => !v); setShowSectional(false); }}
        >
          <Text style={[styles.iconBtnText, showRadiusPanel && styles.iconBtnTextActive]}>
            {radiusNm > 0 ? `${radiusNm}nm` : '🔵'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.iconBtn, showSectional && styles.sectionalBtnActive]}
          onPress={() => { setShowSectional(v => !v); setShowRadiusPanel(false); }}
        >
          <Text style={styles.sectionalBtnText}>{showSectional ? '🗺 ON' : '🗺'}</Text>
        </TouchableOpacity>
      </View>

      {showSectional && (
        <View style={styles.sectionalBadge}>
          <Text style={styles.sectionalBadgeText}>VFR Sectional</Text>
        </View>
      )}

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
  // Info panel (replaces per-marker Callout)
  infoPanel: { position: 'absolute', bottom: 90, left: 16, right: 16, backgroundColor: '#0D1421', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#1E2D45' },
  infoPanelRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  infoPanelLeft: { flex: 1 },
  infoPanelIcao: { fontSize: 13, fontWeight: '700', color: '#38BDF8', marginBottom: 2 },
  infoPanelName: { fontSize: 15, fontWeight: '700', color: '#F0F4FF', marginBottom: 2 },
  infoPanelCity: { fontSize: 12, color: '#4A5B73', marginBottom: 6 },
  infoPanelMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  infoPanelTag: { fontSize: 11, color: '#8A9BB5' },
  infoPanelBtn: { backgroundColor: '#38BDF8', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  infoPanelBtnText: { color: '#0D1421', fontSize: 13, fontWeight: '700' },
  // Top controls
  topButtons: { position: 'absolute', top: 60, right: 16, gap: 10 },
  iconBtn: { backgroundColor: '#0D1421', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#1E2D45', minWidth: 48, alignItems: 'center' },
  iconBtnActive: { backgroundColor: '#38BDF8', borderColor: '#38BDF8' },
  iconBtnText: { fontSize: 20, color: '#F0F4FF' },
  iconBtnTextActive: { color: '#0D1421', fontSize: 13, fontWeight: '700' },
  sectionalBtnActive: { backgroundColor: '#22C55E', borderColor: '#22C55E' },
  sectionalBtnText: { fontSize: 16, color: '#F0F4FF', fontWeight: '700' },
  sectionalBadge: { position: 'absolute', top: 60, left: 16, backgroundColor: 'rgba(13,20,33,0.9)', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: '#22C55E' },
  sectionalBadgeText: { fontSize: 11, color: '#22C55E', fontWeight: '700' },
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
