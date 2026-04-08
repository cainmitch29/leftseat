/**
 * app/follow-list.tsx — Shows followers or following list
 */

import { useEffect, useState } from 'react';
import { Feather } from '@expo/vector-icons';
import {
  ActivityIndicator, ScrollView, StyleSheet, Text,
  TouchableOpacity, View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

interface PilotRow {
  user_id: string;
  name: string | null;
  username: string | null;
  home_airport: string | null;
  certificate: string | null;
}

export default function FollowListScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { mode } = useLocalSearchParams<{ mode: 'followers' | 'following' }>();
  const [loading, setLoading] = useState(true);
  const [pilots, setPilots] = useState<PilotRow[]>([]);

  const title = mode === 'followers' ? 'Followers' : 'Following';

  useEffect(() => {
    if (!user?.id) { setLoading(false); return; }
    loadList();
  }, [user?.id, mode]);

  async function loadList() {
    setLoading(true);
    try {
      // Get the user IDs from pilot_follows
      const column = mode === 'followers' ? 'follower_id' : 'following_id';
      const matchColumn = mode === 'followers' ? 'following_id' : 'follower_id';
      const { data: follows } = await supabase
        .from('pilot_follows')
        .select(column)
        .eq(matchColumn, user!.id);

      if (!follows || follows.length === 0) { setPilots([]); setLoading(false); return; }

      const ids = follows.map((f: any) => f[column]);
      const { data: profiles } = await supabase
        .from('pilot_profiles')
        .select('user_id, name, username, home_airport, certificate')
        .in('user_id', ids);

      setPilots(profiles ?? []);
    } catch (e: any) {
      if (__DEV__) console.warn('[FollowList] error:', e?.message);
    }
    setLoading(false);
  }

  return (
    <View style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} activeOpacity={0.7}>
          <Text style={s.backArrow}>&#8249;</Text>
          <Text style={s.backLabel}>Back</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>{title}</Text>
        <View style={s.backBtn} />
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator color="#38BDF8" /></View>
      ) : pilots.length === 0 ? (
        <View style={s.center}>
          <Feather name="users" size={32} color="#2A3A52" />
          <Text style={s.emptyText}>
            {mode === 'followers' ? "No followers yet." : "You're not following anyone yet."}
          </Text>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.list}>
          {pilots.map((p, i) => (
            <TouchableOpacity
              key={p.user_id ?? i}
              style={[s.row, i < pilots.length - 1 && s.rowBorder]}
              onPress={() => router.push({ pathname: '/community-profile', params: { userId: p.user_id } })}
              activeOpacity={0.7}
            >
              <View style={s.avatar}>
                <Feather name="user" size={18} color="#6B83A0" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.name}>{p.name || 'Pilot'}</Text>
                {p.username && <Text style={s.username}>@{p.username}</Text>}
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                {p.home_airport && <Text style={s.meta}>{p.home_airport}</Text>}
                {p.certificate && <Text style={s.meta}>{p.certificate}</Text>}
              </View>
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
  avatar: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: '#0A1628',
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#1E2D42',
  },
  name: { fontSize: 15, fontWeight: '700', color: '#F0F4FF' },
  username: { fontSize: 12, color: '#6B83A0', marginTop: 1 },
  meta: { fontSize: 11, color: '#4A5B73' },
});
