import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import airportsData from '../../assets/images/airports.json';

const airports: any[] = airportsData;

export default function HomeScreen() {
  const [search, setSearch] = useState('');
  const router = useRouter();
  const [recentSearches, setRecentSearches] = useState<any[]>([]);
  const [isFocused, setIsFocused] = useState(false);

  const featured = [
    { id: 'KSBA', icao: 'KSBA', name: 'Santa Barbara', city: 'Santa Barbara', state: 'CA', tag: '🌊 Beach', lat: 34.4262, lng: -119.8401 },
    { id: 'KASE', icao: 'KASE', name: 'Aspen', city: 'Aspen', state: 'CO', tag: '⛷️ Ski', lat: 39.2232, lng: -106.8689 },
    { id: 'KEGE', icao: 'KEGE', name: 'Eagle County', city: 'Eagle', state: 'CO', tag: '🏔️ Mountains', lat: 39.6426, lng: -106.9177 },
    { id: 'KMRY', icao: 'KMRY', name: 'Monterey', city: 'Monterey', state: 'CA', tag: '⛳ Golf', lat: 36.5870, lng: -121.8428 },
    { id: 'KBZN', icao: 'KBZN', name: 'Bozeman', city: 'Bozeman', state: 'MT', tag: '🏕️ Nature', lat: 45.7775, lng: -111.1528 },
    { id: 'KEYW', icao: 'KEYW', name: 'Key West', city: 'Key West', state: 'FL', tag: '🌴 Tropical', lat: 24.5561, lng: -81.7596 },
  ];

  const searchResults = useMemo(() => {
    if (search.length < 2) return [];
    const q = search.toLowerCase();
    return airports.filter(a =>
      a.name?.toLowerCase().includes(q) ||
      a.city?.toLowerCase().includes(q) ||
      a.id?.toLowerCase().includes(q) ||
      a.icao?.toLowerCase().includes(q)
    ).slice(0, 20);
  }, [search]);

  const showResults = search.length >= 2;

  useEffect(() => {
    async function loadRecent() {
      try {
        const stored = await AsyncStorage.getItem('recentSearches');
        if (stored) setRecentSearches(JSON.parse(stored));
      } catch (e) {}
    }
    loadRecent();
  }, []);

  async function goToAirport(a: any) {
    try {
      const updated = [a, ...recentSearches.filter((r: any) => r.id !== a.id)].slice(0, 3);
      setRecentSearches(updated);
      await AsyncStorage.setItem('recentSearches', JSON.stringify(updated));
    } catch (e) {}

    const full = airports.find((apt: any) =>
      apt.icao === (a.icao || a.id) || apt.id === (a.icao || a.id)
    ) || a;

    router.push({
      pathname: '/airport',
      params: {
        icao: full.icao || full.id,
        name: full.name,
        city: full.city,
        state: full.state,
        lat: full.lat,
        lng: full.lng,
        elevation: full.elevation,
        fuel: full.fuel,
        runways: full.runways ? JSON.stringify(full.runways) : null,
      }
    });
    setSearch('');
  }

  return (
    <View style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.greeting}>Good morning, Mitchell ✈️</Text>
          <Text style={styles.tagline}>Where are you flying today?</Text>
        </View>

        {/* Search */}
        <View style={styles.searchBox}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search airport, city, or ICAO..."
            placeholderTextColor="#4A5B73"
            value={search}
            onChangeText={setSearch}
            autoCorrect={false}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setTimeout(() => setIsFocused(false), 200)}
            autoCapitalize="characters"
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')}>
              <Text style={styles.clearBtn}>✕</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Recent Searches */}
{search === '' && recentSearches.length > 0 && isFocused && (
          <View style={styles.resultsBox}>
            <Text style={[styles.sectionTitle, { paddingHorizontal: 14, paddingTop: 12, marginBottom: 0 }]}>RECENT</Text>
            {recentSearches.map((airport: any, i: number) => (
              <View key={i} style={[styles.resultItem, { justifyContent: 'space-between' }]}>
                <TouchableOpacity style={{ flex: 1 }} onPress={() => goToAirport(airport)}>
                  <View style={styles.resultLeft}>
                    <Text style={styles.resultId}>{airport.icao || airport.id}</Text>
                    <Text style={styles.resultName}>{airport.name}</Text>
                    <Text style={styles.resultCity}>{airport.city}, {airport.state}</Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={async () => {
                    const updated = recentSearches.filter((_: any, idx: number) => idx !== i);
                    setRecentSearches(updated);
                    await AsyncStorage.setItem('recentSearches', JSON.stringify(updated));
                  }}
                  style={{ paddingLeft: 16, paddingVertical: 8 }}
                >
                  <Text style={{ color: '#4A5B73', fontSize: 16 }}>✕</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}
        {/* Search Results */}
        {showResults && (
          <View style={styles.resultsBox}>
            {searchResults.length === 0 ? (
              <Text style={styles.noResults}>No airports found</Text>
            ) : (
              searchResults.map((a: any, i: number) => (
                <TouchableOpacity key={i} style={styles.resultItem} onPress={() => goToAirport(a)}>
                  <View style={styles.resultLeft}>
                    <Text style={styles.resultId}>{a.icao || a.id}</Text>
                    <Text style={styles.resultName}>{a.name}</Text>
                    <Text style={styles.resultCity}>{a.city}, {a.state}</Text>
                  </View>
                  <View style={styles.resultRight}>
                    {a.fuel && <Text style={styles.resultFuel}>⛽ {a.fuel}</Text>}
                    {a.elevation && <Text style={styles.resultElev}>📏 {a.elevation} ft</Text>}
                  </View>
                </TouchableOpacity>
              ))
            )}
          </View>
        )}

        {/* Featured — hidden during search */}
        {!showResults && (
          <>
            <Text style={styles.sectionTitle}>Featured Destinations</Text>
            <View style={styles.grid}>
              {featured.map((airport) => (
                <TouchableOpacity
                  key={airport.id}
                  style={styles.card}
                  onPress={() => goToAirport(airport)}
                >
                  <Text style={styles.cardTag}>{airport.tag.split(' ')[0]}</Text>
                  <Text style={styles.cardLabel}>{airport.tag.split(' ').slice(1).join(' ')}</Text>
                  <Text style={styles.cardIcao}>{airport.icao}</Text>
                  <Text style={styles.cardName}>{airport.name}</Text>
                  <Text style={styles.cardState}>{airport.state}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#070B14', paddingHorizontal: 20 },
  header: { paddingTop: 70, paddingBottom: 24 },
  greeting: { fontSize: 12, color: '#4A5B73', marginBottom: 6, fontWeight: '600', letterSpacing: 1.5, textTransform: 'uppercase' },
  tagline: { fontSize: 30, fontWeight: '800', color: '#F0F4FF', lineHeight: 36, letterSpacing: -0.5 },
  searchBox: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#0D1421', borderRadius: 14,
    paddingHorizontal: 16, paddingVertical: 14, marginBottom: 16,
    borderWidth: 1, borderColor: '#1E2D45',
  },
  searchIcon: { fontSize: 16, marginRight: 10 },
  searchInput: { flex: 1, color: '#F0F4FF', fontSize: 15 },
  clearBtn: { color: '#4A5B73', fontSize: 16, paddingLeft: 8 },
  resultsBox: {
    backgroundColor: '#0D1421', borderRadius: 14,
    borderWidth: 1, borderColor: '#1E2D45', marginBottom: 16, overflow: 'hidden',
  },
  noResults: { color: '#4A5B73', padding: 16, textAlign: 'center' },
  resultItem: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 14, borderBottomWidth: 1, borderBottomColor: '#1E2D45',
  },
  resultLeft: { flex: 1 },
  resultId: { fontSize: 13, fontWeight: '700', color: '#38BDF8', marginBottom: 2 },
  resultName: { fontSize: 14, fontWeight: '600', color: '#F0F4FF', marginBottom: 2 },
  resultCity: { fontSize: 12, color: '#4A5B73' },
  resultRight: { alignItems: 'flex-end', gap: 4 },
  resultFuel: { fontSize: 11, color: '#8A9BB5' },
  resultElev: { fontSize: 11, color: '#8A9BB5' },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: '#4A5B73', marginBottom: 16, letterSpacing: 1.5, textTransform: 'uppercase' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingBottom: 40 },
  card: {
    width: '47%', backgroundColor: '#0D1421', borderRadius: 14,
    padding: 18, borderWidth: 1, borderColor: '#1E2D45',
  },
  cardTag: { fontSize: 28, marginBottom: 4, textAlign: 'center' },
  cardLabel: { fontSize: 20, fontWeight: '700', color: '#F0F4FF', marginBottom: 10, textAlign: 'center' },
  cardIcao: { fontSize: 13, fontWeight: '700', color: '#38BDF8', marginBottom: 4, textAlign: 'center' },
  cardName: { fontSize: 15, fontWeight: '700', color: '#F0F4FF', marginBottom: 2, textAlign: 'center' },
  cardState: { fontSize: 12, color: '#8A9BB5', textAlign: 'center' },
});
