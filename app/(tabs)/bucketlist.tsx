import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { supabase } from '../../lib/supabase';

export default function BucketListScreen() {
  const [airports, setAirports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    fetchBucketList();
  }, []);

  async function fetchBucketList() {
    setLoading(true);
    const { data } = await supabase
      .from('bucket_list')
      .select('*')
      .eq('user_id', 'mitchell')
      .order('created_at', { ascending: false });
    if (data) setAirports(data);
    setLoading(false);
  }

  async function removeAirport(icao: string) {
    await supabase
      .from('bucket_list')
      .delete()
      .eq('user_id', 'mitchell')
      .eq('icao', icao);
    setAirports(prev => prev.filter(a => a.icao !== icao));
  }

  function goToAirport(airport: any) {
    router.push({
      pathname: '/airport',
      params: {
        icao: airport.icao,
        name: airport.name,
        city: airport.city,
        state: airport.state,
        lat: airport.lat,
        lng: airport.lng,
        elevation: airport.elevation,
        fuel: airport.fuel,
      }
    });
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.greeting}>MITCHELL'S</Text>
        <Text style={styles.title}>Bucket List ✈️</Text>
        <Text style={styles.subtitle}>{airports.length} airport{airports.length !== 1 ? 's' : ''} saved</Text>
      </View>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color="#38BDF8" size="large" />
          <Text style={styles.loadingText}>Loading your bucket list...</Text>
        </View>
      ) : airports.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>🗺️</Text>
          <Text style={styles.emptyTitle}>No airports saved yet</Text>
          <Text style={styles.emptyText}>Tap "Add to Bucket List" on any airport to save it here</Text>
        </View>
      ) : (
        <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
          {airports.map((airport) => (
            <TouchableOpacity
              key={airport.icao}
              style={styles.card}
              onPress={() => goToAirport(airport)}
            >
              <View style={styles.cardLeft}>
                <Text style={styles.cardIcao}>{airport.icao}</Text>
                <Text style={styles.cardName}>{airport.name}</Text>
                <Text style={styles.cardCity}>{airport.city}, {airport.state}</Text>
                {airport.fuel && <Text style={styles.cardMeta}>⛽ {airport.fuel}</Text>}
              </View>
              <TouchableOpacity
                style={styles.removeBtn}
                onPress={() => removeAirport(airport.icao)}
              >
                <Text style={styles.removeBtnText}>✕</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          ))}
          <View style={{ height: 40 }} />
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#070B14' },
  header: { paddingTop: 70, paddingHorizontal: 20, paddingBottom: 24 },
  greeting: { fontSize: 12, color: '#4A5B73', marginBottom: 6, fontWeight: '700', letterSpacing: 1.5 },
  title: { fontSize: 30, fontWeight: '800', color: '#F0F4FF', letterSpacing: -0.5, marginBottom: 4 },
  subtitle: { fontSize: 14, color: '#4A5B73', fontWeight: '500' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  loadingText: { color: '#4A5B73', fontSize: 14 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 12 },
  emptyIcon: { fontSize: 48, marginBottom: 8 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: '#F0F4FF', textAlign: 'center' },
  emptyText: { fontSize: 14, color: '#4A5B73', textAlign: 'center', lineHeight: 22 },
  list: { flex: 1, paddingHorizontal: 20 },
  card: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#0D1421', borderRadius: 14,
    padding: 16, marginBottom: 12,
    borderWidth: 1, borderColor: '#1E2D45',
  },
  cardLeft: { flex: 1 },
  cardIcao: { fontSize: 12, fontWeight: '700', color: '#38BDF8', marginBottom: 3, letterSpacing: 1 },
  cardName: { fontSize: 16, fontWeight: '700', color: '#F0F4FF', marginBottom: 2 },
  cardCity: { fontSize: 13, color: '#4A5B73', marginBottom: 4 },
  cardMeta: { fontSize: 12, color: '#8A9BB5' },
  removeBtn: {
    backgroundColor: '#1E2D45', borderRadius: 8,
    width: 32, height: 32, alignItems: 'center', justifyContent: 'center',
  },
  removeBtnText: { color: '#4A5B73', fontSize: 14, fontWeight: '700' },
});