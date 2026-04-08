import { useState, useRef } from 'react';
import {
  ActivityIndicator, Alert, Image, KeyboardAvoidingView, Platform,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { MaterialCommunityIcons, Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import BackgroundWrapper from '../components/BackgroundWrapper';
import airportsData from '../assets/images/airports.json';

const airports: any[] = airportsData as any[];

export default function CreatePostScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [imageUri, setImageUri] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [airportQuery, setAirportQuery] = useState('');
  const [taggedAirport, setTaggedAirport] = useState<{ icao: string; name: string } | null>(null);
  const [showAirportSearch, setShowAirportSearch] = useState(false);
  const [posting, setPosting] = useState(false);

  const airportResults = airportQuery.length >= 2
    ? airports.filter(a => {
        const id = (a.icao || a.faa || a.id || '').toUpperCase();
        const q = airportQuery.toUpperCase();
        return id.includes(q) || (a.name ?? '').toUpperCase().includes(q) || (a.city ?? '').toUpperCase().includes(q);
      }).slice(0, 6)
    : [];

  async function pickImage() {
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    });
    if (!result.canceled && result.assets?.[0]?.uri) {
      setImageUri(result.assets[0].uri);
    }
  }

  async function takePhoto() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Camera access needed', 'Enable camera permissions in Settings to take photos.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    });
    if (!result.canceled && result.assets?.[0]?.uri) {
      setImageUri(result.assets[0].uri);
    }
  }

  async function handlePost() {
    if (!user?.id || !imageUri) return;
    setPosting(true);

    try {
      // Upload image
      const filename = `post-${Date.now()}.jpg`;
      const storagePath = `${user.id}/${filename}`;
      const response = await fetch(imageUri);
      const arrayBuffer = await response.arrayBuffer();

      const { error: uploadError } = await supabase.storage
        .from('post-images')
        .upload(storagePath, arrayBuffer, { upsert: false, contentType: 'image/jpeg' });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from('post-images')
        .getPublicUrl(storagePath);

      // Insert post row
      const { error: insertError } = await supabase.from('pilot_posts').insert({
        user_id: user.id,
        image_url: urlData.publicUrl,
        caption: caption.trim() || null,
        airport_icao: taggedAirport?.icao || null,
      });
      if (insertError) throw insertError;

      router.back();
    } catch (err: any) {
      if (__DEV__) console.warn('[CreatePost] error:', err?.message);
      Alert.alert('Post failed', err?.message ?? 'Please try again.');
    }
    setPosting(false);
  }

  return (
    <BackgroundWrapper>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[s.content, { paddingTop: insets.top + 10, paddingBottom: insets.bottom + 30 }]}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header */}
          <View style={s.header}>
            <TouchableOpacity onPress={() => router.back()} style={s.closeBtn} activeOpacity={0.7}>
              <Feather name="arrow-left" size={20} color="#8A9BB5" />
            </TouchableOpacity>
            <View style={{ flex: 1 }} />
            <TouchableOpacity
              onPress={handlePost}
              disabled={!imageUri || posting}
              style={[s.postBtn, (!imageUri || posting) && { opacity: 0.35 }]}
              activeOpacity={0.8}
            >
              {posting ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <>
                  <MaterialCommunityIcons name="send" size={16} color="#FFF" />
                  <Text style={s.postBtnText}>Share</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          {/* Hero image area */}
          {imageUri ? (
            <View style={s.previewWrap}>
              <Image source={{ uri: imageUri }} style={s.preview} />
              <View style={s.previewOverlay}>
                <TouchableOpacity style={s.changePhotoBtn} onPress={pickImage} activeOpacity={0.7}>
                  <MaterialCommunityIcons name="image-edit-outline" size={16} color="#FFF" />
                  <Text style={s.changeBtnText}>Change</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <View style={s.heroPickerWrap}>
              <View style={s.heroPickerInner}>
                <MaterialCommunityIcons name="airplane-takeoff" size={40} color="#1E3450" />
                <Text style={s.heroPickerTitle}>Share your flight</Text>
                <Text style={s.heroPickerSub}>Post a photo from the ramp, cockpit, or destination</Text>
                <View style={s.pickerBtnRow}>
                  <TouchableOpacity style={s.pickerBtn} onPress={pickImage} activeOpacity={0.7}>
                    <MaterialCommunityIcons name="image-multiple-outline" size={22} color="#38BDF8" />
                    <Text style={s.pickerBtnText}>Gallery</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.pickerBtn, s.pickerBtnCamera]} onPress={takePhoto} activeOpacity={0.7}>
                    <MaterialCommunityIcons name="camera" size={22} color="#FFF" />
                    <Text style={[s.pickerBtnText, { color: '#FFF' }]}>Camera</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          )}

          {/* Caption */}
          <View style={s.sectionWrap}>
            <View style={s.sectionHeader}>
              <Feather name="edit-3" size={14} color="#5C7A96" />
              <Text style={s.sectionLabel}>CAPTION</Text>
            </View>
            <TextInput
              style={s.captionInput}
              placeholder="What's the story behind this shot?"
              placeholderTextColor="#3A4A5F"
              value={caption}
              onChangeText={setCaption}
              multiline
              maxLength={500}
              textAlignVertical="top"
            />
            <Text style={s.charCount}>{caption.length}/500</Text>
          </View>

          {/* Tag airport */}
          <View style={s.sectionWrap}>
            <View style={s.sectionHeader}>
              <MaterialCommunityIcons name="map-marker-radius-outline" size={14} color="#5C7A96" />
              <Text style={s.sectionLabel}>LOCATION</Text>
            </View>
            {taggedAirport ? (
              <View style={s.taggedRow}>
                <MaterialCommunityIcons name="airplane" size={16} color="#C4611A" />
                <View style={{ flex: 1 }}>
                  <Text style={s.taggedIcao}>{taggedAirport.icao}</Text>
                  <Text style={s.taggedName}>{taggedAirport.name}</Text>
                </View>
                <TouchableOpacity onPress={() => { setTaggedAirport(null); setAirportQuery(''); }} style={s.tagRemoveBtn}>
                  <Feather name="x" size={14} color="#6B83A0" />
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={s.tagAirportBtn}
                onPress={() => setShowAirportSearch(!showAirportSearch)}
                activeOpacity={0.7}
              >
                <MaterialCommunityIcons name="airplane-search" size={18} color="#38BDF8" />
                <Text style={s.tagAirportText}>Tag an airport</Text>
                <Feather name="chevron-right" size={14} color="#2A3A52" style={{ marginLeft: 'auto' }} />
              </TouchableOpacity>
            )}

            {showAirportSearch && !taggedAirport && (
              <View style={s.airportSearchWrap}>
                <View style={s.searchInputRow}>
                  <Feather name="search" size={14} color="#4A5B73" />
                  <TextInput
                    style={s.airportSearchInput}
                    placeholder="ICAO, name, or city..."
                    placeholderTextColor="#3A4A5F"
                    value={airportQuery}
                    onChangeText={setAirportQuery}
                    autoFocus
                  />
                </View>
                {airportResults.map((a, i) => {
                  const id = a.icao || a.faa || a.id || '';
                  return (
                    <TouchableOpacity
                      key={`${id}-${i}`}
                      style={s.airportResult}
                      onPress={() => {
                        setTaggedAirport({ icao: id, name: a.name ?? '' });
                        setShowAirportSearch(false);
                        setAirportQuery('');
                      }}
                      activeOpacity={0.7}
                    >
                      <View style={s.resultIcaoWrap}>
                        <Text style={s.resultIcao}>{id}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={s.resultName} numberOfLines={1}>{a.name}</Text>
                        <Text style={s.resultCity}>{a.city}, {a.state}</Text>
                      </View>
                      <Feather name="plus" size={14} color="#38BDF8" />
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </BackgroundWrapper>
  );
}

const s = StyleSheet.create({
  content: { paddingHorizontal: 20 },

  // ── Header ───────────────────────────────────────────────────────────
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 12,
  },
  closeBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: '#0D1628',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#1E2D42',
  },
  postBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#38BDF8',
    borderRadius: 12,
    paddingHorizontal: 20, paddingVertical: 10,
    shadowColor: '#38BDF8', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 5,
  },
  postBtnText: {
    fontSize: 15, fontWeight: '800', color: '#FFF', letterSpacing: 0.3,
  },

  // ── Hero picker (no image selected) ──────────────────────────────────
  heroPickerWrap: {
    marginBottom: 20,
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#182C44',
  },
  heroPickerInner: {
    alignItems: 'center',
    paddingVertical: 44,
    paddingHorizontal: 24,
    backgroundColor: '#080F1C',
    gap: 8,
  },
  heroPickerTitle: {
    fontSize: 22, fontWeight: '800', color: '#F0F4FF',
    letterSpacing: -0.3, marginTop: 8,
  },
  heroPickerSub: {
    fontSize: 14, color: '#5C7A96', textAlign: 'center',
    lineHeight: 20, marginBottom: 12,
  },
  pickerBtnRow: {
    flexDirection: 'row', gap: 12, marginTop: 8,
  },
  pickerBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 24, paddingVertical: 14,
    backgroundColor: 'rgba(56,189,248,0.08)',
    borderRadius: 14,
    borderWidth: 1, borderColor: 'rgba(56,189,248,0.20)',
  },
  pickerBtnCamera: {
    backgroundColor: '#C4611A',
    borderColor: '#C4611A',
  },
  pickerBtnText: {
    fontSize: 14, fontWeight: '700', color: '#38BDF8',
  },

  // ── Preview (image selected) ─────────────────────────────────────────
  previewWrap: {
    marginBottom: 20,
    borderRadius: 20,
    overflow: 'hidden',
    position: 'relative',
    shadowColor: '#000', shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.4, shadowRadius: 14, elevation: 8,
  },
  preview: {
    width: '100%',
    aspectRatio: 4 / 3,
  },
  previewOverlay: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingVertical: 12, paddingHorizontal: 16,
    flexDirection: 'row', justifyContent: 'flex-end',
  },
  changePhotoBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(0,0,0,0.60)',
    borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
  },
  changeBtnText: {
    fontSize: 12, fontWeight: '600', color: '#FFF',
  },

  // ── Sections ─────────────────────────────────────────────────────────
  sectionWrap: {
    marginBottom: 18,
  },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginBottom: 8,
  },
  sectionLabel: {
    fontSize: 10, fontWeight: '700', color: '#5C7A96',
    letterSpacing: 1.2,
  },

  // ── Caption ──────────────────────────────────────────────────────────
  captionInput: {
    backgroundColor: '#080F1C',
    borderRadius: 14,
    borderWidth: 1, borderColor: '#182C44',
    color: '#F0F4FF',
    fontSize: 15, lineHeight: 22,
    padding: 16,
    minHeight: 90,
  },
  charCount: {
    fontSize: 10, color: '#2A3A52', textAlign: 'right',
    marginTop: 4,
  },

  // ── Tag airport ──────────────────────────────────────────────────────
  tagAirportBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 14, paddingHorizontal: 16,
    backgroundColor: '#080F1C',
    borderRadius: 14,
    borderWidth: 1, borderColor: '#182C44',
  },
  tagAirportText: {
    fontSize: 15, fontWeight: '600', color: '#38BDF8',
  },
  taggedRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 12, paddingHorizontal: 16,
    backgroundColor: 'rgba(196,97,26,0.06)',
    borderRadius: 14,
    borderWidth: 1, borderColor: 'rgba(196,97,26,0.18)',
  },
  taggedIcao: {
    fontSize: 15, fontWeight: '800', color: '#C4611A', letterSpacing: 0.5,
  },
  taggedName: {
    fontSize: 13, color: '#7A96B0', marginTop: 1,
  },
  tagRemoveBtn: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center', justifyContent: 'center',
  },

  // ── Airport search ────────────────────────────────────────────────────
  airportSearchWrap: {
    marginTop: 10,
    backgroundColor: '#080F1C',
    borderRadius: 14,
    borderWidth: 1, borderColor: '#182C44',
    overflow: 'hidden',
  },
  searchInputRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 14, paddingVertical: 2,
    borderBottomWidth: 1, borderBottomColor: '#141E2C',
  },
  airportSearchInput: {
    flex: 1,
    color: '#F0F4FF',
    fontSize: 14,
    paddingVertical: 12,
  },
  airportResult: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 12, paddingHorizontal: 14,
    borderBottomWidth: 1, borderBottomColor: '#0D1520',
  },
  resultIcaoWrap: {
    backgroundColor: 'rgba(196,97,26,0.08)',
    borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3,
  },
  resultIcao: {
    fontSize: 12, fontWeight: '800', color: '#C4611A', letterSpacing: 0.5,
  },
  resultName: {
    fontSize: 13, color: '#C8D8EE', fontWeight: '600',
  },
  resultCity: {
    fontSize: 11, color: '#4A5B73', marginTop: 1,
  },
});
