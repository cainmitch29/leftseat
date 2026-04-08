/**
 * app/my-reviews.tsx — Full list of the current user's pilot reports
 */

import { useEffect, useState } from 'react';
import { MaterialCommunityIcons, Feather } from '@expo/vector-icons';
import {
  ActivityIndicator, ScrollView, StyleSheet, Text,
  TouchableOpacity, View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

export default function MyReviewsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [reviews, setReviews] = useState<any[]>([]);

  useEffect(() => {
    if (!user?.id) { setLoading(false); return; }
    (async () => {
      let { data, error } = await supabase
        .from('airport_reviews')
        .select('airport_icao, courtesy_car, fuel_available, fuel_price, fbo_name, fbo_rating, visit_reason, notes, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      // If fbo_name column doesn't exist, retry without it
      if (error && error.message?.includes('column')) {
        const fallback = await supabase
          .from('airport_reviews')
          .select('airport_icao, courtesy_car, fuel_available, fuel_price, fbo_rating, visit_reason, notes, created_at')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false });
        data = fallback.data as any;
      }
      setReviews(data ?? []);
      setLoading(false);
    })();
  }, [user?.id]);

  function goToAirport(icao: string) {
    router.push({ pathname: '/airport', params: { icao, name: '', city: '', state: '', lat: '', lng: '', elevation: '', fuel: '' } });
  }

  return (
    <View style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} activeOpacity={0.7}>
          <Text style={s.backArrow}>&#8249;</Text>
          <Text style={s.backLabel}>Profile</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>My Pilot Reports</Text>
        <View style={s.backBtn} />
      </View>

      {loading ? (
        <View style={s.loadingWrap}><ActivityIndicator color="#38BDF8" /></View>
      ) : reviews.length === 0 ? (
        <View style={s.emptyWrap}>
          <MaterialCommunityIcons name="clipboard-text-outline" size={36} color="#2A3A52" />
          <Text style={s.emptyText}>You haven't submitted any pilot reports yet.</Text>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.list}>
          {reviews.map((r, i) => (
            <TouchableOpacity
              key={`${r.airport_icao}-${r.created_at}-${i}`}
              style={s.card}
              onPress={() => goToAirport(r.airport_icao)}
              activeOpacity={0.7}
            >
              <View style={s.cardHeader}>
                <Text style={s.cardIcao}>{r.airport_icao}</Text>
                <Text style={s.cardDate}>
                  {new Date(r.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                </Text>
              </View>

              {r.fbo_name && (
                <Text style={s.cardFbo}>{r.fbo_name}</Text>
              )}

              <View style={s.chipsRow}>
                {r.visit_reason && (
                  <View style={s.chip}>
                    <Text style={s.chipText}>{r.visit_reason.replace('_', ' ')}</Text>
                  </View>
                )}
                {r.courtesy_car && r.courtesy_car !== 'unknown' && (
                  <View style={s.chip}>
                    <MaterialCommunityIcons name="car" size={11} color={r.courtesy_car === 'yes' ? '#34D399' : '#6B83A0'} />
                    <Text style={s.chipText}>{r.courtesy_car === 'yes' ? 'Crew car' : 'No crew car'}</Text>
                  </View>
                )}
                {r.fuel_available != null && (
                  <View style={s.chip}>
                    <MaterialCommunityIcons name="gas-station" size={11} color={r.fuel_available ? '#F97316' : '#6B83A0'} />
                    <Text style={s.chipText}>
                      {r.fuel_available ? (r.fuel_price ? `$${r.fuel_price}` : 'Fuel') : 'No fuel'}
                    </Text>
                  </View>
                )}
                {r.fbo_rating != null && (
                  <View style={s.chip}>
                    <MaterialCommunityIcons name="star" size={11} color="#FBBF24" />
                    <Text style={s.chipText}>{r.fbo_rating}/5</Text>
                  </View>
                )}
              </View>

              {r.notes?.trim() && (
                <Text style={s.cardNotes}>{r.notes}</Text>
              )}
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#060B16' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 60, paddingBottom: 12, paddingHorizontal: 16,
    borderBottomWidth: 1, borderBottomColor: '#1E3A5F',
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', width: 80 },
  backArrow: { fontSize: 28, color: '#38BDF8', lineHeight: 32, marginRight: 2 },
  backLabel: { fontSize: 16, color: '#38BDF8', fontWeight: '500' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#F0F4FF' },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyText: { fontSize: 14, color: '#4A5B73', textAlign: 'center', paddingHorizontal: 32 },
  list: { padding: 16, gap: 10 },
  card: {
    backgroundColor: 'rgba(10,18,36,0.97)', borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)',
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  cardIcao: { fontSize: 15, fontWeight: '700', color: '#38BDF8' },
  cardDate: { fontSize: 11, color: '#4A5B73' },
  cardFbo: { fontSize: 12, color: '#6B83A0', marginBottom: 6 },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 4 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  chipText: { fontSize: 11, color: '#8A9BB5', fontWeight: '500', textTransform: 'capitalize' },
  cardNotes: { fontSize: 13, color: '#6B83A0', lineHeight: 19, marginTop: 6 },
});
