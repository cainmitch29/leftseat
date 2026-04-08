/**
 * app/dog-airports.tsx — Dog-Friendly Airports list
 */

import { useEffect, useState } from 'react';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import {
  ActivityIndicator, Image, ScrollView, StyleSheet, Text,
  TouchableOpacity, View,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { GOOGLE_KEY } from '../utils/config';
import airportsData from '../assets/images/airports.json';

const TEAL = '#0D9488';
const airports: any[] = airportsData as any[];

function distNm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3440.065;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

interface DogAirport {
  airport_icao: string;
  dog_notes: string | null;
  dog_features: string[];
  // resolved from airports.json
  name: string; city: string; state: string; lat: number; lng: number;
  distNm: number;
  photoUri: string | null;
}

export default function DogAirportsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<DogAirport[]>([]);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    try {
      // Get user location
      let userLat = 39.8283, userLng = -98.5795;
      try {
        const raw = await AsyncStorage.getItem(`userProfile:${user?.id ?? 'guest'}`);
        if (raw) {
          const p = JSON.parse(raw);
          if (p.home_airport) {
            const h = airports.find(a => (a.icao || a.faa || a.id)?.toUpperCase() === p.home_airport.toUpperCase());
            if (h) { userLat = h.lat; userLng = h.lng; }
          }
        }
      } catch {}
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
          userLat = loc.coords.latitude;
          userLng = loc.coords.longitude;
        }
      } catch {}

      const { data, error } = await supabase
        .from('dog_friendly_airports')
        .select('airport_icao, dog_notes, dog_features')
        .order('airport_icao');

      if (error || !data) { setLoading(false); return; }

      const results: DogAirport[] = [];
      for (const row of data) {
        const apt = airports.find(a => (a.icao || a.faa || a.id)?.toUpperCase() === row.airport_icao);
        if (!apt) continue;
        const d = Math.round(distNm(userLat, userLng, apt.lat, apt.lng));
        results.push({
          ...row,
          dog_features: row.dog_features ?? [],
          name: apt.name, city: apt.city ?? '', state: apt.state ?? '',
          lat: apt.lat, lng: apt.lng, distNm: d,
          photoUri: `https://maps.googleapis.com/maps/api/staticmap?center=${apt.lat},${apt.lng}&zoom=14&size=800x400&maptype=satellite&key=${GOOGLE_KEY}`,
        });
      }
      results.sort((a, b) => a.distNm - b.distNm);
      setItems(results);
      setLoading(false);

      // Use satellite tiles instead of Places API hero photos — no API loop
      // Photos are static map URLs, costing $0.002 each vs $0.032 for Places
    } catch {
      setLoading(false);
    }
  }

  function goToAirport(item: DogAirport) {
    const apt = airports.find(a => (a.icao || a.faa || a.id)?.toUpperCase() === item.airport_icao);
    router.push({
      pathname: '/airport',
      params: {
        icao: item.airport_icao, name: item.name,
        city: item.city, state: item.state,
        lat: String(item.lat), lng: String(item.lng),
        elevation: apt?.elevation ?? '', fuel: apt?.fuel ?? '',
      },
    });
  }

  return (
    <View style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} activeOpacity={0.7}>
          <Text style={s.backArrow}>‹</Text>
          <Text style={s.backLabel}>Back</Text>
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Text style={s.headerTitle}>Dog-Friendly Airports</Text>
        </View>
        <View style={s.backBtn} />
      </View>

      {loading ? (
        <View style={s.loadingWrap}><ActivityIndicator color={TEAL} size="large" /></View>
      ) : items.length === 0 ? (
        <View style={s.emptyWrap}>
          <MaterialCommunityIcons name="dog-side" size={40} color="#2A3A52" />
          <Text style={s.emptyText}>No dog-friendly airports found yet.</Text>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.list}>
          {items.map(item => (
            <TouchableOpacity key={item.airport_icao} style={s.row} onPress={() => goToAirport(item)} activeOpacity={0.7}>
              <View style={s.rowPhoto}>
                {item.photoUri ? (
                  <Image source={{ uri: item.photoUri }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
                ) : (
                  <View style={[StyleSheet.absoluteFillObject, s.rowPhotoFallback]}>
                    <MaterialCommunityIcons name="airplane" size={24} color="rgba(13,148,136,0.18)" />
                  </View>
                )}
              </View>
              <View style={s.rowBody}>
                <View style={s.rowTop}>
                  <Text style={s.rowIcao}>{item.airport_icao}</Text>
                  <Text style={s.rowDist}>{item.distNm} nm</Text>
                </View>
                <Text style={s.rowName} numberOfLines={1}>{item.name}</Text>
                <Text style={s.rowCity}>{item.city}{item.state ? `, ${item.state}` : ''}</Text>
                {item.dog_features.length > 0 && (
                  <View style={s.tagsRow}>
                    {item.dog_features.slice(0, 4).map(tag => (
                      <View key={tag} style={s.tag}>
                        <Text style={s.tagText}>{tag}</Text>
                      </View>
                    ))}
                  </View>
                )}
                {item.dog_notes && (
                  <Text style={s.rowNotes} numberOfLines={2}>{item.dog_notes}</Text>
                )}
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
  headerCenter: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  backBtn: { flexDirection: 'row', alignItems: 'center', width: 80 },
  backArrow: { fontSize: 28, color: TEAL, lineHeight: 32, marginRight: 2 },
  backLabel: { fontSize: 16, color: TEAL, fontWeight: '500' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#F0F4FF' },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyText: { fontSize: 14, color: '#4A5B73' },
  list: { padding: 16, gap: 12 },
  row: {
    backgroundColor: '#0A1628', borderRadius: 14, overflow: 'hidden',
    borderWidth: 1, borderColor: 'rgba(13,148,136,0.15)',
  },
  rowPhoto: { height: 120, backgroundColor: '#0A1628' },
  rowPhotoFallback: { backgroundColor: '#0A1628', alignItems: 'center', justifyContent: 'center' },
  rowBody: { padding: 14, gap: 4 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowIcao: { fontSize: 13, fontWeight: '700', color: TEAL },
  rowDist: { fontSize: 12, color: '#6B83A0' },
  rowName: { fontSize: 16, fontWeight: '700', color: '#F0F4FF' },
  rowCity: { fontSize: 12, color: '#6B83A0', marginBottom: 6 },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 4 },
  tag: {
    backgroundColor: 'rgba(13,148,136,0.12)', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: 'rgba(13,148,136,0.25)',
  },
  tagText: { fontSize: 10, fontWeight: '600', color: TEAL },
  rowNotes: { fontSize: 13, color: '#8A9BB5', lineHeight: 19 },
});
