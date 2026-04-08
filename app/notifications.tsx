/**
 * app/notifications.tsx — Notifications screen
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

interface NotifItem {
  type: 'follow';
  user_id: string;
  name: string | null;
  username: string | null;
  created_at: string;
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export default function NotificationsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<NotifItem[]>([]);

  useEffect(() => {
    if (!user?.id) { setLoading(false); return; }
    loadNotifications();
  }, [user?.id]);

  async function loadNotifications() {
    setLoading(true);
    try {
      // Get recent followers
      const { data: follows } = await supabase
        .from('pilot_follows')
        .select('follower_id, created_at')
        .eq('following_id', user!.id)
        .order('created_at', { ascending: false })
        .limit(30);

      if (!follows || follows.length === 0) { setItems([]); setLoading(false); return; }

      const ids = follows.map(f => f.follower_id);
      const { data: profiles } = await supabase
        .from('pilot_profiles')
        .select('user_id, name, username')
        .in('user_id', ids);
      const nameMap = new Map((profiles ?? []).map(p => [p.user_id, p]));

      const notifs: NotifItem[] = follows.map(f => ({
        type: 'follow' as const,
        user_id: f.follower_id,
        name: nameMap.get(f.follower_id)?.name ?? null,
        username: nameMap.get(f.follower_id)?.username ?? null,
        created_at: f.created_at,
      }));

      setItems(notifs);
    } catch (e: any) {
      if (__DEV__) console.warn('[Notifications] error:', e?.message);
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
        <Text style={s.headerTitle}>Notifications</Text>
        <View style={s.backBtn} />
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator color="#38BDF8" /></View>
      ) : items.length === 0 ? (
        <View style={s.center}>
          <Feather name="bell" size={32} color="#2A3A52" />
          <Text style={s.emptyText}>No notifications yet</Text>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.list}>
          {items.map((item, i) => (
            <TouchableOpacity
              key={`${item.user_id}-${item.created_at}`}
              style={[s.row, i < items.length - 1 && s.rowBorder]}
              onPress={() => router.push({ pathname: '/community-profile', params: { userId: item.user_id } })}
              activeOpacity={0.7}
            >
              <View style={s.iconWrap}>
                <Feather name="user-plus" size={14} color="#38BDF8" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.notifText}>
                  <Text style={s.notifName}>{item.name || item.username || 'A pilot'}</Text>
                  {' followed you'}
                </Text>
              </View>
              <Text style={s.notifTime}>{formatRelative(item.created_at)}</Text>
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
    width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(56,189,248,0.08)',
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(56,189,248,0.20)',
  },
  notifText: { fontSize: 14, color: '#C8D8EE', lineHeight: 20 },
  notifName: { fontWeight: '700', color: '#F0F4FF' },
  notifTime: { fontSize: 11, color: '#4A5B73' },
});
