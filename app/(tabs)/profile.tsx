import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Alert, Image, Modal, ScrollView, StyleSheet, Text,
  TextInput, TouchableOpacity, View
} from 'react-native';
import { supabase } from '../../lib/supabase';

const CERTIFICATES = ['Student', 'PPL', 'IR', 'CPL', 'CFII', 'ATP'];
const INTERESTS = ['🍔 Food', '⛳ Golf', '🏖 Beach', '🏔 Mountains', '🎭 Culture', '🏕 Camping', '🌆 Cities', '🍷 Wine'];

export default function ProfileScreen() {
  const router = useRouter();
  const [profile, setProfile] = useState<any>(null);
  const [bucketList, setBucketList] = useState<any[]>([]);
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState<any>({});
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [addingAircraft, setAddingAircraft] = useState(false);
  const [newAircraft, setNewAircraft] = useState({ year: '', make: '', model: '', tail: '', hours: '' });

  useEffect(() => {
    loadProfile();
    loadBucketList();
  }, []);

async function loadProfile() {
  const data = await AsyncStorage.getItem('userProfile');
  const photo = await AsyncStorage.getItem('profilePhoto');
  if (data) {
    const parsed = JSON.parse(data);
    console.log('cert raw:', JSON.stringify(parsed.certificate));
    setProfile(parsed);
  }
  if (photo) setPhotoUri(photo);
}
  async function loadBucketList() {
    const { data } = await supabase.from('bucket_list').select('*').eq('user_id', 'mitchell');
    if (data) setBucketList(data);
  }

  async function saveProfile() {
    const updated = { ...profile, ...editData };
    setProfile(updated);
    await AsyncStorage.setItem('userProfile', JSON.stringify(updated));
    await supabase.from('pilot_profiles').upsert({ user_id: 'mitchell', ...updated });
    setEditing(false);
  }

  async function pickPhoto() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled) {
      setPhotoUri(result.assets[0].uri);
      await AsyncStorage.setItem('profilePhoto', result.assets[0].uri);
    }
  }

  async function addAircraft() {
    if (!newAircraft.make || !newAircraft.model) return;
    const aircraft = profile?.aircraft || [];
    const updated = [...aircraft, newAircraft];
    const newProfile = { ...profile, aircraft: updated };
    setProfile(newProfile);
    await AsyncStorage.setItem('userProfile', JSON.stringify(newProfile));
    setNewAircraft({ year: '', make: '', model: '', tail: '', hours: '' });
    setAddingAircraft(false);
  }

  function importLogbook() {
    Alert.alert('Coming Soon', 'A new way to view your past adventures coming soon');
  }

function getCertLabel() {
  const certs = profile?.certificate;
  if (!certs) return 'Pilot';
  if (Array.isArray(certs)) return certs.join(' • ');
  if (typeof certs === 'string') {
    // Was saved as a single word like "private" from onboarding
    const map: any = {
      private: 'PPL', instrument: 'IR', commercial: 'CPL',
      cfi: 'CFI', cfii: 'CFII', atp: 'ATP'
    };
    return map[certs.toLowerCase()] || certs.toUpperCase();
  }
  return 'Pilot';
}

  const stats = [
    { label: 'Total Hours', value: profile?.total_hours || '—', icon: '⏱' },
    { label: 'Airports Visited', value: profile?.airports_visited || bucketList.length || '—', icon: '🛬' },
    { label: 'States Flown', value: profile?.states_flown || '—', icon: '🗺' },
    { label: 'Distance Flown', value: profile?.distance_nm ? `${Number(profile.distance_nm).toLocaleString()} nm` : '—', icon: '📏' },
  ];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={pickPhoto} style={styles.photoWrap}>
          {photoUri ? (
            <Image source={{ uri: photoUri }} style={styles.photo} />
          ) : (
            <View style={styles.photoPlaceholder}>
              <Text style={styles.photoEmoji}>✈️</Text>
            </View>
          )}
          <View style={styles.photoEdit}><Text style={{ fontSize: 12 }}>📷</Text></View>
        </TouchableOpacity>

        <View style={styles.headerInfo}>
          <Text style={styles.name}>{profile?.name || 'Your Name'}</Text>
          <Text style={styles.cert}>{getCertLabel()}</Text>
          {profile?.aircraft?.[0] && (
            <Text style={styles.aircraftLabel}>
              ✈️ {profile.aircraft[0].year} {profile.aircraft[0].make} {profile.aircraft[0].model}
            </Text>
          )}
          {profile?.home_airport && (
            <Text style={styles.homeAirport}>🏠 {profile.home_airport}</Text>
          )}
        </View>

        <TouchableOpacity style={styles.editBtn} onPress={() => { setEditData(profile || {}); setEditing(true); }}>
          <Text style={styles.editBtnText}>Edit</Text>
        </TouchableOpacity>
      </View>

      {/* Stats */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>FLIGHT STATS</Text>
        <View style={styles.statsGrid}>
          {stats.map(s => (
            <View key={s.label} style={styles.statCard}>
              <Text style={styles.statIcon}>{s.icon}</Text>
              <Text style={styles.statValue}>{s.value}</Text>
              <Text style={styles.statLabel}>{s.label}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Logbook Import */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>LOGBOOK</Text>
          {profile?.total_hours && (
            <TouchableOpacity onPress={importLogbook}>
              <Text style={styles.addBtn}>Re-import</Text>
            </TouchableOpacity>
          )}
        </View>
        {profile?.total_hours ? (
          <View style={styles.logbookCard}>
            <Text style={styles.logbookImported}>✅ ForeFlight logbook imported</Text>
            <Text style={styles.logbookDetail}>{profile.total_hours} hrs · {profile.airports_visited} airports · {Number(profile.distance_nm || 0).toLocaleString()} nm</Text>
          </View>
        ) : (
          <TouchableOpacity style={styles.logbookImportBtn} onPress={importLogbook}>
            <Text style={styles.logbookImportIcon}>📒</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.logbookImportTitle}>Import ForeFlight Logbook</Text>
              <Text style={styles.logbookImportSub}>Coming soon</Text>
            </View>
            <Text style={styles.logbookImportArrow}>→</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Aircraft */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>AIRCRAFT</Text>
          <TouchableOpacity onPress={() => setAddingAircraft(true)}>
            <Text style={styles.addBtn}>+ Add</Text>
          </TouchableOpacity>
        </View>
        {(profile?.aircraft || []).length === 0 ? (
          <TouchableOpacity style={styles.emptyCard} onPress={() => setAddingAircraft(true)}>
            <Text style={styles.emptyText}>+ Add your aircraft</Text>
          </TouchableOpacity>
        ) : (
          (profile?.aircraft || []).map((ac: any, i: number) => (
            <View key={i} style={styles.aircraftCard}>
              <View style={styles.aircraftIcon}>
                <Text style={{ fontSize: 24 }}>✈️</Text>
              </View>
              <View style={styles.aircraftInfo}>
                <Text style={styles.aircraftName}>{ac.year} {ac.make} {ac.model}</Text>
                {ac.tail && <Text style={styles.aircraftTail}>{ac.tail}</Text>}
                {ac.hours && <Text style={styles.aircraftHours}>{ac.hours} hrs in type</Text>}
              </View>
            </View>
          ))
        )}
      </View>

      {/* Bucket List */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>BUCKET LIST</Text>
          <TouchableOpacity onPress={() => router.push('/(tabs)/bucketlist')}>
            <Text style={styles.addBtn}>See All →</Text>
          </TouchableOpacity>
        </View>
        {bucketList.slice(0, 5).map((a, i) => (
          <TouchableOpacity
            key={i}
            style={styles.bucketItem}
            onPress={() => router.push({ pathname: '/airport', params: { icao: a.icao, name: a.name, city: a.city, state: a.state, lat: a.lat, lng: a.lng, elevation: a.elevation, fuel: a.fuel } })}
          >
            <Text style={styles.bucketStar}>⭐</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.bucketName}>{a.name}</Text>
              <Text style={styles.bucketCity}>{a.city}, {a.state}</Text>
            </View>
            <Text style={styles.bucketIcao}>{a.icao}</Text>
          </TouchableOpacity>
        ))}
        {bucketList.length === 0 && (
          <Text style={styles.emptyText}>No airports saved yet. Start exploring!</Text>
        )}
      </View>

      {/* Achievements */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>ACHIEVEMENTS</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingVertical: 4 }}>
          {[
            { icon: '🏆', label: 'First Flight', unlocked: true },
            { icon: '🗺', label: '10 Airports', unlocked: (profile?.airports_visited || 0) >= 10 },
            { icon: '⏱', label: '100 Hours', unlocked: (profile?.total_hours || 0) >= 100 },
            { icon: '🌎', label: '10 States', unlocked: (profile?.states_flown || 0) >= 10 },
            { icon: '🌙', label: 'Night Flyer', unlocked: false },
            { icon: '🌊', label: 'Coast to Coast', unlocked: false },
          ].map((a, i) => (
            <View key={i} style={[styles.achievement, !a.unlocked && styles.achievementLocked]}>
              <Text style={{ fontSize: 28 }}>{a.icon}</Text>
              <Text style={[styles.achievementLabel, !a.unlocked && styles.achievementLabelLocked]}>{a.label}</Text>
            </View>
          ))}
        </ScrollView>
      </View>

      {/* Edit Modal */}
      <Modal visible={editing} animationType="slide" presentationStyle="pageSheet">
        <ScrollView style={styles.modal} contentContainerStyle={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Edit Profile</Text>
            <TouchableOpacity onPress={() => setEditing(false)}>
              <Text style={styles.modalClose}>Cancel</Text>
            </TouchableOpacity>
          </View>

          {[
            { label: 'Name', key: 'name', placeholder: 'Your name' },
            { label: 'Home Airport', key: 'home_airport', placeholder: 'KSTL' },
            { label: 'Total Hours', key: 'total_hours', placeholder: '500', keyboard: 'numeric' },
            { label: 'Airports Visited', key: 'airports_visited', placeholder: '72', keyboard: 'numeric' },
            { label: 'States Flown', key: 'states_flown', placeholder: '18', keyboard: 'numeric' },
            { label: 'Distance Flown (nm)', key: 'distance_nm', placeholder: '127000', keyboard: 'numeric' },
            { label: 'Bio', key: 'bio', placeholder: 'Tell other pilots about yourself...' },
          ].map(field => (
            <View key={field.key} style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>{field.label}</Text>
              <TextInput
                style={styles.fieldInput}
                value={editData[field.key]?.toString() || ''}
                onChangeText={v => setEditData((p: any) => ({ ...p, [field.key]: v }))}
                placeholder={field.placeholder}
                placeholderTextColor="#4A5B73"
                keyboardType={(field as any).keyboard || 'default'}
              />
            </View>
          ))}

          <Text style={styles.fieldLabel}>Certificates</Text>
          <View style={styles.certGrid}>
            {CERTIFICATES.map(c => (
              <TouchableOpacity
                key={c}
                style={[styles.certChip, (editData.certificate || []).includes(c) && styles.certChipActive]}
                onPress={() => {
                  const cur = editData.certificate || [];
                  setEditData((p: any) => ({ ...p, certificate: cur.includes(c) ? cur.filter((x: string) => x !== c) : [...cur, c] }));
                }}
              >
                <Text style={[styles.certChipText, (editData.certificate || []).includes(c) && styles.certChipTextActive]}>{c}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity style={styles.saveBtn} onPress={saveProfile}>
            <Text style={styles.saveBtnText}>Save Profile</Text>
          </TouchableOpacity>
        </ScrollView>
      </Modal>

      {/* Add Aircraft Modal */}
      <Modal visible={addingAircraft} animationType="slide" presentationStyle="pageSheet">
        <ScrollView style={styles.modal} contentContainerStyle={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Add Aircraft</Text>
            <TouchableOpacity onPress={() => setAddingAircraft(false)}>
              <Text style={styles.modalClose}>Cancel</Text>
            </TouchableOpacity>
          </View>
          {[
            { label: 'Year', key: 'year', placeholder: '1965' },
            { label: 'Make', key: 'make', placeholder: 'Mooney' },
            { label: 'Model', key: 'model', placeholder: 'M20C' },
            { label: 'Tail Number', key: 'tail', placeholder: 'N2578W' },
            { label: 'Hours in Type', key: 'hours', placeholder: '420' },
          ].map(field => (
            <View key={field.key} style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>{field.label}</Text>
              <TextInput
                style={styles.fieldInput}
                value={newAircraft[field.key as keyof typeof newAircraft]}
                onChangeText={v => setNewAircraft(p => ({ ...p, [field.key]: v }))}
                placeholder={field.placeholder}
                placeholderTextColor="#4A5B73"
              />
            </View>
          ))}
          <TouchableOpacity style={styles.saveBtn} onPress={addAircraft}>
            <Text style={styles.saveBtnText}>Add Aircraft</Text>
          </TouchableOpacity>
        </ScrollView>
      </Modal>

      {/* DEBUG: Reset Storage */}
      <TouchableOpacity onPress={async () => {
        await AsyncStorage.removeItem('userProfile');
        await AsyncStorage.removeItem('onboardingComplete');
        Alert.alert('Cleared!', 'Restart the app');
      }} style={{ padding: 20 }}>
        <Text style={{ color: 'red' }}>Reset Profile</Text>
      </TouchableOpacity>

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#070B14' },
  content: { paddingBottom: 100 },
  header: { flexDirection: 'row', alignItems: 'flex-start', padding: 20, paddingTop: 70, gap: 16 },
  photoWrap: { position: 'relative' },
  photo: { width: 80, height: 80, borderRadius: 40, borderWidth: 2, borderColor: '#38BDF8' },
  photoPlaceholder: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#0D1421', borderWidth: 2, borderColor: '#1E2D45', alignItems: 'center', justifyContent: 'center' },
  photoEmoji: { fontSize: 32 },
  photoEdit: { position: 'absolute', bottom: 0, right: 0, backgroundColor: '#38BDF8', borderRadius: 10, padding: 4 },
  headerInfo: { flex: 1 },
  name: { fontSize: 22, fontWeight: '700', color: '#F0F4FF', marginBottom: 4 },
  cert: { fontSize: 13, color: '#38BDF8', fontWeight: '600', marginBottom: 4 },
  aircraftLabel: { fontSize: 13, color: '#8A9BB5', marginBottom: 2 },
  homeAirport: { fontSize: 13, color: '#8A9BB5' },
  editBtn: { backgroundColor: '#1E2D45', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  editBtnText: { color: '#38BDF8', fontSize: 13, fontWeight: '600' },
  section: { paddingHorizontal: 20, marginBottom: 28 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  sectionTitle: { fontSize: 11, fontWeight: '700', color: '#4A5B73', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 14 },
  addBtn: { fontSize: 13, color: '#38BDF8', fontWeight: '600' },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  statCard: { width: '47%', backgroundColor: '#0D1421', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#1E2D45', alignItems: 'center' },
  statIcon: { fontSize: 24, marginBottom: 8 },
  statValue: { fontSize: 24, fontWeight: '700', color: '#F0F4FF', marginBottom: 4 },
  statLabel: { fontSize: 11, color: '#4A5B73', textAlign: 'center' },
  aircraftCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0D1421', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: '#1E2D45', marginBottom: 10, gap: 14 },
  aircraftIcon: { width: 48, height: 48, backgroundColor: '#111827', borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  aircraftInfo: { flex: 1 },
  aircraftName: { fontSize: 16, fontWeight: '700', color: '#F0F4FF', marginBottom: 4 },
  aircraftTail: { fontSize: 13, color: '#38BDF8', fontWeight: '600', marginBottom: 2 },
  aircraftHours: { fontSize: 12, color: '#4A5B73' },
  emptyCard: { backgroundColor: '#0D1421', borderRadius: 14, padding: 20, borderWidth: 1, borderColor: '#1E2D45', borderStyle: 'dashed', alignItems: 'center' },
  emptyText: { color: '#4A5B73', fontSize: 14, textAlign: 'center' },
  bucketItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0D1421', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#1E2D45', marginBottom: 10, gap: 12 },
  bucketStar: { fontSize: 18 },
  bucketName: { fontSize: 14, fontWeight: '600', color: '#F0F4FF', marginBottom: 2 },
  bucketCity: { fontSize: 12, color: '#4A5B73' },
  bucketIcao: { fontSize: 12, color: '#38BDF8', fontWeight: '700' },
  achievement: { width: 90, backgroundColor: '#0D1421', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#38BDF8', alignItems: 'center', gap: 6 },
  achievementLocked: { borderColor: '#1E2D45', opacity: 0.5 },
  achievementLabel: { fontSize: 11, color: '#F0F4FF', textAlign: 'center', fontWeight: '600' },
  achievementLabelLocked: { color: '#4A5B73' },
  modal: { flex: 1, backgroundColor: '#070B14' },
  modalContent: { padding: 24, paddingBottom: 60 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28, paddingTop: 8 },
  modalTitle: { fontSize: 20, fontWeight: '700', color: '#F0F4FF' },
  modalClose: { fontSize: 15, color: '#38BDF8' },
  fieldGroup: { marginBottom: 18 },
  fieldLabel: { fontSize: 12, fontWeight: '600', color: '#4A5B73', marginBottom: 8, letterSpacing: 0.5, textTransform: 'uppercase' },
  fieldInput: { backgroundColor: '#0D1421', borderRadius: 12, padding: 14, color: '#F0F4FF', fontSize: 15, borderWidth: 1, borderColor: '#1E2D45' },
  certGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 24 },
  certChip: { backgroundColor: '#0D1421', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8, borderWidth: 1, borderColor: '#1E2D45' },
  certChipActive: { backgroundColor: '#38BDF8', borderColor: '#38BDF8' },
  certChipText: { fontSize: 13, color: '#4A5B73', fontWeight: '600' },
  certChipTextActive: { color: '#0D1421', fontWeight: '700' },
  saveBtn: { backgroundColor: '#38BDF8', borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 8 },
  saveBtnText: { fontSize: 16, fontWeight: '700', color: '#0D1421' },
  logbookCard: { backgroundColor: '#0D1421', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: '#1E2D45' },
  logbookImported: { fontSize: 14, fontWeight: '600', color: '#F0F4FF', marginBottom: 4 },
  logbookDetail: { fontSize: 13, color: '#4A5B73' },
  logbookImportBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0D1421', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: '#1E2D45', borderStyle: 'dashed', gap: 12 },
  logbookImportIcon: { fontSize: 24 },
  logbookImportTitle: { fontSize: 14, fontWeight: '700', color: '#F0F4FF', marginBottom: 2 },
  logbookImportSub: { fontSize: 12, color: '#4A5B73' },
  logbookImportArrow: { fontSize: 18, color: '#38BDF8' },
});
