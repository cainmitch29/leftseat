/**
 * app/my-activity.tsx — Full activity history
 */

import { useEffect, useState } from 'react';
import { Feather } from '@expo/vector-icons';
import {
  ActivityIndicator, ScrollView, StyleSheet, Text,
  TouchableOpacity, View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

export default function MyActivityScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<any[]>([]);

  useEffect(() => {
    if (!user?.id) { setLoading(false); return; }
    loadActivity();
  }, [user?.id]);

  async function loadActivity() {
    setLoading(true);
    try {
      const [flightsRes, reviewsRes, bucketRes] = await Promise.all([
        supabase.from('visited_airports').select('icao, name, state, visited_at')
          .eq('user_id', user!.id).order('visited_at', { ascending: false }).limit(50),
        supabase.from('airport_reviews').select('airport_icao, visit_reason, created_at')
          .eq('user_id', user!.id).order('created_at', { ascending: false }).limit(50),
        supabase.from('bucket_list').select('icao, name, created_at')
          .eq('user_id', user!.id).order('created_at', { ascending: false }).limit(20),
      ]);
      const all: any[] = [];
      for (const f of (flightsRes.data ?? [])) all.push({ type: 'flight', icao: f.icao, label: f.name, state: f.state, ts: f.visited_at });
      for (const r of (reviewsRes.data ?? [])) all.push({ type: 'review', icao: r.airport_icao, label: r.visit_reason?.replace('_', ' ') ?? 'report', ts: r.created_at });
      for (const b of (bucketRes.data ?? [])) all.push({ type: 'bucket', icao: b.icao, label: b.name, ts: b.created_at });
      all.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
      // Dedupe
      const deduped: any[] = [];
      for (const item of all) {
        const dup = deduped.find(d => d.type === item.type && d.icao === item.icao &&
          Math.abs(new Date(d.ts).getTime() - new Date(item.ts).getTime()) < 5 * 60 * 1000);
        if (!dup) deduped.push(item);
      }
      setItems(deduped);
    } catch {}
    setLoading(false);
  }

  return (
    <View style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} activeOpacity={0.7}>
          <Text style={s.backArrow}>&#8249;</Text>
          <Text style={s.backLabel}>Profile</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Activity</Text>
        <View style={s.backBtn} />
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator color="#38BDF8" /></View>
      ) : items.length === 0 ? (
        <View style={s.center}>
          <Feather name="activity" size={32} color="#2A3A52" />
          <Text style={s.emptyText}>No activity yet.</Text>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.list}>
          {items.map((item, i) => (
            <TouchableOpacity
              key={`${item.type}-${item.icao}-${i}`}
              style={[s.row, i < items.length - 1 && s.rowBorder]}
              onPress={() => router.push({ pathname: '/airport', params: { icao: item.icao, name: '', city: '', state: '', lat: '', lng: '', elevation: '', fuel: '' } })}
              activeOpacity={0.7}
            >
              <View style={s.iconWrap}>
                <Feather
                  name={item.type === 'flight' ? 'navigation' : item.type === 'bucket' ? 'star' : 'clipboard'}
                  size={14}
                  color={item.type === 'flight' ? '#38BDF8' : item.type === 'bucket' ? '#FBBF24' : '#0D9488'}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.actionText}>
                  {item.type === 'flight' ? 'Flew to' : item.type === 'bucket' ? 'Saved' : 'Reported on'}{' '}
                  <Text style={s.icao}>{item.icao}</Text>
                </Text>
                {item.label && item.type !== 'bucket' && (
                  <Text style={s.label}>{item.label}{item.state ? `, ${item.state}` : ''}</Text>
                )}
              </View>
              <Text style={s.time}>
                {new Date(item.ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </Text>
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyText: { fontSize: 14, color: '#4A5B73' },
  list: { padding: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: '#1A2535' },
  iconWrap: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.03)',
    alignItems: 'center', justifyContent: 'center',
  },
  actionText: { fontSize: 14, color: '#C8D8EE', fontWeight: '500' },
  icao: { fontWeight: '700', color: '#38BDF8' },
  label: { fontSize: 12, color: '#4A5B73', marginTop: 2, textTransform: 'capitalize' },
  time: { fontSize: 11, color: '#4A5B73' },
});
