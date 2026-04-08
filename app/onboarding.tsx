/**
 * app/onboarding.tsx  ·  4-Screen Pilot Onboarding
 *
 * Flow: Welcome → Value Prop → Aircraft Setup → Preferences
 * No authentication. All data saved to AsyncStorage.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming,
} from 'react-native-reanimated';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import airportsData from '../assets/images/airports.json';
import { GlassSearchBar } from '../components/GlassSearchBar';

// ── Design tokens ─────────────────────────────────────────────────────────────

const ORANGE = '#FF4D00';
const SKY    = '#38BDF8';

// ── Airport search ────────────────────────────────────────────────────────────

interface AirportEntry {
  id: string; icao: string | null; faa: string;
  name: string; city: string; state: string;
}


function searchAirports(query: string): AirportEntry[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  return (airportsData as AirportEntry[])
    .filter(a => {
      const code = (a.icao || a.faa || '').toLowerCase();
      return code.startsWith(q) ||
        (a.name || '').toLowerCase().includes(q) ||
        (a.city || '').toLowerCase().includes(q);
    })
    .slice(0, 10);
}

// ── Aircraft list ─────────────────────────────────────────────────────────────

const AIRCRAFT_LIST = [
  'Cessna 150', 'Cessna 152', 'Cessna 172 Skyhawk', 'Cessna 182 Skylane',
  'Cessna 206 Stationair', 'Cessna 210 Centurion',
  'Piper PA-28 Cherokee', 'Piper PA-28-181 Archer', 'Piper PA-28R Arrow',
  'Piper PA-32 Cherokee Six', 'Piper PA-46 Malibu', 'Piper PA-46 Meridian',
  'Beechcraft V35 Bonanza', 'Beechcraft A36 Bonanza',
  'Beechcraft Baron 55', 'Beechcraft Baron 58',
  'Mooney M20J 201', 'Mooney M20R Ovation', 'Mooney M20TN Acclaim',
  'Cirrus SR20', 'Cirrus SR22', 'Cirrus SR22T',
  'Diamond DA40 Star', 'Diamond DA42 Twin Star',
  "Van's RV-7", "Van's RV-10", "Van's RV-14",
  'Grumman AA-5B Tiger', 'American Champion Citabria',
];

function searchAircraft(query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return AIRCRAFT_LIST.filter(a => a.toLowerCase().includes(q)).slice(0, 8);
}

// ── Pilot rating ─────────────────────────────────────────────────────────────

const CERTIFICATES = [
  { id: 'student',    label: 'Student Pilot' },
  { id: 'private',    label: 'Private Pilot' },
  { id: 'instrument', label: 'Instrument Rated' },
  { id: 'commercial', label: 'Commercial' },
  { id: 'atp',        label: 'ATP' },
  { id: 'cfi',        label: 'CFI' },
];

// ── Preference chips ──────────────────────────────────────────────────────────

const PREFERENCES = [
  { id: 'food',       label: 'Food Runs',        icon: 'silverware-fork-knife' },
  { id: 'golf',       label: 'Golf',              icon: 'golf' },
  { id: 'scenic',     label: 'Scenic',            icon: 'image-filter-hdr' },
  { id: 'weekend',    label: 'Weekend Trips',     icon: 'calendar-weekend' },
  { id: 'adventures', label: 'Random Adventures', icon: 'dice-multiple' },
] as const;

const TOTAL_STEPS = 4;

// ── Primary button (file-level so hooks are stable per instance) ──────────────

function PrimaryBtn({
  label, onPress, loading = false,
}: { label: string; onPress: () => void; loading?: boolean }) {
  const sc = useSharedValue(1);
  const st = useAnimatedStyle(() => ({
    transform: [{ scale: withSpring(sc.value, { damping: 18, stiffness: 280 }) }],
  }));
  return (
    <Animated.View style={st}>
      <Pressable
        style={s.primaryBtn}
        onPressIn={() => { sc.value = 0.97; }}
        onPressOut={() => { sc.value = 1; }}
        onPress={onPress}
        disabled={loading}
      >
        <View style={s.primaryBtnShine} pointerEvents="none" />
        {loading
          ? <ActivityIndicator color="#fff" />
          : <Text style={s.primaryBtnTxt}>{label}</Text>
        }
      </Pressable>
    </Animated.View>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function OnboardingScreen() {
  const [step, setStep]     = useState(0);
  const [saving, setSaving] = useState(false);

  // ── Screen 3: Aircraft Setup ───────────────────────────────────────────────
  const [certificate, setCertificate]         = useState('');
  const [cruiseSpeed, setCruiseSpeed]         = useState('120');
  const [cruiseUnit, setCruiseUnit]           = useState<'kts' | 'mph'>('kts');
  const [homeAirport, setHomeAirport]         = useState('');
  const [homeAirportName, setHomeAirportName] = useState('');
  const [airportConfirmed, setAirportConfirmed] = useState(false);
  const [airportModalOpen, setAirportModalOpen] = useState(false);
  const [apQuery, setApQuery]   = useState('');
  const [apResults, setApResults] = useState<AirportEntry[]>([]);
  const apInputRef = useRef<TextInput>(null);

  const [aircraft, setAircraft]         = useState('');
  const [acftModalOpen, setAcftModalOpen] = useState(false);
  const [acftQuery, setAcftQuery]         = useState('');
  const [acftResults, setAcftResults]     = useState<string[]>([]);
  const acftInputRef = useRef<TextInput>(null);

  // ── Screen 4: Preferences ─────────────────────────────────────────────────
  const [interests, setInterests] = useState<string[]>([]);


  // ── Screen transitions ────────────────────────────────────────────────────
  const fade   = useSharedValue(1);
  const slideY = useSharedValue(0);
  const animStyle = useAnimatedStyle(() => ({
    opacity: fade.value,
    transform: [{ translateY: slideY.value }],
  }));

  function applyStep(next: number) {
    setStep(next);
    slideY.value = 16;
    fade.value   = withTiming(1, { duration: 260 });
    slideY.value = withTiming(0, { duration: 260 });
  }

  function goNext() {
    if (step >= TOTAL_STEPS - 1) return;
    fade.value = withTiming(0, { duration: 150 }, () => runOnJS(applyStep)(step + 1));
  }

  function goBack() {
    if (step === 0) return;
    fade.value = withTiming(0, { duration: 150 }, () => runOnJS(applyStep)(step - 1));
  }

  // ── Airport modal ─────────────────────────────────────────────────────────

  function openAirportModal() {
    setApQuery(''); setApResults([]);
    setAirportModalOpen(true);
  }

  function selectAirport(a: AirportEntry) {
    setHomeAirport((a.icao || a.faa).toUpperCase());
    setHomeAirportName(a.name);
    setAirportConfirmed(true);
    setAirportModalOpen(false);
  }

  // ── Aircraft modal ────────────────────────────────────────────────────────

  function openAcftModal() {
    setAcftQuery(''); setAcftResults([]);
    setAcftModalOpen(true);
  }

  function selectAcft(label: string) {
    setAircraft(label);
    setAcftModalOpen(false);
  }

  function useCustomAcft() {
    const t = acftQuery.trim();
    if (!t) return;
    setAircraft(t);
    setAcftModalOpen(false);
  }

  // ── Preferences ───────────────────────────────────────────────────────────

  function toggleInterest(id: string) {
    setInterests(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  }

  // ── Finish & Skip ─────────────────────────────────────────────────────────

  async function finish() {
    setSaving(true);
    const speedKts = cruiseUnit === 'mph'
      ? Math.round(parseInt(cruiseSpeed || '120', 10) / 1.15078)
      : parseInt(cruiseSpeed || '120', 10);

    const profile = {
      home_airport:         homeAirport || null,
      home_airport_name:    homeAirportName || null,
      cruise_speed:         speedKts,
      aircraft_type:        aircraft || null,
      certificate:          certificate || null,
      interests,
      onboarding_completed: true,
      created_at:           new Date().toISOString(),
    };

    try {
      await AsyncStorage.setItem('userProfile:guest', JSON.stringify(profile));
      await AsyncStorage.setItem('hasCompletedOnboarding', 'true');
    } catch (e: any) {
      console.warn('[Onboarding] save failed:', e?.message ?? e);
    }

    setSaving(false);
    router.replace('/(tabs)');
  }

  async function skipAll() {
    try { await AsyncStorage.setItem('hasCompletedOnboarding', 'true'); } catch {}
    router.replace('/(tabs)');
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={s.root} edges={['top', 'bottom']}>

      {/* Background gradient */}
      <LinearGradient
        colors={['#060911', '#07101C', '#08132B']}
        locations={[0, 0.48, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      {/* ── Fixed header: back ← · dots · skip ────────────────────────────── */}
      <View style={s.header}>
        {step > 0 ? (
          <TouchableOpacity onPress={goBack} style={s.headerSide} activeOpacity={0.7}>
            <Feather name="chevron-left" size={22} color="#4A5B73" />
          </TouchableOpacity>
        ) : (
          <View style={s.headerSide} />
        )}

        <View style={s.dots}>
          {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
            <View
              key={i}
              style={[
                s.dot,
                i === step && s.dotActive,
                i < step  && s.dotDone,
              ]}
            />
          ))}
        </View>

        {step < TOTAL_STEPS - 1 ? (
          <TouchableOpacity onPress={skipAll} style={s.headerSide} activeOpacity={0.7}>
            <Text style={s.skipTxt}>Skip</Text>
          </TouchableOpacity>
        ) : (
          <View style={s.headerSide} />
        )}
      </View>

      {/* ── Animated screen content ───────────────────────────────────────── */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Animated.View style={[{ flex: 1 }, animStyle]}>
          <ScrollView
            contentContainerStyle={s.body}
            showsVerticalScrollIndicator={false}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
          >

            {/* ── SCREEN 1: Welcome ──────────────────────────────────────── */}
            {step === 0 && (
              <View>
                <View style={s.iconRing}>
                  <MaterialCommunityIcons name="airplane" size={36} color={SKY} />
                </View>

                <Text style={s.welcomeTitle}>Built by a pilot.{'\n'}For pilots.</Text>
                <Text style={s.welcomeSub}>
                  Discover where to fly next — based on distance, time, and what's actually worth it.
                </Text>

                <PrimaryBtn label="Get Started" onPress={goNext} />
              </View>
            )}

            {/* ── SCREEN 2: Value prop ───────────────────────────────────── */}
            {step === 1 && (
              <View>
                <Text style={s.eyebrow}>WHY LEFTSEAT</Text>
                <Text style={s.title}>Stop guessing{'\n'}where to fly.</Text>

                <View style={s.bulletList}>
                  {[
                    {
                      icon: 'silverware-fork-knife' as const,
                      text: 'Find airports with food, golf, and things to do',
                    },
                    {
                      icon: 'speedometer' as const,
                      text: 'See exact distance in NM + estimated flight time',
                    },
                    {
                      icon: 'map-search' as const,
                      text: 'Discover hidden gems other pilots love',
                    },
                  ].map((b, i) => (
                    <View key={i} style={s.bulletRow}>
                      <View style={s.bulletIcon}>
                        <MaterialCommunityIcons name={b.icon} size={18} color={SKY} />
                      </View>
                      <Text style={s.bulletTxt}>{b.text}</Text>
                    </View>
                  ))}
                </View>

                <PrimaryBtn label="Continue" onPress={goNext} />
              </View>
            )}

            {/* ── SCREEN 3: Aircraft setup ───────────────────────────────── */}
            {step === 2 && (
              <View>
                <Text style={s.eyebrow}>PILOT INFO</Text>
                <Text style={s.title}>Tell us about{'\n'}your flying.</Text>

                {/* Pilot rating */}
                <Text style={s.fieldLabel}>PILOT RATING</Text>
                <View style={s.certRow}>
                  {CERTIFICATES.map(item => (
                    <TouchableOpacity
                      key={item.id}
                      style={[s.certChip, certificate === item.id && s.certChipActive]}
                      onPress={() => setCertificate(item.id)}
                      activeOpacity={0.75}
                    >
                      <Text style={[s.certChipTxt, certificate === item.id && s.certChipTxtActive]}>
                        {item.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Cruise speed + unit toggle */}
                <Text style={s.fieldLabel}>CRUISE SPEED</Text>
                <View style={s.speedRow}>
                  <TextInput
                    style={[s.input, { flex: 1 }]}
                    value={cruiseSpeed}
                    onChangeText={t => setCruiseSpeed(t.replace(/[^0-9]/g, ''))}
                    keyboardType="numeric"
                    maxLength={4}
                    returnKeyType="done"
                    placeholderTextColor="#5A7A98"
                    selectionColor={SKY}
                  />
                  <View style={s.unitToggle}>
                    {(['kts', 'mph'] as const).map(u => (
                      <TouchableOpacity
                        key={u}
                        style={[s.unitBtn, cruiseUnit === u && s.unitBtnActive]}
                        onPress={() => setCruiseUnit(u)}
                        activeOpacity={0.8}
                      >
                        <Text style={[s.unitTxt, cruiseUnit === u && s.unitTxtActive]}>
                          {u}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                {/* Home airport */}
                <Text style={s.fieldLabel}>HOME AIRPORT</Text>
                {airportConfirmed ? (
                  <TouchableOpacity
                    style={s.selectedCard}
                    onPress={() => { setAirportConfirmed(false); openAirportModal(); }}
                    activeOpacity={0.8}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={s.selectedPrimary}>{homeAirport}</Text>
                      {homeAirportName ? (
                        <Text style={s.selectedSecondary} numberOfLines={1}>{homeAirportName}</Text>
                      ) : null}
                    </View>
                    <Text style={s.changeBtn}>Change</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity style={s.trigger} onPress={openAirportModal} activeOpacity={0.7}>
                    <Text style={s.triggerTxt}>Search by ICAO, name, or city…</Text>
                    <Feather name="search" size={15} color="#5A7A98" />
                  </TouchableOpacity>
                )}

                {/* Aircraft type — optional */}
                <Text style={s.fieldLabel}>
                  AIRCRAFT TYPE{'  '}
                  <Text style={s.optionalLabel}>OPTIONAL</Text>
                </Text>
                {aircraft ? (
                  <TouchableOpacity
                    style={s.selectedCard}
                    onPress={openAcftModal}
                    activeOpacity={0.8}
                  >
                    <Text style={[s.selectedPrimary, { flex: 1 }]}>{aircraft}</Text>
                    <Text style={s.changeBtn}>Change</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity style={s.trigger} onPress={openAcftModal} activeOpacity={0.7}>
                    <Text style={s.triggerTxt}>e.g. Cessna 172, Cirrus SR22…</Text>
                    <Feather name="chevron-right" size={15} color="#5A7A98" />
                  </TouchableOpacity>
                )}

                <PrimaryBtn label="Continue" onPress={goNext} />
              </View>
            )}

            {/* ── SCREEN 4: Preferences ─────────────────────────────────── */}
            {step === 3 && (
              <View>
                <Text style={s.eyebrow}>YOUR STYLE</Text>
                <Text style={s.title}>What kind of flying{'\n'}do you enjoy?</Text>
                <Text style={s.subtitle}>Select all that apply.</Text>

                <View style={s.prefGrid}>
                  {PREFERENCES.map(p => {
                    const active = interests.includes(p.id);
                    return (
                      <TouchableOpacity
                        key={p.id}
                        style={[s.prefChip, active && s.prefChipActive]}
                        onPress={() => toggleInterest(p.id)}
                        activeOpacity={0.75}
                      >
                        <MaterialCommunityIcons
                          name={p.icon}
                          size={22}
                          color={active ? SKY : '#6B83A0'}
                          style={{ marginBottom: 7 }}
                        />
                        <Text style={[s.prefTxt, active && s.prefTxtActive]}>
                          {p.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <PrimaryBtn label="Start Exploring" onPress={finish} loading={saving} />
              </View>
            )}


          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>

      {/* ── Airport search modal ──────────────────────────────────────────────── */}
      <Modal
        visible={airportModalOpen}
        animationType="slide"
        onRequestClose={() => setAirportModalOpen(false)}
      >
        <KeyboardAvoidingView
          style={s.modalRoot}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={s.modalHeader}>
            <TouchableOpacity
              onPress={() => setAirportModalOpen(false)}
              style={s.modalCancelWrap}
              activeOpacity={0.7}
            >
              <Text style={s.modalCancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={s.modalTitle}>Home Airport</Text>
            <View style={s.modalCancelWrap} />
          </View>

          <GlassSearchBar
            inputRef={apInputRef}
            value={apQuery}
            onChangeText={t => { setApQuery(t); setApResults(searchAirports(t)); }}
            placeholder="Search by ICAO, name, or city…"
            autoFocus
            style={s.glassBar}
          />

          <ScrollView
            style={s.modalList}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}
          >
            {apResults.map((a, i) => {
              const code = (a.icao || a.faa).toUpperCase();
              return (
                <TouchableOpacity
                  key={i}
                  style={[s.modalRow, i < apResults.length - 1 && s.modalRowBorder]}
                  onPress={() => selectAirport(a)}
                  activeOpacity={0.7}
                >
                  <Text style={s.modalCode}>{code}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={s.modalName} numberOfLines={1}>{a.name}</Text>
                    {a.city ? (
                      <Text style={s.modalSub}>
                        {a.city}{a.state ? `, ${a.state}` : ''}
                      </Text>
                    ) : null}
                  </View>
                </TouchableOpacity>
              );
            })}
            {apQuery.length >= 2 && apResults.length === 0 && (
              <Text style={s.modalHint}>No airports found for "{apQuery}"</Text>
            )}
            {apQuery.length < 2 && (
              <Text style={s.modalHint}>Type at least 2 characters to search</Text>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Aircraft search modal ─────────────────────────────────────────────── */}
      <Modal
        visible={acftModalOpen}
        animationType="slide"
        onRequestClose={() => setAcftModalOpen(false)}
      >
        <KeyboardAvoidingView
          style={s.modalRoot}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={s.modalHeader}>
            <TouchableOpacity
              onPress={() => setAcftModalOpen(false)}
              style={s.modalCancelWrap}
              activeOpacity={0.7}
            >
              <Text style={s.modalCancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={s.modalTitle}>Aircraft Type</Text>
            <View style={s.modalCancelWrap} />
          </View>

          <GlassSearchBar
            inputRef={acftInputRef}
            value={acftQuery}
            onChangeText={t => { setAcftQuery(t); setAcftResults(searchAircraft(t)); }}
            placeholder="e.g. Cessna 172, Cirrus SR22…"
            autoFocus
            autoCapitalize="words"
            style={s.glassBar}
          />

          <ScrollView
            style={s.modalList}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}
          >
            {acftResults.map((label, i) => (
              <TouchableOpacity
                key={i}
                style={[s.modalRow, i < acftResults.length - 1 && s.modalRowBorder]}
                onPress={() => selectAcft(label)}
                activeOpacity={0.7}
              >
                <MaterialCommunityIcons
                  name="airplane"
                  size={18}
                  color="#6B83A0"
                  style={{ width: 28 }}
                />
                <Text style={s.modalName}>{label}</Text>
              </TouchableOpacity>
            ))}

            {acftQuery.trim().length > 0 && (
              <TouchableOpacity
                style={[s.modalRow, s.customRow]}
                onPress={useCustomAcft}
                activeOpacity={0.7}
              >
                <Feather name="edit-2" size={16} color="#6B83A0" style={{ width: 28 }} />
                <View style={{ flex: 1 }}>
                  <Text style={s.customLabel}>Use "{acftQuery.trim()}"</Text>
                  <Text style={s.customSub}>Enter as custom aircraft</Text>
                </View>
              </TouchableOpacity>
            )}

            {!acftQuery && (
              <Text style={s.modalHint}>Type to search, or enter a custom aircraft name</Text>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({

  // ── Layout ────────────────────────────────────────────────────────────────
  root: { flex: 1, backgroundColor: '#060911' },
  body: { paddingHorizontal: 24, paddingBottom: 48 },

  // ── Header ────────────────────────────────────────────────────────────────
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 8, paddingVertical: 10,
  },
  headerSide: {
    width: 56, height: 36, alignItems: 'center', justifyContent: 'center',
  },
  skipTxt: { fontSize: 14, color: '#6B83A0', fontWeight: '600' },

  // ── Progress dots ─────────────────────────────────────────────────────────
  dots: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  dot: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: '#111D2C',
  },
  dotActive: {
    width: 24, borderRadius: 3,
    backgroundColor: SKY,
    shadowColor: SKY, shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.55, shadowRadius: 6,
  },
  dotDone: { backgroundColor: 'rgba(56,189,248,0.28)' },

  // ── Typography ────────────────────────────────────────────────────────────
  eyebrow: {
    fontSize: 11, fontWeight: '800', color: SKY,
    letterSpacing: 2.2, marginBottom: 14, marginTop: 8,
  },
  welcomeTitle: {
    fontSize: 38, fontWeight: '900', color: '#EDF3FB',
    letterSpacing: -1.0, lineHeight: 46, marginBottom: 18,
  },
  welcomeSub: {
    fontSize: 16, color: '#7A90AA', lineHeight: 26, marginBottom: 44,
  },
  title: {
    fontSize: 30, fontWeight: '900', color: '#EDF3FB',
    letterSpacing: -0.8, lineHeight: 38, marginBottom: 10,
  },
  subtitle: {
    fontSize: 14, color: '#7A90AA', lineHeight: 22, marginBottom: 28,
  },

  // ── Welcome icon ring ─────────────────────────────────────────────────────
  iconRing: {
    width: 76, height: 76, borderRadius: 38,
    backgroundColor: 'rgba(56,189,248,0.08)',
    borderWidth: 1, borderColor: 'rgba(56,189,248,0.20)',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 32, marginTop: 20,
    shadowColor: SKY, shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.22, shadowRadius: 20,
  },

  // ── Value screen bullets ──────────────────────────────────────────────────
  bulletList: { gap: 18, marginTop: 32, marginBottom: 44 },
  bulletRow:  { flexDirection: 'row', alignItems: 'center', gap: 16 },
  bulletIcon: {
    width: 42, height: 42, borderRadius: 13, flexShrink: 0,
    backgroundColor: 'rgba(56,189,248,0.08)',
    borderWidth: 1, borderColor: 'rgba(56,189,248,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  bulletTxt: { fontSize: 15, color: '#9AABBD', lineHeight: 22, flex: 1 },

  // ── Form fields ───────────────────────────────────────────────────────────
  fieldLabel: {
    fontSize: 10, fontWeight: '800', color: '#6B83A0',
    letterSpacing: 1.6, textTransform: 'uppercase', marginBottom: 10,
  },
  optionalLabel: { color: '#4A5B73', fontWeight: '700', letterSpacing: 1.4 },

  input: {
    backgroundColor: '#0A1220', borderRadius: 14,
    paddingHorizontal: 18, paddingVertical: 16,
    color: '#EDF3FB', fontSize: 20, fontWeight: '700',
    borderWidth: 1, borderColor: '#1E2D42',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.20, shadowRadius: 4, elevation: 2,
  },

  // Speed row: input + unit toggle
  speedRow: { flexDirection: 'row', gap: 10, marginBottom: 28 },
  unitToggle: {
    flexDirection: 'row',
    backgroundColor: '#0A1220',
    borderRadius: 14, borderWidth: 1, borderColor: '#1E2D42',
    overflow: 'hidden',
  },
  unitBtn: {
    paddingHorizontal: 18, paddingVertical: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  unitBtnActive: { backgroundColor: 'rgba(56,189,248,0.12)' },
  unitTxt:       { fontSize: 14, fontWeight: '600', color: '#6B83A0' },
  unitTxtActive: { color: SKY, fontWeight: '800' },

  // Pilot rating chips — horizontal wrap, matching pref chip aesthetic
  certRow:          { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 24 },
  certChip: {
    paddingVertical: 10, paddingHorizontal: 16,
    backgroundColor: '#0A1220', borderRadius: 12,
    borderWidth: 1, borderColor: '#1E2D42',
  },
  certChipActive: {
    backgroundColor: 'rgba(56,189,248,0.10)',
    borderColor: 'rgba(56,189,248,0.40)',
  },
  certChipTxt:       { fontSize: 13, fontWeight: '600', color: '#6B83A0' },
  certChipTxtActive: { color: '#EDF3FB', fontWeight: '700' },

  trigger: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#0A1220', borderRadius: 14,
    paddingHorizontal: 18, paddingVertical: 18,
    borderWidth: 1, borderColor: '#1E2D42', marginBottom: 24,
  },
  triggerTxt: { flex: 1, fontSize: 15, color: '#5A7A98' },

  selectedCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(4,120,87,0.08)', borderRadius: 14,
    padding: 16, borderWidth: 1, borderColor: 'rgba(52,211,153,0.28)',
    marginBottom: 24, gap: 12,
  },
  selectedPrimary:   { fontSize: 16, fontWeight: '700', color: '#34D399' },
  selectedSecondary: { fontSize: 12, color: '#6B83A0', marginTop: 2 },
  changeBtn:         { fontSize: 13, color: SKY, fontWeight: '600' },

  // ── Preference chips ──────────────────────────────────────────────────────
  prefGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 36 },
  prefChip: {
    width: '46%', flexGrow: 1,
    paddingVertical: 20, paddingHorizontal: 12,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 16, borderWidth: 1, borderColor: '#1E2D42',
    alignItems: 'center',
  },
  prefChipActive: {
    backgroundColor: 'rgba(56,189,248,0.08)',
    borderColor: 'rgba(56,189,248,0.30)',
  },
  prefTxt:       { fontSize: 13, fontWeight: '600', color: '#6B83A0', textAlign: 'center' },
  prefTxtActive: { color: '#EDF3FB', fontWeight: '700' },

  // ── Primary button ────────────────────────────────────────────────────────
  primaryBtn: {
    backgroundColor: SKY, borderRadius: 14,
    paddingVertical: 17, alignItems: 'center', overflow: 'hidden',
    shadowColor: SKY, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28, shadowRadius: 18, elevation: 8,
  },
  primaryBtnShine: {
    position: 'absolute', top: 0, left: 0, right: 0,
    height: 1, backgroundColor: 'rgba(255,255,255,0.20)',
  },
  primaryBtnTxt: { fontSize: 16, fontWeight: '800', color: '#030A14', letterSpacing: 0.2 },

  // ── Modals ────────────────────────────────────────────────────────────────
  modalRoot: { flex: 1, backgroundColor: '#060911' },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 60, paddingBottom: 12, paddingHorizontal: 16,
    borderBottomWidth: 1, borderBottomColor: '#1E2D42',
  },
  modalCancelWrap: { width: 70 },
  modalCancel:     { fontSize: 16, color: SKY, fontWeight: '500' },
  modalTitle:      { fontSize: 17, fontWeight: '700', color: '#EDF3FB' },
  glassBar:        { marginHorizontal: 16, marginBottom: 8 },
  modalList:       { flex: 1, paddingHorizontal: 16 },
  modalRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 16,
  },
  modalRowBorder: { borderBottomWidth: 1, borderBottomColor: '#1E2D42' },
  modalCode:      { fontSize: 15, fontWeight: '700', color: SKY, width: 52 },
  modalName:      { fontSize: 14, color: '#EDF3FB', fontWeight: '500' },
  modalSub:       { fontSize: 12, color: '#4A5B73', marginTop: 2 },
  modalHint:      { paddingVertical: 32, textAlign: 'center', color: '#5A7A98', fontSize: 13 },
  customRow:      { marginTop: 8, borderTopWidth: 1, borderTopColor: '#1E2D42' },
  customLabel:    { fontSize: 14, color: SKY, fontWeight: '600' },
  customSub:      { fontSize: 12, color: '#4A5B73', marginTop: 2 },
});
