import { supabase } from '@/lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator, Alert, Dimensions, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const { width } = Dimensions.get('window');

const INTERESTS = [
  { id: 'golf', emoji: '⛳', label: 'Golf' },
  { id: 'food', emoji: '🍽', label: 'Food & Dining' },
  { id: 'outdoors', emoji: '🌲', label: 'Outdoors & Nature' },
  { id: 'beach', emoji: '🏖', label: 'Beach & Waterfront' },
  { id: 'culture', emoji: '🏛', label: 'Museums & Culture' },
  { id: 'shopping', emoji: '🛍', label: 'Shopping' },
  { id: 'entertainment', emoji: '🎭', label: 'Entertainment' },
  { id: 'scenic', emoji: '🏔', label: 'Scenic Flying' },
];

const TRIP_STYLES = [
  { id: 'day_trip', emoji: '☀️', label: 'Day Trips', sub: 'Back home by sunset' },
  { id: 'overnight', emoji: '🌙', label: 'Overnights', sub: 'Stay a night or two' },
  { id: 'long_xc', emoji: '🗺', label: 'Long XC', sub: 'Multi-day adventures' },
  { id: 'all', emoji: '✈️', label: 'All of the above', sub: 'Depends on the mood' },
];

const CERTIFICATES = [
  { id: 'student', label: 'Student Pilot' },
  { id: 'private', label: 'Private Pilot' },
  { id: 'instrument', label: 'Instrument Rated' },
  { id: 'commercial', label: 'Commercial' },
  { id: 'atp', label: 'ATP' },
  { id: 'cfi', label: 'CFI' },
];

const STEPS = ['welcome', 'aircraft', 'homebase', 'interests', 'tripstyle', 'certificate', 'logbook', 'done'];

export default function OnboardingScreen() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [aircraftType, setAircraftType] = useState('');
  const [cruiseSpeed, setCruiseSpeed] = useState('');
  const [homeAirport, setHomeAirport] = useState('');
  const [interests, setInterests] = useState<string[]>([]);
  const [tripStyle, setTripStyle] = useState<string[]>([]);
  const [certificate, setCertificate] = useState('');

  const progress = step / (STEPS.length - 1);

  function importLogbook() {
    Alert.alert('Coming Soon', 'A new way to view your past adventures coming soon');
  }

  function toggleInterest(id: string) {
    setInterests(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  }

  function toggleTripStyle(id: string) {
    setTripStyle(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  }

  function next() {
    if (step < STEPS.length - 1) setStep(s => s + 1);
  }

  function back() {
    if (step > 0) setStep(s => s - 1);
  }

  async function finish() {
    setSaving(true);
    const userId = name.toLowerCase().replace(/\s+/g, '_') || 'pilot';
    const profile = {
      user_id: userId,
      name,
      aircraft_type: aircraftType,
      cruise_speed: cruiseSpeed ? parseInt(cruiseSpeed) : null,
      home_airport: homeAirport.toUpperCase(),
      interests,
      trip_style: tripStyle,
      certificate,
      created_at: new Date().toISOString(),
    };

    // Save to AsyncStorage first (offline fallback)
    await AsyncStorage.setItem('userProfile', JSON.stringify(profile));
    await AsyncStorage.setItem('onboardingComplete', 'true');
    await AsyncStorage.setItem('userId', userId);

    // Try saving to Supabase
    try {
      await supabase.from('pilot_profiles').upsert(profile);
    } catch (e) {}

    setSaving(false);
    router.replace('/(tabs)');
  }

  const currentStep = STEPS[step];

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Progress bar */}
      {currentStep !== 'welcome' && currentStep !== 'done' && (
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
        </View>
      )}

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>

        {/* WELCOME */}
        {currentStep === 'welcome' && (
          <View style={styles.stepContainer}>
            <Text style={styles.bigEmoji}>✈️</Text>
            <Text style={styles.welcomeTitle}>Welcome to{'\n'}Left Seat</Text>
            <Text style={styles.welcomeSub}>
              Your personal GA pilot companion. Let's set up your profile so we can find the perfect destinations for you.
            </Text>
            <Text style={styles.fieldLabel}>WHAT'S YOUR NAME?</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Mitchell"
              placeholderTextColor="#4A5B73"
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
            />
            <TouchableOpacity style={[styles.nextBtn, !name && styles.nextBtnDisabled]} onPress={next} disabled={!name}>
              <Text style={styles.nextBtnText}>Let's Go →</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* AIRCRAFT */}
        {currentStep === 'aircraft' && (
          <View style={styles.stepContainer}>
            <Text style={styles.stepEmoji}>🛩</Text>
            <Text style={styles.stepTitle}>Your Aircraft</Text>
            <Text style={styles.stepSub}>This helps us calculate accurate flight times and range for your Surprise Me picks.</Text>
            <Text style={styles.fieldLabel}>AIRCRAFT TYPE</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Mooney M20C, Cessna 172"
              placeholderTextColor="#4A5B73"
              value={aircraftType}
              onChangeText={setAircraftType}
            />
            <Text style={styles.fieldLabel}>CRUISE SPEED (KTS)</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 150"
              placeholderTextColor="#4A5B73"
              value={cruiseSpeed}
              onChangeText={setCruiseSpeed}
              keyboardType="numeric"
            />
            <View style={styles.navRow}>
              <TouchableOpacity style={styles.backBtn} onPress={back}><Text style={styles.backBtnText}>← Back</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.nextBtn, styles.nextBtnFlex, !aircraftType && styles.nextBtnDisabled]} onPress={next} disabled={!aircraftType}>
                <Text style={styles.nextBtnText}>Next →</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* HOME BASE */}
        {currentStep === 'homebase' && (
          <View style={styles.stepContainer}>
            <Text style={styles.stepEmoji}>🏠</Text>
            <Text style={styles.stepTitle}>Home Base</Text>
            <Text style={styles.stepSub}>Where do you usually fly out of? We'll use this as your starting point.</Text>
            <Text style={styles.fieldLabel}>HOME AIRPORT (ICAO)</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. KSUS"
              placeholderTextColor="#4A5B73"
              value={homeAirport}
              onChangeText={setHomeAirport}
              autoCapitalize="characters"
              maxLength={4}
            />
            <View style={styles.navRow}>
              <TouchableOpacity style={styles.backBtn} onPress={back}><Text style={styles.backBtnText}>← Back</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.nextBtn, styles.nextBtnFlex, !homeAirport && styles.nextBtnDisabled]} onPress={next} disabled={!homeAirport}>
                <Text style={styles.nextBtnText}>Next →</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* INTERESTS */}
        {currentStep === 'interests' && (
          <View style={styles.stepContainer}>
            <Text style={styles.stepEmoji}>🎯</Text>
            <Text style={styles.stepTitle}>What do you love?</Text>
            <Text style={styles.stepSub}>Pick everything that sounds like a good reason to fly somewhere.</Text>
            <View style={styles.grid}>
              {INTERESTS.map(item => (
                <TouchableOpacity
                  key={item.id}
                  style={[styles.gridItem, interests.includes(item.id) && styles.gridItemActive]}
                  onPress={() => toggleInterest(item.id)}
                >
                  <Text style={styles.gridEmoji}>{item.emoji}</Text>
                  <Text style={[styles.gridLabel, interests.includes(item.id) && styles.gridLabelActive]}>{item.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.navRow}>
              <TouchableOpacity style={styles.backBtn} onPress={back}><Text style={styles.backBtnText}>← Back</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.nextBtn, styles.nextBtnFlex, interests.length === 0 && styles.nextBtnDisabled]} onPress={next} disabled={interests.length === 0}>
                <Text style={styles.nextBtnText}>Next →</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* TRIP STYLE */}
        {currentStep === 'tripstyle' && (
          <View style={styles.stepContainer}>
            <Text style={styles.stepEmoji}>🗺</Text>
            <Text style={styles.stepTitle}>How do you fly?</Text>
            <Text style={styles.stepSub}>Select everything that fits your flying style.</Text>
            <View style={styles.styleList}>
              {TRIP_STYLES.map(item => (
                <TouchableOpacity
                  key={item.id}
                  style={[styles.styleItem, tripStyle.includes(item.id) && styles.styleItemActive]}
                  onPress={() => toggleTripStyle(item.id)}
                >
                  <Text style={styles.styleEmoji}>{item.emoji}</Text>
                  <View style={styles.styleText}>
                    <Text style={[styles.styleLabel, tripStyle.includes(item.id) && styles.styleLabelActive]}>{item.label}</Text>
                    <Text style={styles.styleSub}>{item.sub}</Text>
                  </View>
                  {tripStyle.includes(item.id) && <Text style={styles.styleCheck}>✓</Text>}
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.navRow}>
              <TouchableOpacity style={styles.backBtn} onPress={back}><Text style={styles.backBtnText}>← Back</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.nextBtn, styles.nextBtnFlex, tripStyle.length === 0 && styles.nextBtnDisabled]} onPress={next} disabled={tripStyle.length === 0}>
                <Text style={styles.nextBtnText}>Next →</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* CERTIFICATE */}
        {currentStep === 'certificate' && (
          <View style={styles.stepContainer}>
            <Text style={styles.stepEmoji}>📋</Text>
            <Text style={styles.stepTitle}>Your Certificate</Text>
            <Text style={styles.stepSub}>Helps us connect you with pilots at a similar stage.</Text>
            <View style={styles.certList}>
              {CERTIFICATES.map(item => (
                <TouchableOpacity
                  key={item.id}
                  style={[styles.certItem, certificate === item.id && styles.certItemActive]}
                  onPress={() => setCertificate(item.id)}
                >
                  <Text style={[styles.certLabel, certificate === item.id && styles.certLabelActive]}>{item.label}</Text>
                  {certificate === item.id && <Text style={styles.styleCheck}>✓</Text>}
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.navRow}>
              <TouchableOpacity style={styles.backBtn} onPress={back}><Text style={styles.backBtnText}>← Back</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.nextBtn, styles.nextBtnFlex, !certificate && styles.nextBtnDisabled]} onPress={next} disabled={!certificate}>
                <Text style={styles.nextBtnText}>Next →</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* LOGBOOK IMPORT */}
        {currentStep === 'logbook' && (
          <View style={styles.stepContainer}>
            <Text style={styles.stepEmoji}>📒</Text>
            <Text style={styles.stepTitle}>Import Logbook</Text>
            <Text style={styles.stepSub}>
              Export your ForeFlight logbook as a CSV and import it here to auto-fill your flight stats.{'\n\n'}
              In ForeFlight: Logbook → ··· → Export → Logbook CSV
            </Text>

            <TouchableOpacity style={styles.importBtn} onPress={importLogbook}>
              <Text style={styles.importBtnText}>📒  Import Logbook</Text>
            </TouchableOpacity>
            <Text style={styles.skipHint}>You can also do this later from your profile.</Text>

            <View style={styles.navRow}>
              <TouchableOpacity style={styles.backBtn} onPress={back}><Text style={styles.backBtnText}>← Back</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.nextBtn, styles.nextBtnFlex]} onPress={next}>
                <Text style={styles.nextBtnText}>Skip →</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* DONE */}
        {currentStep === 'done' && (
          <View style={styles.stepContainer}>
            <Text style={styles.bigEmoji}>🎉</Text>
            <Text style={styles.welcomeTitle}>You're all set,{'\n'}{name}!</Text>
            <Text style={styles.welcomeSub}>
              Left Seat is ready to find your perfect destinations based on your interests and flying style.
            </Text>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryRow}>🛩  {aircraftType} · {cruiseSpeed} kts</Text>
              <Text style={styles.summaryRow}>🏠  {homeAirport}</Text>
              <Text style={styles.summaryRow}>🎯  {interests.map(i => INTERESTS.find(x => x.id === i)?.label).join(', ')}</Text>
              <Text style={styles.summaryRow}>📋  {CERTIFICATES.find(c => c.id === certificate)?.label}</Text>
            </View>
            <TouchableOpacity style={styles.nextBtn} onPress={finish} disabled={saving}>
              {saving ? <ActivityIndicator color="#0D1421" /> : <Text style={styles.nextBtnText}>Start Flying ✈️</Text>}
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#070B14' },
  progressBar: { height: 3, backgroundColor: '#1E2D45', margin: 20, borderRadius: 2 },
  progressFill: { height: 3, backgroundColor: '#38BDF8', borderRadius: 2 },
  body: { padding: 24, paddingBottom: 60 },
  stepContainer: { flex: 1 },
  bigEmoji: { fontSize: 64, textAlign: 'center', marginTop: 40, marginBottom: 24 },
  welcomeTitle: { fontSize: 36, fontWeight: '900', color: '#F0F4FF', textAlign: 'center', lineHeight: 44, marginBottom: 16 },
  welcomeSub: { fontSize: 16, color: '#4A5B73', textAlign: 'center', lineHeight: 24, marginBottom: 40 },
  stepEmoji: { fontSize: 48, marginBottom: 16, marginTop: 20 },
  stepTitle: { fontSize: 30, fontWeight: '800', color: '#F0F4FF', marginBottom: 8 },
  stepSub: { fontSize: 15, color: '#4A5B73', lineHeight: 22, marginBottom: 28 },
  fieldLabel: { fontSize: 11, fontWeight: '700', color: '#4A5B73', letterSpacing: 1.5, marginBottom: 10, textTransform: 'uppercase' },
  input: {
    backgroundColor: '#0D1421', borderRadius: 14, paddingHorizontal: 18,
    paddingVertical: 16, color: '#F0F4FF', fontSize: 16,
    borderWidth: 1, borderColor: '#1E2D45', marginBottom: 20,
  },
  navRow: { flexDirection: 'row', gap: 12, marginTop: 8 },
  nextBtn: { backgroundColor: '#38BDF8', borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  nextBtnFlex: { flex: 1 },
  nextBtnDisabled: { opacity: 0.35 },
  nextBtnText: { color: '#0D1421', fontSize: 16, fontWeight: '800' },
  backBtn: { backgroundColor: '#0D1421', borderRadius: 14, paddingVertical: 16, paddingHorizontal: 20, alignItems: 'center', borderWidth: 1, borderColor: '#1E2D45' },
  backBtnText: { color: '#4A5B73', fontSize: 15, fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 24 },
  gridItem: {
    width: (width - 72) / 2, backgroundColor: '#0D1421', borderRadius: 16,
    padding: 18, alignItems: 'center', borderWidth: 1, borderColor: '#1E2D45',
  },
  gridItemActive: { backgroundColor: '#38BDF8', borderColor: '#38BDF8' },
  gridEmoji: { fontSize: 32, marginBottom: 8 },
  gridLabel: { fontSize: 14, fontWeight: '600', color: '#4A5B73', textAlign: 'center' },
  gridLabelActive: { color: '#0D1421', fontWeight: '800' },
  styleList: { gap: 10, marginBottom: 24 },
  styleItem: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: '#0D1421', borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: '#1E2D45',
  },
  styleItemActive: { backgroundColor: '#111827', borderColor: '#38BDF8' },
  styleEmoji: { fontSize: 28 },
  styleText: { flex: 1 },
  styleLabel: { fontSize: 16, fontWeight: '700', color: '#4A5B73' },
  styleLabelActive: { color: '#F0F4FF' },
  styleSub: { fontSize: 12, color: '#4A5B73', marginTop: 2 },
  styleCheck: { fontSize: 18, color: '#38BDF8', fontWeight: '800' },
  certList: { gap: 10, marginBottom: 24 },
  certItem: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#0D1421', borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: '#1E2D45',
  },
  certItemActive: { backgroundColor: '#111827', borderColor: '#38BDF8' },
  certLabel: { fontSize: 16, fontWeight: '600', color: '#4A5B73' },
  certLabelActive: { color: '#F0F4FF', fontWeight: '700' },
  summaryCard: {
    backgroundColor: '#0D1421', borderRadius: 16, padding: 20,
    borderWidth: 1, borderColor: '#1E2D45', gap: 10, marginBottom: 32,
  },
  summaryRow: { fontSize: 15, color: '#F0F4FF', fontWeight: '500' },
  importBtn: {
    backgroundColor: '#38BDF8', borderRadius: 14, paddingVertical: 18,
    alignItems: 'center', marginBottom: 24,
  },
  importBtnText: { color: '#0D1421', fontSize: 16, fontWeight: '800' },
  statsPreview: {
    backgroundColor: '#0D1421', borderRadius: 16, padding: 20,
    borderWidth: 1, borderColor: '#1E2D45', marginBottom: 24, gap: 14,
  },
  statsPreviewTitle: { fontSize: 12, fontWeight: '700', color: '#4A5B73', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 4 },
  statsPreviewRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  statsPreviewIcon: { fontSize: 20, width: 28 },
  statsPreviewLabel: { flex: 1, fontSize: 14, color: '#8A9BB5' },
  statsPreviewValue: { fontSize: 15, fontWeight: '700', color: '#F0F4FF' },
  reimportBtn: { marginTop: 4, alignItems: 'center' },
  reimportBtnText: { fontSize: 13, color: '#38BDF8' },
  skipHint: { fontSize: 13, color: '#4A5B73', textAlign: 'center', marginTop: -12, marginBottom: 24 },
});
