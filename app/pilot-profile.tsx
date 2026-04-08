import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import airportsData from '../assets/images/airports.json';
import { GlassSearchBar } from '../components/GlassSearchBar';
import { MaterialCommunityIcons, Feather } from '@expo/vector-icons';

// ─── Airport search ───────────────────────────────────────────────────────────

interface AirportEntry {
  id: string;
  icao: string | null;
  faa: string;
  name: string;
  city: string;
  state: string;
}

function searchAirports(query: string): AirportEntry[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  return (airportsData as AirportEntry[])
    .filter(a => {
      const code = (a.icao || a.faa || '').toLowerCase();
      const name = (a.name || '').toLowerCase();
      const city = (a.city || '').toLowerCase();
      return code.startsWith(q) || name.includes(q) || city.includes(q);
    })
    .slice(0, 10);
}

// ─── Aircraft list ────────────────────────────────────────────────────────────
// Common GA aircraft. Users can always type a custom entry if theirs isn't here.

const AIRCRAFT_LIST = [
  // Cessna
  'Cessna 150', 'Cessna 152', 'Cessna 162 Skycatcher',
  'Cessna 172 Skyhawk', 'Cessna 175', 'Cessna 177 Cardinal',
  'Cessna 182 Skylane', 'Cessna 185 Skywagon',
  'Cessna 206 Stationair', 'Cessna 210 Centurion',
  'Cessna 310', 'Cessna 337 Skymaster', 'Cessna 340', 'Cessna 421 Golden Eagle',
  // Piper
  'Piper PA-18 Super Cub', 'Piper PA-22 Tri-Pacer', 'Piper PA-24 Comanche',
  'Piper PA-28 Cherokee', 'Piper PA-28-151 Warrior', 'Piper PA-28-181 Archer',
  'Piper PA-28R Arrow', 'Piper PA-32 Cherokee Six', 'Piper PA-32-301 Saratoga',
  'Piper PA-34 Seneca', 'Piper PA-44 Seminole',
  'Piper PA-46 Malibu', 'Piper PA-46 Meridian',
  // Beechcraft
  'Beechcraft V35 Bonanza', 'Beechcraft A36 Bonanza', 'Beechcraft 36TC Bonanza',
  'Beechcraft 33 Debonair', 'Beechcraft Musketeer', 'Beechcraft Sport',
  'Beechcraft Sundowner', 'Beechcraft Sierra',
  'Beechcraft Baron 55', 'Beechcraft Baron 58',
  'Beechcraft King Air 90', 'Beechcraft King Air 200',
  // Mooney
  'Mooney M20C Ranger', 'Mooney M20E Super 21', 'Mooney M20F Executive',
  'Mooney M20J 201', 'Mooney M20K 252', 'Mooney M20M Bravo',
  'Mooney M20R Ovation', 'Mooney M20TN Acclaim',
  // Cirrus
  'Cirrus SR20', 'Cirrus SR22', 'Cirrus SR22T',
  // Diamond
  'Diamond DA20 Katana', 'Diamond DA40 Star', 'Diamond DA40 NG',
  'Diamond DA42 Twin Star', 'Diamond DA62',
  // Grumman / American General
  'Grumman AA-5 Traveler', 'Grumman AA-5A Cheetah', 'Grumman AA-5B Tiger',
  // Van's Aircraft (homebuilt)
  "Van's RV-4", "Van's RV-6", "Van's RV-7", "Van's RV-8",
  "Van's RV-9", "Van's RV-10", "Van's RV-12", "Van's RV-14",
  // American Champion
  'American Champion Citabria 7GCBC', 'American Champion Decathlon 8KCAB',
  // Maule
  'Maule M-5 Lunar Rocket', 'Maule M-7 Super Rocket',
  // Socata
  'Socata TB-9 Tampico', 'Socata TB-10 Tobago',
  'Socata TB-20 Trinidad', 'Socata TB-21 Trinidad TC',
  // Columbia / Cessna TTx
  'Columbia 300', 'Columbia 350', 'Columbia 400', 'Cessna TTx',
  // Zenith / Kitfox
  'Zenith CH750', 'Kitfox Series 7',
];

function searchAircraft(query: string): string[] {
  const q = query.trim().toLowerCase();
  if (q.length < 1) return [];
  return AIRCRAFT_LIST.filter(a => a.toLowerCase().includes(q)).slice(0, 10);
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CERTIFICATES = [
  { id: 'student',    label: 'Student Pilot' },
  { id: 'private',   label: 'Private Pilot' },
  { id: 'instrument',label: 'Instrument Rated' },
  { id: 'commercial',label: 'Commercial' },
  { id: 'atp',       label: 'ATP' },
  { id: 'cfi',       label: 'CFI' },
];

// ─── Username validation ──────────────────────────────────────────────────────

function validateUsername(u: string): string | null {
  if (u.length === 0) return null; // optional — blank is fine
  if (u.length < 3)  return 'Too short — minimum 3 characters';
  if (u.length > 20) return 'Too long — maximum 20 characters';
  if (!/^[a-z0-9_]+$/.test(u)) return 'Only lowercase letters, numbers, and underscores';
  return null;
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function PilotProfileScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);

  const [name, setName]               = useState('');
  const [username, setUsername]         = useState('');
  const [originalUsername, setOriginalUsername] = useState('');
  const [usernameError, setUsernameError] = useState('');
  const [cruiseSpeed, setCruiseSpeed] = useState('');
  const [certificate, setCertificate] = useState('');

  // Airport state
  const [homeAirport, setHomeAirport]           = useState('');
  const [homeAirportName, setHomeAirportName]   = useState('');
  const [airportConfirmed, setAirportConfirmed] = useState(false);
  const [airportModalOpen, setAirportModalOpen] = useState(false);
  const [apQuery, setApQuery]                   = useState('');
  const [apResults, setApResults]               = useState<AirportEntry[]>([]);

  // Aircraft state
  const [aircraft, setAircraft]                 = useState('');
  const [acftConfirmed, setAcftConfirmed]       = useState(false);
  const [acftModalOpen, setAcftModalOpen]       = useState(false);
  const [acftQuery, setAcftQuery]               = useState('');
  const [acftResults, setAcftResults]           = useState<string[]>([]);

  // Dog preference
  const [fliesWithDogs, setFliesWithDogs] = useState(false);

  // Courtesy car crowdsourcing prompt
  const [courtesyOpen, setCourtesyOpen]       = useState(false);
  const [courtesyIcao, setCourtesyIcao]       = useState('');
  const [courtesySubmitting, setCourtesySubmitting] = useState(false);

  const apInputRef   = useRef<TextInput>(null);
  const acftInputRef = useRef<TextInput>(null);

  // ── Airport modal helpers ──────────────────────────────────────────────────

  function openAirportModal() {
    setApQuery(''); setApResults([]);
    setAirportModalOpen(true);
  }

  function handleApQuery(text: string) {
    setApQuery(text);
    setApResults(searchAirports(text));
  }

  function selectAirport(a: AirportEntry) {
    const code = (a.icao || a.faa).toUpperCase();
    setHomeAirport(code);
    setHomeAirportName(a.name);
    setAirportConfirmed(true);
    setAirportModalOpen(false);
    // Show the courtesy car prompt for this airport
    setCourtesyIcao(code);
    setCourtesyOpen(true);
  }

  async function submitCourtesyCar(hasIt: boolean) {
    setCourtesyOpen(false); // close immediately — don't make user wait
    setCourtesySubmitting(true);
    const payload = {
      icao:        courtesyIcao,
      available:   hasIt,
      notes:       hasIt ? 'Crew car available' : 'Not available',
      user_id:     user?.id ?? 'anonymous',
      reported_at: new Date().toISOString(),
    };
    console.log('[CourtesyCar] writing to crew_cars:', payload);
    try {
      const { error } = await supabase.from('crew_cars').insert(payload);
      if (error) console.warn('[CourtesyCar] insert error:', error.message);
      else console.log('[CourtesyCar] saved OK for', courtesyIcao);
    } catch (e: any) {
      console.warn('[CourtesyCar] exception:', e?.message ?? e);
    }
    setCourtesySubmitting(false);
  }

  // ── Aircraft modal helpers ─────────────────────────────────────────────────

  function openAcftModal() {
    setAcftQuery(''); setAcftResults([]);
    setAcftModalOpen(true);
  }

  function handleAcftQuery(text: string) {
    setAcftQuery(text);
    setAcftResults(searchAircraft(text));
  }

  function selectAcft(label: string) {
    setAircraft(label);
    setAcftConfirmed(true);
    setAcftModalOpen(false);
  }

  // Custom entry: saves whatever the user typed as-is
  function useCustomAcft() {
    const trimmed = acftQuery.trim();
    if (!trimmed) return;
    setAircraft(trimmed);
    setAcftConfirmed(true);
    setAcftModalOpen(false);
  }

  // ── Load / Save ────────────────────────────────────────────────────────────

  useEffect(() => {
    const key = `userProfile:${user?.id ?? 'guest'}`;
    if (__DEV__) console.log('[PilotProfile:load] reading key:', key);
    AsyncStorage.getItem(key).then(raw => {
      if (!raw) {
        if (__DEV__) console.log('[PilotProfile:load] no profile found at key:', key);
        return;
      }
      try {
        const p = JSON.parse(raw);
        if (__DEV__) console.log('[PilotProfile:load] certificate from storage:', JSON.stringify(p.certificate));
        if (p.name)              setName(p.name);
        if (p.username)          { setUsername(p.username); setOriginalUsername(p.username); }
        if (p.cruise_speed)      setCruiseSpeed(String(p.cruise_speed));
        if (p.certificate)       setCertificate(p.certificate);
        if (p.flies_with_dogs)   setFliesWithDogs(true);
        if (p.home_airport) {
          setHomeAirport(p.home_airport);
          setAirportConfirmed(true);
        }
        if (p.home_airport_name) setHomeAirportName(p.home_airport_name);
        if (p.aircraft_type) {
          setAircraft(p.aircraft_type);
          setAcftConfirmed(true);
        }
      } catch {}
    });
  }, [user?.id]);

  async function save() {
    setSaving(true);
    try {
      // ── Username validation + availability check ─────────────────────────
      const trimmedUsername = username.trim();
      if (trimmedUsername) {
        const validErr = validateUsername(trimmedUsername);
        if (__DEV__) console.log('[PilotProfile] username entered:', trimmedUsername, '| validation:', validErr ?? 'OK');
        if (validErr) { setUsernameError(validErr); setSaving(false); return; }
        // Only check availability if username actually changed
        if (trimmedUsername !== originalUsername && user) {
          const { data: taken } = await supabase
            .from('pilot_profiles')
            .select('user_id')
            .eq('username', trimmedUsername)
            .neq('user_id', user.id)
            .maybeSingle();
          if (__DEV__) console.log('[PilotProfile] username availability:', taken ? 'TAKEN' : 'AVAILABLE');
          if (taken) { setUsernameError('That username is already taken'); setSaving(false); return; }
        }
      }

      const storageKey = `userProfile:${user?.id ?? 'guest'}`;
      const existing = await AsyncStorage.getItem(storageKey);
      const prev = existing ? JSON.parse(existing) : {};

      const updated = {
        ...prev,
        name,
        username:          trimmedUsername || prev.username || null,
        aircraft_type:     aircraft,
        cruise_speed:      cruiseSpeed ? parseInt(cruiseSpeed) : prev.cruise_speed ?? null,
        home_airport:      homeAirport,
        home_airport_name: homeAirportName,
        certificate,
        flies_with_dogs: fliesWithDogs,
      };

      if (__DEV__) console.log('[PilotProfile:save] certificate:', certificate, '| cruise_speed:', cruiseSpeed, '→', updated.cruise_speed, '| key:', storageKey);
      await AsyncStorage.setItem(storageKey, JSON.stringify(updated));
      if (__DEV__) console.log('[PilotProfile:save] AsyncStorage saved OK');
      // Persist to Supabase — only columns confirmed to exist in pilot_profiles.
      if (user) {
        try {
          const dbPayload: Record<string, any> = {
            user_id:       user.id,
            name:          updated.name,
            username:      updated.username,
            home_airport:  updated.home_airport,
            certificate:   updated.certificate || null,
            aircraft_type: updated.aircraft_type || null,
          };
          // flies_with_dogs column may not exist yet — add only if set
          if (updated.flies_with_dogs) dbPayload.flies_with_dogs = true;
          const { error: upsertErr } = await supabase.from('pilot_profiles').upsert(dbPayload);
          if (upsertErr) {
            console.warn('[PilotProfile] Supabase upsert failed:', upsertErr.message);
          } else {
            if (__DEV__) console.log('[PilotProfile] Supabase upsert OK — username saved:', updated.username);
          }
        } catch (e: any) {
          if (__DEV__) console.warn('[PilotProfile] Supabase upsert exception:', e?.message);
        }
      }
      router.back();
    } finally {
      setSaving(false);
    }
  }

  const canSave = name.trim().length > 0 && !usernameError;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Text style={styles.backArrow}>‹</Text>
          <Text style={styles.backLabel}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Pilot Information</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Section: Profile Info ─────────────────────────────────────────── */}
        <Text style={styles.sectionHeader}>PROFILE INFO</Text>

        {/* Name */}
        <Text style={styles.fieldLabel}>NAME</Text>
        <TextInput
          style={styles.input}
          placeholder="Your name"
          placeholderTextColor="#5A7A98"
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
        />

        {/* Username */}
        <Text style={styles.fieldLabel}>USERNAME</Text>
        <TextInput
          style={[styles.input, usernameError ? styles.inputError : null]}
          placeholder="e.g. mitchellcain  (letters, numbers, _)"
          placeholderTextColor="#5A7A98"
          value={username}
          onChangeText={text => {
            const clean = text.toLowerCase().replace(/[^a-z0-9_]/g, '');
            setUsername(clean);
            setUsernameError(validateUsername(clean) ?? '');
          }}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={20}
        />
        {usernameError ? (
          <Text style={styles.fieldError}>{usernameError}</Text>
        ) : username.length >= 3 ? (
          <Text style={styles.fieldHint}>@{username}</Text>
        ) : null}

        {/* Pilot Rating */}
        <Text style={styles.fieldLabel}>PILOT RATING</Text>
        <View style={styles.certList}>
          {CERTIFICATES.map(item => (
            <TouchableOpacity
              key={item.id}
              style={[styles.certItem, certificate === item.id && styles.certItemActive]}
              onPress={() => setCertificate(item.id)}
              activeOpacity={0.7}
            >
              <Text style={[styles.certLabel, certificate === item.id && styles.certLabelActive]}>
                {item.label}
              </Text>
              {certificate === item.id && <Text style={styles.checkmark}>✓</Text>}
            </TouchableOpacity>
          ))}
        </View>

        {/* ── Section: Aircraft ─────────────────────────────────────────────── */}
        <Text style={styles.sectionHeader}>AIRCRAFT</Text>

        {/* Home Airport */}
        <Text style={styles.fieldLabel}>HOME AIRPORT</Text>
        {airportConfirmed ? (
          <TouchableOpacity style={styles.selectedCard} onPress={() => { setAirportConfirmed(false); openAirportModal(); }} activeOpacity={0.8}>
            <View style={{ flex: 1 }}>
              <Text style={styles.selectedPrimary}>{homeAirport}</Text>
              {homeAirportName ? <Text style={styles.selectedSecondary} numberOfLines={1}>{homeAirportName}</Text> : null}
            </View>
            <Text style={styles.changeBtn}>Change</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.triggerBtn} onPress={openAirportModal} activeOpacity={0.7}>
            <Text style={styles.triggerText}>Search by ICAO, name, or city…</Text>
            <Text style={styles.triggerChevron}>›</Text>
          </TouchableOpacity>
        )}

        {/* Aircraft */}
        <Text style={styles.fieldLabel}>AIRCRAFT</Text>
        {acftConfirmed ? (
          <TouchableOpacity style={styles.selectedCard} onPress={() => { setAcftConfirmed(false); openAcftModal(); }} activeOpacity={0.8}>
            <Text style={[styles.selectedPrimary, { flex: 1 }]} numberOfLines={1}>{aircraft}</Text>
            <Text style={styles.changeBtn}>Change</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.triggerBtn} onPress={openAcftModal} activeOpacity={0.7}>
            <Text style={styles.triggerText}>Search or enter aircraft…</Text>
            <Text style={styles.triggerChevron}>›</Text>
          </TouchableOpacity>
        )}

        {/* Cruise Speed */}
        <Text style={styles.fieldLabel}>CRUISE SPEED (KTS)</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. 150"
          placeholderTextColor="#5A7A98"
          value={cruiseSpeed}
          onChangeText={setCruiseSpeed}
          keyboardType="numeric"
        />

        {/* Flying with Dogs */}
        <Text style={styles.fieldLabel}>FLYING WITH DOGS</Text>
        <TouchableOpacity
          style={[styles.dogToggle, fliesWithDogs && styles.dogToggleActive]}
          onPress={() => setFliesWithDogs(!fliesWithDogs)}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons name="dog-side" size={20} color={fliesWithDogs ? '#0D9488' : '#4A5B73'} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.dogToggleText, fliesWithDogs && styles.dogToggleTextActive]}>
              I fly with my dog
            </Text>
            <Text style={styles.dogToggleSub}>Highlights dog-friendly airports in Discover</Text>
          </View>
          {fliesWithDogs && <Text style={styles.checkmark}>&#10003;</Text>}
        </TouchableOpacity>

        {/* Save */}
        <TouchableOpacity
          style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}
          onPress={save}
          disabled={!canSave || saving}
          activeOpacity={0.8}
        >
          {saving
            ? <ActivityIndicator color="#0D1421" />
            : <Text style={styles.saveBtnText}>Save Profile</Text>
          }
        </TouchableOpacity>
      </ScrollView>

      {/* ── Airport search modal ─────────────────────────────────────────────── */}
      <Modal visible={airportModalOpen} animationType="slide" onRequestClose={() => setAirportModalOpen(false)}>
        <KeyboardAvoidingView style={styles.modalContainer} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setAirportModalOpen(false)} style={styles.modalCancelWrap} activeOpacity={0.7}>
              <Text style={styles.modalCancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Home Airport</Text>
            <View style={styles.modalCancelWrap} />
          </View>

          <GlassSearchBar
            inputRef={apInputRef}
            value={apQuery}
            onChangeText={handleApQuery}
            placeholder="Search by ICAO, name, or city…"
            autoFocus
            style={styles.glassBar}
          />

          <ScrollView style={styles.modalResults} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {apResults.map((a, i) => {
              const code = (a.icao || a.faa).toUpperCase();
              return (
                <TouchableOpacity
                  key={i}
                  style={[styles.modalRow, i < apResults.length - 1 && styles.modalRowBorder]}
                  onPress={() => selectAirport(a)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.modalRowCode}>{code}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.modalRowName} numberOfLines={1}>{a.name}</Text>
                    {a.city ? <Text style={styles.modalRowSub}>{a.city}{a.state ? `, ${a.state}` : ''}</Text> : null}
                  </View>
                </TouchableOpacity>
              );
            })}
            {apQuery.length >= 2 && apResults.length === 0 && (
              <Text style={styles.modalEmpty}>No airports found for "{apQuery}"</Text>
            )}
            {apQuery.length < 2 && (
              <Text style={styles.modalHint}>Type at least 2 characters to search</Text>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Aircraft search modal ─────────────────────────────────────────────── */}
      <Modal visible={acftModalOpen} animationType="slide" onRequestClose={() => setAcftModalOpen(false)}>
        <KeyboardAvoidingView style={styles.modalContainer} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setAcftModalOpen(false)} style={styles.modalCancelWrap} activeOpacity={0.7}>
              <Text style={styles.modalCancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Aircraft</Text>
            <View style={styles.modalCancelWrap} />
          </View>

          <GlassSearchBar
            inputRef={acftInputRef}
            value={acftQuery}
            onChangeText={handleAcftQuery}
            placeholder="e.g. Mooney M20C, Cessna 172…"
            autoFocus
            autoCapitalize="words"
            style={styles.glassBar}
          />

          <ScrollView style={styles.modalResults} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {acftResults.map((label, i) => (
              <TouchableOpacity
                key={i}
                style={[styles.modalRow, i < acftResults.length - 1 && styles.modalRowBorder]}
                onPress={() => selectAcft(label)}
                activeOpacity={0.7}
              >
                <MaterialCommunityIcons name="airplane" size={20} color="#6B83A0" style={{ width: 28, textAlign: 'center' }} />
                <Text style={styles.modalRowName}>{label}</Text>
              </TouchableOpacity>
            ))}

            {/* Custom entry — always shown once the user has typed something */}
            {acftQuery.trim().length > 0 && (
              <TouchableOpacity
                style={[styles.modalRow, styles.customEntryRow]}
                onPress={useCustomAcft}
                activeOpacity={0.7}
              >
                <Feather name="edit-2" size={18} color="#6B83A0" style={{ width: 28, textAlign: 'center' }} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.customEntryLabel}>Use "{acftQuery.trim()}"</Text>
                  <Text style={styles.customEntrySub}>Enter as custom aircraft</Text>
                </View>
              </TouchableOpacity>
            )}

            {acftQuery.length === 0 && (
              <Text style={styles.modalHint}>Type to search, or enter a custom aircraft name</Text>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Courtesy car crowdsourcing prompt ──────────────────────────────── */}
      <Modal
        visible={courtesyOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setCourtesyOpen(false)}
      >
        <View style={styles.courtesyOverlay}>
          <View style={styles.courtesyCard}>
            <MaterialCommunityIcons name="car" size={36} color="#6B83A0" style={{ marginBottom: 12 }} />
            <Text style={styles.courtesyHeading}>Help other pilots</Text>
            <Text style={styles.courtesyQuestion}>
              Does <Text style={styles.courtesyIcaoText}>{courtesyIcao}</Text> have a crew car?
            </Text>

            <View style={styles.courtesyBtns}>
              <TouchableOpacity style={[styles.courtesyBtn, styles.courtesyBtnYes]} onPress={() => submitCourtesyCar(true)} activeOpacity={0.8} disabled={courtesySubmitting}>
                <Text style={styles.courtesyBtnText}>Yes</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.courtesyBtn, styles.courtesyBtnNo]} onPress={() => submitCourtesyCar(false)} activeOpacity={0.8} disabled={courtesySubmitting}>
                <Text style={styles.courtesyBtnText}>No</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity onPress={() => setCourtesyOpen(false)} activeOpacity={0.7} style={styles.courtesySkip}>
              <Text style={styles.courtesySkipText}>Not sure — skip</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: '#060B16' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 60, paddingBottom: 12, paddingHorizontal: 16,
    borderBottomWidth: 1, borderBottomColor: '#1E3A5F',
  },
  backBtn:     { flexDirection: 'row', alignItems: 'center', width: 80 },
  backArrow:   { fontSize: 28, color: '#38BDF8', lineHeight: 32, marginRight: 2 },
  backLabel:   { fontSize: 16, color: '#38BDF8', fontWeight: '500' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#F0F4FF' },
  scroll:      { flex: 1 },
  content:     { padding: 20, paddingBottom: 60 },
  sectionHeader: {
    fontSize: 11, fontWeight: '700', color: '#38BDF8',
    letterSpacing: 1.5, textTransform: 'uppercase',
    marginBottom: 16, marginTop: 8,
  },
  fieldLabel: {
    fontSize: 11, fontWeight: '700', color: '#6B83A0',
    letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 10,
  },
  input: {
    backgroundColor: '#0A1628', borderRadius: 14, paddingHorizontal: 18,
    paddingVertical: 16, color: '#F0F4FF', fontSize: 16,
    borderWidth: 1, borderColor: '#1E3A5F', marginBottom: 24,
  },
  inputError:  { borderColor: '#F87171' },
  fieldError:  { fontSize: 12, color: '#F87171', fontWeight: '500', marginBottom: 16, marginTop: -18, paddingHorizontal: 4 },
  fieldHint:   { fontSize: 12, color: '#38BDF8', fontWeight: '500', marginBottom: 16, marginTop: -18, paddingHorizontal: 4 },
  certList:        { gap: 8, marginBottom: 24 },
  certItem: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#0A1628', borderRadius: 12, padding: 16,
    borderWidth: 1, borderColor: '#1E3A5F',
  },
  certItemActive:  { backgroundColor: '#0D1E35', borderColor: '#38BDF8' },
  certLabel:       { fontSize: 15, fontWeight: '600', color: '#6B83A0' },
  certLabelActive: { color: '#F0F4FF', fontWeight: '700' },
  checkmark:       { fontSize: 16, color: '#38BDF8', fontWeight: '800' },
  dogToggle: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: '#0A1628', borderRadius: 12, padding: 16,
    borderWidth: 1, borderColor: '#1E3A5F', marginBottom: 24,
  },
  dogToggleActive: { backgroundColor: 'rgba(13,148,136,0.08)', borderColor: 'rgba(13,148,136,0.30)' },
  dogToggleText: { fontSize: 15, fontWeight: '600', color: '#4A5B73' },
  dogToggleTextActive: { color: '#F0F4FF', fontWeight: '700' },
  dogToggleSub: { fontSize: 11, color: '#4A5B73', marginTop: 2 },
  saveBtn: {
    backgroundColor: '#38BDF8', borderRadius: 16,
    paddingVertical: 18, alignItems: 'center', marginTop: 8,
  },
  saveBtnDisabled: { opacity: 0.35 },
  saveBtnText:     { color: '#0D1421', fontSize: 16, fontWeight: '800' },

  // Shared trigger / confirmed card styles (used by both Airport and Aircraft)
  triggerBtn: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#0A1628', borderRadius: 14, paddingHorizontal: 18,
    paddingVertical: 18, borderWidth: 1, borderColor: '#1E3A5F', marginBottom: 24,
  },
  triggerText:    { flex: 1, fontSize: 16, color: '#5A7A98' },
  triggerChevron: { fontSize: 22, color: '#5A7A98', fontWeight: '300' },
  selectedCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#091A10', borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: '#2A6B40', marginBottom: 24, gap: 12,
  },
  selectedPrimary:   { fontSize: 16, fontWeight: '700', color: '#34D399' },
  selectedSecondary: { fontSize: 12, color: '#8A9BB5', marginTop: 2 },
  changeBtn:         { fontSize: 13, color: '#38BDF8', fontWeight: '600' },

  // Shared modal styles
  modalContainer: { flex: 1, backgroundColor: '#060B16' },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 60, paddingBottom: 12, paddingHorizontal: 16,
    borderBottomWidth: 1, borderBottomColor: '#1E3A5F',
  },
  modalCancelWrap: { width: 70 },
  modalCancel:     { fontSize: 16, color: '#38BDF8', fontWeight: '500' },
  modalTitle:      { fontSize: 17, fontWeight: '700', color: '#F0F4FF' },
  modalSearchWrap: { padding: 16, paddingBottom: 8 },
  glassBar: { marginHorizontal: 16, marginBottom: 8 },
  modalInput: {
    backgroundColor: '#0A1628', borderRadius: 14, paddingHorizontal: 18,
    paddingVertical: 16, color: '#F0F4FF', fontSize: 16,
    borderWidth: 1, borderColor: '#1E3A5F',
  },
  modalResults:    { flex: 1, paddingHorizontal: 16 },
  modalRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 16,
  },
  modalRowBorder:  { borderBottomWidth: 1, borderBottomColor: '#1E3A5F' },
  modalRowCode:    { fontSize: 15, fontWeight: '700', color: '#38BDF8', width: 52 },
  modalRowName:    { fontSize: 14, color: '#E0E8F5', fontWeight: '500' },
  modalRowSub:     { fontSize: 12, color: '#4A5B73', marginTop: 2 },
  modalEmpty:      { paddingVertical: 32, textAlign: 'center', color: '#4A5B73', fontSize: 14 },
  modalHint:       { paddingVertical: 32, textAlign: 'center', color: '#5A7A98', fontSize: 13 },

  // Aircraft-specific modal row styles
  acftIcon:        { fontSize: 20, width: 28, textAlign: 'center' },
  customEntryRow:  { marginTop: 8, borderTopWidth: 1, borderTopColor: '#1E3A5F' },
  customEntryLabel:{ fontSize: 14, color: '#38BDF8', fontWeight: '600' },
  customEntrySub:  { fontSize: 12, color: '#4A5B73', marginTop: 2 },

  // Courtesy car prompt
  courtesyOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center', justifyContent: 'center', padding: 32,
  },
  courtesyCard: {
    width: '100%', backgroundColor: '#0A1628',
    borderRadius: 22, borderWidth: 1, borderColor: '#1E3A5F',
    padding: 28, alignItems: 'center',
  },
  courtesyEmoji:    { fontSize: 36, marginBottom: 12 },
  courtesyHeading:  { fontSize: 13, fontWeight: '700', color: '#4A5B73', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 10 },
  courtesyQuestion: { fontSize: 17, fontWeight: '600', color: '#E0E8F5', textAlign: 'center', lineHeight: 24, marginBottom: 24 },
  courtesyIcaoText: { color: '#38BDF8', fontWeight: '800' },
  courtesyBtns:     { flexDirection: 'row', gap: 12, width: '100%', marginBottom: 16 },
  courtesyBtn:      { flex: 1, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  courtesyBtnYes:   { backgroundColor: '#34D399' },
  courtesyBtnNo:    { backgroundColor: '#EF4444' },
  courtesyBtnText:  { fontSize: 16, fontWeight: '800', color: '#0D1421' },
  courtesySkip:     { paddingVertical: 8 },
  courtesySkipText: { fontSize: 14, color: '#4A5B73' },
});
