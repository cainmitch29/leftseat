import { supabase } from '@/lib/supabase';
import * as Calendar from 'expo-calendar';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const EVENT_TYPES = ['All', 'Fly-In', 'Airshow', 'Pancake Breakfast', 'Poker Run', 'EAA Event', 'AOPA Event', 'Other'];
const TYPE_EMOJIS: Record<string, string> = { 'Fly-In': '✈️', 'Airshow': '🛩️', 'Pancake Breakfast': '🥞', 'Poker Run': '🃏', 'EAA Event': '🔧', 'AOPA Event': '🏆', 'Other': '📍' };
const USER_ID = 'mitchell';

function getDistanceMiles(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 3958.8;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function daysUntil(dateStr: string) {
  const today = new Date(); today.setHours(0,0,0,0);
  const event = new Date(dateStr + 'T12:00:00');
  const diff = Math.ceil((event.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diff === 0) return 'Today!';
  if (diff === 1) return 'Tomorrow';
  if (diff < 0) return null;
  return `In ${diff} days`;
}

export default function EventsScreen() {
  const [events, setEvents] = useState<any[]>([]);
  const [interested, setInterested] = useState<string[]>([]);
  const [activeFilter, setActiveFilter] = useState('All');
  const [loading, setLoading] = useState(true);
  const [location, setLocation] = useState<any>(null);
  const [showSubmit, setShowSubmit] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();
  const [form, setForm] = useState({ icao: '', airport_name: '', city: '', state: '', title: '', type: 'Fly-In', description: '', date: '', time: '' });

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({});
        setLocation(loc.coords);
      }
    })();
    fetchEvents();
    fetchInterested();
  }, []);

  async function fetchEvents() {
    setLoading(true);
    const today = new Date().toISOString().split('T')[0];
    const { data } = await supabase.from('events').select('*').gte('date', today).order('date', { ascending: true });
    setEvents(data || []);
    setLoading(false);
  }

  async function fetchInterested() {
    const { data } = await supabase.from('event_interested').select('event_id').eq('user_id', USER_ID);
    setInterested((data || []).map((r: any) => r.event_id));
  }

  async function toggleInterested(eventId: string) {
    const isIn = interested.includes(eventId);
    if (isIn) {
      await supabase.from('event_interested').delete().eq('event_id', eventId).eq('user_id', USER_ID);
      setInterested(prev => prev.filter(id => id !== eventId));
      setEvents(prev => prev.map(e => e.id === eventId ? { ...e, interested_count: (e.interested_count||1)-1 } : e));
    } else {
      await supabase.from('event_interested').insert({ event_id: eventId, user_id: USER_ID });
      setInterested(prev => [...prev, eventId]);
      setEvents(prev => prev.map(e => e.id === eventId ? { ...e, interested_count: (e.interested_count||0)+1 } : e));
    }
  }

  async function addToCalendar(event: any) {
    const { status } = await Calendar.requestCalendarPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permission needed', 'Please allow calendar access in Settings.'); return; }
    try {
      const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
      const defaultCal = calendars.find(c => c.allowsModifications) || calendars[0];
      const eventDate = new Date(event.date + 'T12:00:00');
      const endDate = new Date(eventDate.getTime() + 4 * 60 * 60 * 1000);
      await Calendar.createEventAsync(defaultCal.id, { title: `✈️ ${event.title}`, startDate: eventDate, endDate, location: `${event.airport_name} (${event.icao}), ${event.city}, ${event.state}`, notes: event.description || '', timeZone: 'America/Chicago' });
      Alert.alert('Added to Calendar! 📅', `"${event.title}" has been added to your calendar.`);
    } catch (e) { Alert.alert('Error', 'Could not add to calendar.'); }
  }

  async function submitEvent() {
    if (!form.icao || !form.title || !form.date) { Alert.alert('Missing info', 'Please fill in ICAO, event title, and date.'); return; }
    setSubmitting(true);
    const { error } = await supabase.from('events').insert({ ...form, icao: form.icao.toUpperCase(), submitted_by: USER_ID, interested_count: 0 });
    setSubmitting(false);
    if (error) { Alert.alert('Error', 'Could not submit event.'); return; }
    setShowSubmit(false);
    setForm({ icao: '', airport_name: '', city: '', state: '', title: '', type: 'Fly-In', description: '', date: '', time: '' });
    fetchEvents();
    Alert.alert('Event submitted! ✈️', 'Your event is now live.');
  }

  const filtered = activeFilter === 'All' ? events : events.filter(e => e.type === activeFilter);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerLabel}>UPCOMING EVENTS</Text>
          <Text style={styles.headerTitle}>Fly-Ins & Events ✈️</Text>
        </View>
        <TouchableOpacity style={styles.addBtn} onPress={() => setShowSubmit(true)}>
          <Text style={styles.addBtnText}>＋ Add</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.filterRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, gap: 8, alignItems: 'center' }}>
          {EVENT_TYPES.map(t => (
            <TouchableOpacity key={t} style={[styles.chip, activeFilter === t && styles.chipActive]} onPress={() => setActiveFilter(t)}>
              <Text style={[styles.chipText, activeFilter === t && styles.chipTextActive]}>{t}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color="#38BDF8" size="large" /></View>
      ) : filtered.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>No upcoming events</Text>
          <TouchableOpacity style={styles.addBtn} onPress={() => setShowSubmit(true)}><Text style={styles.addBtnText}>＋ Add the first one</Text></TouchableOpacity>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20, gap: 14 }}>
          {filtered.map((event) => {
            const countdown = daysUntil(event.date);
            const dist = location ? Math.round(getDistanceMiles(location.latitude, location.longitude, event.lat, event.lng)) : null;
            const isInterested = interested.includes(event.id);
            return (
              <View key={event.id} style={styles.card}>
                <View style={styles.cardTop}>
                  <View style={styles.typeBadge}><Text style={styles.typeBadgeText}>{TYPE_EMOJIS[event.type] || '📍'} {event.type}</Text></View>
                  {countdown && <Text style={styles.countdown}>{countdown}</Text>}
                </View>
                <Text style={styles.cardTitle}>{event.title}</Text>
                <Text style={styles.cardAirport}>{event.icao} · {event.airport_name}</Text>
                <Text style={styles.cardMeta}>📅 {formatDate(event.date)}{event.time ? `  ·  🕐 ${event.time}` : ''}</Text>
                {dist !== null && <Text style={styles.cardMeta}>📍 {event.city}, {event.state}  ·  {dist} nm away</Text>}
                {event.description ? <Text style={styles.cardDesc} numberOfLines={2}>{event.description}</Text> : null}
                <View style={styles.cardActions}>
                  <TouchableOpacity style={[styles.actionBtn, isInterested && styles.actionBtnActive]} onPress={() => toggleInterested(event.id)}>
                    <Text style={[styles.actionBtnText, isInterested && styles.actionBtnTextActive]}>{isInterested ? '⭐ Interested' : '☆ Interested'}</Text>
                    {event.interested_count > 0 && <Text style={[styles.actionCount, isInterested && { color: '#0D1421' }]}>{event.interested_count}</Text>}
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.actionBtn} onPress={() => addToCalendar(event)}>
                    <Text style={styles.actionBtnText}>📅 Add to Calendar</Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity style={styles.viewAirportBtn} onPress={() => router.push({ pathname: '/airport', params: { icao: event.icao, name: event.airport_name, city: event.city, state: event.state, lat: event.lat, lng: event.lng } })}>
                  <Text style={styles.viewAirportText}>View Airport →</Text>
                </TouchableOpacity>
              </View>
            );
          })}
          <View style={{ height: 40 }} />
        </ScrollView>
      )}

      <Modal visible={showSubmit} animationType="slide" presentationStyle="pageSheet">
        <View style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Submit an Event</Text>
            <TouchableOpacity onPress={() => setShowSubmit(false)}><Text style={styles.modalClose}>✕</Text></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.modalBody}>
            <Text style={styles.fieldLabel}>Airport ICAO *</Text>
            <TextInput style={styles.input} placeholder="e.g. KSUS" placeholderTextColor="#4A5B73" value={form.icao} onChangeText={v => setForm(f => ({ ...f, icao: v }))} autoCapitalize="characters" />
            <Text style={styles.fieldLabel}>Airport Name</Text>
            <TextInput style={styles.input} placeholder="e.g. Spirit of St. Louis" placeholderTextColor="#4A5B73" value={form.airport_name} onChangeText={v => setForm(f => ({ ...f, airport_name: v }))} />
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>City</Text>
                <TextInput style={styles.input} placeholder="City" placeholderTextColor="#4A5B73" value={form.city} onChangeText={v => setForm(f => ({ ...f, city: v }))} />
              </View>
              <View style={{ width: 80 }}>
                <Text style={styles.fieldLabel}>State</Text>
                <TextInput style={styles.input} placeholder="MO" placeholderTextColor="#4A5B73" value={form.state} onChangeText={v => setForm(f => ({ ...f, state: v }))} autoCapitalize="characters" />
              </View>
            </View>
            <Text style={styles.fieldLabel}>Event Title *</Text>
            <TextInput style={styles.input} placeholder="e.g. EAA Chapter 54 Pancake Breakfast" placeholderTextColor="#4A5B73" value={form.title} onChangeText={v => setForm(f => ({ ...f, title: v }))} />
            <Text style={styles.fieldLabel}>Event Type</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }} contentContainerStyle={{ gap: 8 }}>
              {EVENT_TYPES.filter(t => t !== 'All').map(t => (
                <TouchableOpacity key={t} style={[styles.chip, form.type === t && styles.chipActive]} onPress={() => setForm(f => ({ ...f, type: t }))}>
                  <Text style={[styles.chipText, form.type === t && styles.chipTextActive]}>{t}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <Text style={styles.fieldLabel}>Date * (YYYY-MM-DD)</Text>
            <TextInput style={styles.input} placeholder="2026-05-10" placeholderTextColor="#4A5B73" value={form.date} onChangeText={v => setForm(f => ({ ...f, date: v }))} />
            <Text style={styles.fieldLabel}>Time</Text>
            <TextInput style={styles.input} placeholder="e.g. 8:00 AM - 11:00 AM" placeholderTextColor="#4A5B73" value={form.time} onChangeText={v => setForm(f => ({ ...f, time: v }))} />
            <Text style={styles.fieldLabel}>Description</Text>
            <TextInput style={[styles.input, { height: 90, textAlignVertical: 'top' }]} placeholder="Tell pilots what to expect..." placeholderTextColor="#4A5B73" value={form.description} onChangeText={v => setForm(f => ({ ...f, description: v }))} multiline numberOfLines={4} />
            <TouchableOpacity style={styles.submitBtn} onPress={submitEvent} disabled={submitting}>
              {submitting ? <ActivityIndicator color="#0D1421" /> : <Text style={styles.submitBtnText}>Submit Event ✈️</Text>}
            </TouchableOpacity>
            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#070B14' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 16 },
  headerLabel: { fontSize: 11, color: '#4A5B73', fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 },
  headerTitle: { fontSize: 28, fontWeight: '800', color: '#F0F4FF' },
  addBtn: { backgroundColor: '#38BDF8', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8 },
  addBtnText: { color: '#0D1421', fontWeight: '700', fontSize: 14 },
  filterRow: { height: 44, marginBottom: 12 },
  chip: { backgroundColor: '#0D1421', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: '#1E2D45', alignSelf: 'center' },
  chipActive: { backgroundColor: '#38BDF8', borderColor: '#38BDF8' },
  chipText: { fontSize: 13, color: '#4A5B73', fontWeight: '600' },
  chipTextActive: { color: '#0D1421' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  emptyText: { color: '#4A5B73', fontSize: 16 },
  card: { backgroundColor: '#0D1421', borderRadius: 16, padding: 18, borderWidth: 1, borderColor: '#1E2D45' },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  typeBadge: { backgroundColor: '#111827', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: '#1E2D45' },
  typeBadgeText: { color: '#38BDF8', fontSize: 12, fontWeight: '700' },
  countdown: { color: '#F97316', fontSize: 12, fontWeight: '700' },
  cardTitle: { fontSize: 18, fontWeight: '800', color: '#F0F4FF', marginBottom: 6 },
  cardAirport: { fontSize: 13, fontWeight: '700', color: '#38BDF8', marginBottom: 4 },
  cardMeta: { fontSize: 12, color: '#4A5B73', marginBottom: 2 },
  cardDesc: { fontSize: 13, color: '#8A9BB5', marginTop: 8, lineHeight: 18 },
  cardActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#111827', borderRadius: 10, paddingVertical: 10, borderWidth: 1, borderColor: '#1E2D45' },
  actionBtnActive: { backgroundColor: '#38BDF8', borderColor: '#38BDF8' },
  actionBtnText: { color: '#F0F4FF', fontSize: 13, fontWeight: '600' },
  actionBtnTextActive: { color: '#0D1421' },
  actionCount: { color: '#F0F4FF', fontSize: 12, fontWeight: '700', backgroundColor: '#1E2D45', borderRadius: 10, paddingHorizontal: 6, paddingVertical: 1 },
  viewAirportBtn: { marginTop: 10, alignItems: 'center', paddingVertical: 8 },
  viewAirportText: { color: '#38BDF8', fontSize: 13, fontWeight: '700' },
  modal: { flex: 1, backgroundColor: '#070B14' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: 60, borderBottomWidth: 1, borderBottomColor: '#1E2D45' },
  modalTitle: { fontSize: 22, fontWeight: '800', color: '#F0F4FF' },
  modalClose: { color: '#4A5B73', fontSize: 20 },
  modalBody: { padding: 20 },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: '#4A5B73', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8, marginTop: 4 },
  input: { backgroundColor: '#0D1421', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, color: '#F0F4FF', fontSize: 15, borderWidth: 1, borderColor: '#1E2D45', marginBottom: 16 },
  submitBtn: { backgroundColor: '#38BDF8', borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  submitBtnText: { color: '#0D1421', fontSize: 16, fontWeight: '800' },
});
