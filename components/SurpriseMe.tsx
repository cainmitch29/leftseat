import airportsData from '@/assets/images/airports.json';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, Modal, ScrollView,
  StyleSheet, Text, TouchableOpacity, View
} from 'react-native';

const airports: any[] = airportsData as any[];
const GOOGLE_KEY = 'AIzaSyAP7EitXnoZAhammN6w1RhvFJ2DoZnfd1k';

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

async function fetchHighlight(lat: number, lng: number, interests: string[]): Promise<{ emoji: string; name: string; type: string } | null> {
  const allTypes = [
    { id: 'food', type: 'restaurant', emoji: '🍽', label: 'restaurant' },
    { id: 'golf', type: 'golf_course', emoji: '⛳', label: 'golf course' },
    { id: 'culture', type: 'museum', emoji: '🏛', label: 'museum' },
    { id: 'outdoors', type: 'park', emoji: '🌲', label: 'park' },
    { id: 'entertainment', type: 'tourist_attraction', emoji: '🎯', label: 'attraction' },
    { id: 'shopping', type: 'shopping_mall', emoji: '🛍', label: 'shopping' },
    { id: 'beach', type: 'natural_feature', emoji: '🏖', label: 'beach' },
  ];

  // Filter by user interests if available
  const preferred = interests.length > 0
    ? allTypes.filter(t => interests.includes(t.id))
    : allTypes;
  const pool = preferred.length > 0 ? preferred : allTypes;
  const pick = pool[Math.floor(Math.random() * pool.length)];

  try {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=16000&type=${pick.type}&key=${GOOGLE_KEY}`
    );
    const data = await res.json();
    if (data.results?.length > 0) {
      const place = data.results[Math.floor(Math.random() * Math.min(3, data.results.length))];
      return { emoji: pick.emoji, name: place.name, type: pick.label };
    }
  } catch {}
  return null;
}

export default function SurpriseMe() {
  const [visible, setVisible] = useState(false);
  const [selectedHours, setSelectedHours] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [cruiseSpeed, setCruiseSpeed] = useState(150);
  const [interests, setInterests] = useState<string[]>([]);
  const router = useRouter();

  useEffect(() => {
    AsyncStorage.getItem('userProfile').then((data) => {
      if (data) {
        const profile = JSON.parse(data);
        if (profile.cruise_speed) setCruiseSpeed(profile.cruise_speed);
        if (profile.interests) setInterests(profile.interests);
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
        return d >= minNm && d <= maxNm && a.fuel;
      });

      if (candidates.length === 0) {
        Alert.alert('No airports found', 'Try a different time range.');
        setLoading(false);
        return;
      }

      const airport = candidates[Math.floor(Math.random() * candidates.length)];
      const distNm = Math.round(getDistanceNm(userLat, userLng, airport.lat, airport.lng));
      const distMiles = Math.round(getDistanceMiles(userLat, userLng, airport.lat, airport.lng));
      const flightTime = (distNm / cruiseSpeed).toFixed(1);
      const highlight = await fetchHighlight(airport.lat, airport.lng, interests);

      setResult({ airport, distNm, distMiles, flightTime, highlight });
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
                  <Text style={styles.resultBadge}>✈️ {result.flightTime} hrs</Text>
                </View>
                <Text style={styles.resultName}>{result.airport.name}</Text>
                <Text style={styles.resultCity}>{result.airport.city}, {result.airport.state}</Text>

                <View style={styles.resultStats}>
                  <View style={styles.statBox}>
                    <Text style={styles.statValue}>{result.distNm} nm</Text>
                    <Text style={styles.statLabel}>Distance</Text>
                  </View>
                  <View style={styles.statBox}>
                    <Text style={styles.statValue}>{result.flightTime} hrs</Text>
                    <Text style={styles.statLabel}>Flight Time</Text>
                  </View>
                  <View style={styles.statBox}>
                    <Text style={styles.statValue}>{result.airport.elevation} ft</Text>
                    <Text style={styles.statLabel}>Elevation</Text>
                  </View>
                </View>

                {result.airport.fuel && (
                  <View style={styles.fuelPill}>
                    <Text style={styles.fuelPillText}>⛽ {result.airport.fuel}</Text>
                  </View>
                )}

                {result.highlight && (
                  <View style={styles.highlightBox}>
                    <Text style={styles.highlightEmoji}>{result.highlight.emoji}</Text>
                    <View style={styles.highlightText}>
                      <Text style={styles.highlightLabel}>NEARBY {result.highlight.type.toUpperCase()}</Text>
                      <Text style={styles.highlightName}>{result.highlight.name}</Text>
                    </View>
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
  highlightBox: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#111827', borderRadius: 12, padding: 14, marginBottom: 16 },
  highlightEmoji: { fontSize: 28 },
  highlightText: { flex: 1 },
  highlightLabel: { fontSize: 10, color: '#4A5B73', fontWeight: '700', letterSpacing: 1.2, marginBottom: 3 },
  highlightName: { fontSize: 15, fontWeight: '700', color: '#F0F4FF' },
  resultActions: { flexDirection: 'row', gap: 10 },
  viewBtn: { flex: 1, backgroundColor: '#38BDF8', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  viewBtnText: { color: '#0D1421', fontSize: 15, fontWeight: '800' },
  rerollBtn: { backgroundColor: '#111827', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 20, alignItems: 'center', borderWidth: 1, borderColor: '#1E2D45' },
  rerollBtnText: { color: '#F0F4FF', fontSize: 15, fontWeight: '700' },
});
