import airportsData from '@/assets/images/airports.json';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { GOOGLE_KEY } from '@/utils/config';
import {
  ActivityIndicator, Alert, Modal, ScrollView,
  StyleSheet, Text, TouchableOpacity, View
} from 'react-native';

const airports: any[] = airportsData as any[];

// Generic chain/low-interest names to filter out of highlights
const GENERIC_NAMES = [
  'mcdonald', 'subway', 'burger king', "wendy's", 'taco bell', 'pizza hut',
  'domino', 'kfc', 'walmart', 'target', 'walgreens', 'cvs', 'dollar tree',
  'dollar general', 'speedway', 'circle k', "casey's", 'kwik trip', 'loves',
  'flying j', 'pilot travel', 'holiday inn express', 'best western',
  'comfort inn', 'super 8', 'days inn', 'motel 6', 'quality inn',
];

const FUEL_LABELS: Record<string, string> = { A: 'Jet A', 'A+': 'Jet A+', B: 'Jet B' };
function formatFuel(fuel: string): string {
  return fuel.split(',').map(f => FUEL_LABELS[f.trim()] ?? f.trim()).join(' / ');
}

function isGenericPlace(name: string): boolean {
  const lower = name.toLowerCase();
  return GENERIC_NAMES.some(g => lower.includes(g));
}

function scorePlaceQuality(place: any): number {
  const rating = place.rating || 0;
  const reviews = place.user_ratings_total || 0;
  if (reviews < 15) return 0;
  return rating * Math.log(reviews + 1);
}

// Score an airport's baseline destination value (runway length + services)
function scoreAirportQuality(a: any): number {
  let score = 0;
  const rl = a.runways?.length
    ? Math.max(...a.runways.map((r: any) => r.length || 0))
    : 0;
  if (rl >= 5000) score += 20;
  else if (rl >= 3500) score += 10;
  else if (rl >= 2500) score += 5;
  if (a.has_tower === 'ATCT') score += 15;
  if (a.city) score += 5; // has a city tag = likely a proper town nearby
  return score;
}

const HOUR_OPTIONS = [
  { label: '30 min', hours: 0.5 },
  { label: '1 hr', hours: 1 },
  { label: '1.5 hrs', hours: 1.5 },
  { label: '2 hrs', hours: 2 },
  { label: '2.5 hrs', hours: 2.5 },
  { label: '3 hrs', hours: 3 },
];

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

const SCENIC_KEYWORDS = ['lake', 'river', 'mountain', 'state park', 'national', 'falls', 'canyon', 'trail', 'forest', 'scenic', 'overlook', 'ridge', 'valley', 'gorge', 'reservoir', 'bay', 'coast', 'beach', 'island'];
const SCENIC_TYPES = ['natural_feature', 'park', 'campground', 'rv_park'];

function isScenic(place: any): boolean {
  const lower = place.name.toLowerCase();
  return SCENIC_KEYWORDS.some(k => lower.includes(k)) ||
    (place.types || []).some((t: string) => SCENIC_TYPES.includes(t));
}

async function fetchDestinationSummary(airport: any, lat: number, lng: number): Promise<string[]> {
  const base = `https://maps.googleapis.com/maps/api/place/nearbysearch/json`;
  const radius = 12000; // ~7.5 miles from the field
  try {
    const [restRes, golfRes, attrRes, lodgeRes, brewRes] = await Promise.all([
      fetch(`${base}?location=${lat},${lng}&radius=${radius}&type=restaurant&key=${GOOGLE_KEY}`),
      fetch(`${base}?location=${lat},${lng}&radius=${radius}&keyword=golf+course&key=${GOOGLE_KEY}`),
      fetch(`${base}?location=${lat},${lng}&radius=${radius}&type=tourist_attraction&key=${GOOGLE_KEY}`),
      fetch(`${base}?location=${lat},${lng}&radius=${radius}&type=lodging&key=${GOOGLE_KEY}`),
      fetch(`${base}?location=${lat},${lng}&radius=${radius}&keyword=brewery+winery&key=${GOOGLE_KEY}`),
    ]);
    const [restData, golfData, attrData, lodgeData, brewData] = await Promise.all([
      restRes.json(), golfRes.json(), attrRes.json(), lodgeRes.json(), brewRes.json(),
    ]);

    function bestPlace(results: any[]): any | null {
      return (results || [])
        .filter(p => !isGenericPlace(p.name) && (p.rating || 0) >= 4.0)
        .sort((a, b) => scorePlaceQuality(b) - scorePlaceQuality(a))[0] ?? null;
    }

    const bestGolf  = bestPlace(golfData.results);
    const bestBrew  = bestPlace(brewData.results);
    const bestAttr  = bestPlace(attrData.results);
    const bestRest  = bestPlace(restData.results);
    const bestLodge = bestPlace(lodgeData.results);

    const bullets: string[] = [];

    if (bestGolf && bullets.length < 2)
      bullets.push(`⛳ Fly-out golf — ${bestGolf.name} is a short drive from the ramp`);

    if (bestBrew && bullets.length < 2)
      bullets.push(`🍺 ${bestBrew.name} — local craft stop worth the flight`);

    if (bestAttr && bullets.length < 2) {
      if (isScenic(bestAttr))
        bullets.push(`🏔 Scenic area — ${bestAttr.name} is close to the field`);
      else
        bullets.push(`🎯 ${bestAttr.name} — popular local destination, easy from the ramp`);
    }

    if (bestRest && bullets.length < 2) {
      const wellReviewed = (bestRest.user_ratings_total || 0) > 400;
      bullets.push(`🍽 ${bestRest.name} — ${wellReviewed ? 'well-reviewed fly-in lunch spot' : 'solid dining a short drive away'}`);
    }

    if (bestLodge && bullets.length < 2)
      bullets.push(`🏨 Overnighter-friendly — ${bestLodge.name} is close to the field`);

    // Elevation context — mention if notably high
    const elev = Number(airport.elevation);
    if (bullets.length < 2 && elev >= 4000)
      bullets.push(`📍 High-elevation field at ${elev.toLocaleString()} ft — mountain flying territory`);

    // Fallbacks that still read like a pilot recommendation
    if (bullets.length === 0) {
      const anyRest = (restData.results || []).find((p: any) => !isGenericPlace(p.name));
      if (anyRest)
        bullets.push(`🍽 ${anyRest.name} — grab a meal close to the field`);
      else
        bullets.push('✈️ Solid fuel stop — straightforward pattern, fuel on field');
    }
    if (bullets.length === 1) {
      const hasLodging = (lodgeData.results || []).length > 0;
      bullets.push(hasLodging
        ? '🛏 Overnight options available — works as a cross-country waypoint'
        : '✈️ Good cross-country stop — fuel on field, easy in and out');
    }

    return bullets.slice(0, 2);
  } catch {
    return ['✈️ Fuel available on field', '✈️ Good cross-country stop'];
  }
}

export default function SurpriseMe() {
  const [visible, setVisible] = useState(false);
  const [selectedHours, setSelectedHours] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [cruiseSpeed, setCruiseSpeed] = useState(150);
  const router = useRouter();

  useEffect(() => {
    AsyncStorage.getItem('userProfile').then((data) => {
      if (data) {
        const profile = JSON.parse(data);
        if (profile.cruise_speed) setCruiseSpeed(profile.cruise_speed);
      }
    });
  }, []);

  async function findSurprise() {
    if (!selectedHours) { Alert.alert('Pick a flight time first!'); return; }
    setLoading(true);
    setResult(null);

    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      let userLat = 38.7491, userLng = -90.5756;
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({});
        userLat = loc.coords.latitude;
        userLng = loc.coords.longitude;
      }

      const maxNm = selectedHours * cruiseSpeed;
      const minNm = maxNm * 0.4;

      const candidates = airports.filter(a => {
        const d = getDistanceNm(userLat, userLng, a.lat, a.lng);
        return d >= minNm && d <= maxNm && a.fuel && a.lat && a.lng;
      });

      if (candidates.length === 0) {
        Alert.alert('No airports found', 'Try a different time range.');
        setLoading(false);
        return;
      }

      // Prefer higher-quality airports (longer runway, towered, city nearby)
      const scored = candidates
        .map(a => ({ ...a, _quality: scoreAirportQuality(a) }))
        .sort((a: any, b: any) => b._quality - a._quality);
      const poolSize = Math.max(8, Math.floor(scored.length * 0.35));
      const pool = scored.slice(0, poolSize);
      const airport = pool[Math.floor(Math.random() * pool.length)];

      const distNm = Math.round(getDistanceNm(userLat, userLng, airport.lat, airport.lng));
      const distMiles = Math.round(getDistanceMiles(userLat, userLng, airport.lat, airport.lng));
      const rawHours = distNm / cruiseSpeed;
      const h = Math.floor(rawHours);
      const m = Math.round((rawHours - h) * 60);
      const flightTime = h === 0 ? `${m}m` : m === 0 ? `${h}h` : `${h}h ${m}m`;
      const whySummary = await fetchDestinationSummary(airport, airport.lat, airport.lng);

      setResult({ airport, distNm, distMiles, flightTime, whySummary });
    } catch (e) {
      Alert.alert('Error', 'Something went wrong. Try again.');
    }
    setLoading(false);
  }

  function goToAirport() {
    if (!result) return;
    router.push({
      pathname: '/airport',
      params: {
        icao: result.airport.icao || result.airport.id,
        name: result.airport.name,
        city: result.airport.city,
        state: result.airport.state,
        lat: result.airport.lat,
        lng: result.airport.lng,
        elevation: result.airport.elevation,
        fuel: result.airport.fuel,
        runways: result.airport.runways ? JSON.stringify(result.airport.runways) : null,
      }
    });
    setVisible(false);
  }

  return (
    <>
      <TouchableOpacity style={styles.trigger} onPress={() => setVisible(true)} activeOpacity={0.86}>
        <View style={styles.triggerDice}>
          <Text style={styles.triggerEmoji}>🎲</Text>
        </View>
        <View style={styles.triggerText}>
          <Text style={styles.triggerEyebrow}>FEELING ADVENTUROUS?</Text>
          <Text style={styles.triggerTitle}>Surprise Me</Text>
          <Text style={styles.triggerSub}>We'll find you the perfect destination to fly today</Text>
        </View>
        <Text style={styles.triggerArrow}>›</Text>
      </TouchableOpacity>

      <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
        <View style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Where to? 🎲</Text>
            <TouchableOpacity onPress={() => { setVisible(false); setResult(null); setSelectedHours(null); }}>
              <Text style={styles.closeBtn}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.modalBody}>
            <Text style={styles.sectionLabel}>HOW LONG DO YOU WANT TO FLY?</Text>
            <View style={styles.hoursGrid}>
              {HOUR_OPTIONS.map(opt => (
                <TouchableOpacity
                  key={opt.hours}
                  style={[styles.hourChip, selectedHours === opt.hours && styles.hourChipActive]}
                  onPress={() => { setSelectedHours(opt.hours); setResult(null); }}
                >
                  <Text style={[styles.hourChipText, selectedHours === opt.hours && styles.hourChipTextActive]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {selectedHours && (
              <Text style={styles.rangeHint}>
                ~{Math.round(selectedHours * 0.4 * cruiseSpeed)}–{Math.round(selectedHours * cruiseSpeed)} nm at {cruiseSpeed} kts
              </Text>
            )}

            <TouchableOpacity
              style={[styles.goBtn, !selectedHours && styles.goBtnDisabled]}
              onPress={findSurprise}
              disabled={!selectedHours || loading}
            >
              {loading
                ? <ActivityIndicator color="#0D1421" />
                : <Text style={styles.goBtnText}>Find Me Somewhere ✈️</Text>
              }
            </TouchableOpacity>

            {result && (
              <View style={styles.resultCard}>
                <View style={styles.resultHeader}>
                  <Text style={styles.resultIcao}>{result.airport.icao || result.airport.id}</Text>
                  <Text style={styles.resultBadge}>✈️ {result.flightTime}</Text>
                </View>
                <Text style={styles.resultName}>{result.airport.name}</Text>
                <Text style={styles.resultCity}>{result.airport.city}, {result.airport.state}</Text>

                <View style={styles.resultStats}>
                  <View style={styles.statBox}>
                    <Text style={styles.statValue}>{result.distNm} nm</Text>
                    <Text style={styles.statLabel}>Distance</Text>
                  </View>
                  <View style={styles.statBox}>
                    <Text style={styles.statValue}>{result.flightTime}</Text>
                    <Text style={styles.statLabel}>Flight Time</Text>
                  </View>
                  <View style={styles.statBox}>
                    <Text style={styles.statValue}>{result.airport.elevation} ft</Text>
                    <Text style={styles.statLabel}>Elevation</Text>
                  </View>
                </View>

                {result.airport.fuel && (
                  <View style={styles.fuelPill}>
                    <Text style={styles.fuelPillText}>⛽ {formatFuel(result.airport.fuel)}</Text>
                  </View>
                )}

                {result.whySummary?.length > 0 && (
                  <View style={styles.whyBox}>
                    <Text style={styles.whyLabel}>WHY FLY HERE</Text>
                    {result.whySummary.map((line: string, i: number) => (
                      <Text key={i} style={styles.whyBullet}>{line}</Text>
                    ))}
                  </View>
                )}

                <View style={styles.resultActions}>
                  <TouchableOpacity style={styles.viewBtn} onPress={goToAirport}>
                    <Text style={styles.viewBtnText}>View Airport →</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.rerollBtn} onPress={findSurprise}>
                    <Text style={styles.rerollBtnText}>🎲 Reroll</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
            <View style={{ height: 60 }} />
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row', alignItems: 'center', gap: 16,
    backgroundColor: '#0A1628', borderRadius: 18,
    paddingHorizontal: 18, paddingVertical: 22,
    borderWidth: 1, borderColor: '#1E3A5F', marginBottom: 24,
  },
  triggerDice: {
    width: 54, height: 54, backgroundColor: '#38BDF8',
    borderRadius: 14, alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  triggerEmoji: { fontSize: 26 },
  triggerText: { flex: 1 },
  triggerEyebrow: {
    fontSize: 9, fontWeight: '700', color: '#38BDF8',
    letterSpacing: 1.6, textTransform: 'uppercase', marginBottom: 5,
  },
  triggerTitle: { fontSize: 18, fontWeight: '900', color: '#F0F4FF', marginBottom: 2 },
  triggerSub: { fontSize: 12, color: '#6A7B93', lineHeight: 17 },
  triggerArrow: { fontSize: 28, color: '#60CEFF', fontWeight: '300', flexShrink: 0 },
  modal: { flex: 1, backgroundColor: '#070B14' },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 20, paddingTop: 60, borderBottomWidth: 1, borderBottomColor: '#1E2D45',
  },
  modalTitle: { fontSize: 26, fontWeight: '800', color: '#F0F4FF' },
  closeBtn: { fontSize: 20, color: '#4A5B73' },
  modalBody: { padding: 20 },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: '#4A5B73', letterSpacing: 1.5, marginBottom: 14 },
  hoursGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 },
  hourChip: {
    backgroundColor: '#0D1421', borderRadius: 12, paddingHorizontal: 20, paddingVertical: 12,
    borderWidth: 1, borderColor: '#1E2D45',
  },
  hourChipActive: { backgroundColor: '#38BDF8', borderColor: '#38BDF8' },
  hourChipText: { fontSize: 15, fontWeight: '600', color: '#4A5B73' },
  hourChipTextActive: { color: '#0D1421', fontWeight: '800' },
  rangeHint: { fontSize: 12, color: '#4A5B73', marginBottom: 20, fontStyle: 'italic' },
  goBtn: { backgroundColor: '#38BDF8', borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginBottom: 24 },
  goBtnDisabled: { opacity: 0.4 },
  goBtnText: { color: '#0D1421', fontSize: 16, fontWeight: '800' },
  resultCard: { backgroundColor: '#0D1421', borderRadius: 20, padding: 20, borderWidth: 1, borderColor: '#1E2D45' },
  resultHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  resultIcao: { fontSize: 14, fontWeight: '700', color: '#38BDF8' },
  resultBadge: { backgroundColor: '#111827', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, fontSize: 12, color: '#F97316', fontWeight: '700' },
  resultName: { fontSize: 22, fontWeight: '800', color: '#F0F4FF', marginBottom: 4 },
  resultCity: { fontSize: 14, color: '#4A5B73', marginBottom: 16 },
  resultStats: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  statBox: { flex: 1, backgroundColor: '#111827', borderRadius: 12, padding: 12, alignItems: 'center' },
  statValue: { fontSize: 16, fontWeight: '800', color: '#F0F4FF' },
  statLabel: { fontSize: 11, color: '#4A5B73', marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.8 },
  fuelPill: { backgroundColor: '#111827', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, alignSelf: 'flex-start', marginBottom: 14 },
  fuelPillText: { fontSize: 13, color: '#22C55E', fontWeight: '700' },
  whyBox: { backgroundColor: '#111827', borderRadius: 12, padding: 14, marginBottom: 16, gap: 8 },
  whyLabel: { fontSize: 10, color: '#4A5B73', fontWeight: '700', letterSpacing: 1.2, marginBottom: 2 },
  whyBullet: { fontSize: 14, color: '#C8D8EC', lineHeight: 20 },
  resultActions: { flexDirection: 'row', gap: 10 },
  viewBtn: { flex: 1, backgroundColor: '#38BDF8', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  viewBtnText: { color: '#0D1421', fontSize: 15, fontWeight: '800' },
  rerollBtn: { backgroundColor: '#111827', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 20, alignItems: 'center', borderWidth: 1, borderColor: '#1E2D45' },
  rerollBtnText: { color: '#F0F4FF', fontSize: 15, fontWeight: '700' },
});
