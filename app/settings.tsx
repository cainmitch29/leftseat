/**
 * app/settings.tsx
 *
 * Dedicated settings screen — reached by tapping the ⚙️ gear on the Profile tab.
 * Navigate here with: router.push('/settings')
 */

import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { MaterialCommunityIcons, Feather } from '@expo/vector-icons';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../contexts/AuthContext';
import { supabase, SUPABASE_URL } from '../lib/supabase';
import { LinearGradient } from 'expo-linear-gradient';
import BackgroundWrapper from '../components/BackgroundWrapper';

export default function SettingsScreen() {
  const router = useRouter();
  const { signOut, user } = useAuth();
  const insets = useSafeAreaInsets();

  const [isPublic, setIsPublic]             = useState(true);
  const [appInfoVisible, setAppInfoVisible] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);

  // Load the user's current visibility setting
  useEffect(() => {
    if (!user) return;
    supabase
      .from('pilot_profiles')
      .select('is_public')
      .eq('user_id', user.id)
      .single()
      .then(({ data }) => {
        if (data) setIsPublic(data.is_public ?? true);
      });
  }, [user?.id]);

  async function togglePublicProfile() {
    if (!user) return;
    const newVal = !isPublic;
    setIsPublic(newVal);
    await supabase
      .from('pilot_profiles')
      .update({ is_public: newVal })
      .eq('user_id', user.id);
  }

  function handleSignOut() {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: () => signOut() },
    ]);
  }

  function handleDeleteAccount() {
    Alert.alert(
      'Delete Account',
      'This will permanently delete your account, flights, bucket list, and all your data. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete My Account',
          style: 'destructive',
          onPress: confirmDeleteAccount,
        },
      ],
    );
  }

  async function confirmDeleteAccount() {
    if (!user) return;
    setDeletingAccount(true);
    try {
      // refreshSession() forces a server-side token refresh — getSession() only
      // returns the cached local session which may contain an expired JWT.
      const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
      const token = refreshData?.session?.access_token;
      if (__DEV__) {
        console.log('[DeleteAccount] refresh error:', refreshError?.message ?? 'none');
        console.log('[DeleteAccount] token exists:', !!token, token ? `| starts: ${token.slice(0, 10)}… ends: …${token.slice(-10)}` : '');
      }
      if (refreshError || !token) throw new Error('Session expired — please sign in again.');

      // Call edge function directly so we can read the full response body
      const res = await fetch(`${SUPABASE_URL}/functions/v1/delete-account`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      let body: any = null;
      const rawText = await res.text();
      if (__DEV__) console.log('[DeleteAccount] status:', res.status, '| raw:', rawText.slice(0, 300));
      try { body = JSON.parse(rawText); } catch {}

      if (!res.ok) {
        const msg = body?.error ?? body?.msg ?? `Server error ${res.status}`;
        const stage = body?.stage ?? 'unknown';
        if (__DEV__) console.error('[DeleteAccount] failed — stage:', stage, '| error:', msg);
        throw new Error(msg);
      }

      // Sign out locally — auth user is gone server-side
      await signOut();
    } catch (e: any) {
      setDeletingAccount(false);
      if (__DEV__) console.error('[DeleteAccount] catch:', e?.message);
      Alert.alert('Error', e?.message ?? 'Could not delete account. Please try again.');
    }
  }

  return (
    <BackgroundWrapper>
    <ScrollView
      style={[s.root, { paddingTop: insets.top }]}
      contentContainerStyle={s.content}
      showsVerticalScrollIndicator={false}
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <TouchableOpacity style={s.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
        <Text style={s.backTxt}>‹ Back</Text>
      </TouchableOpacity>
      <Text style={s.title}>Settings</Text>

      {/* ── Section 1: Profile ─────────────────────────────────────────────── */}
      <View style={s.sectionLabelRow}>
        <View style={s.sectionAccent} />
        <Text style={s.sectionLabel}>Profile</Text>
      </View>
      <View style={s.card}>
        <View style={s.cardHighlight} pointerEvents="none" />
        <Pressable
          style={({ pressed }) => [s.row, s.rowBorder, pressed && s.rowPressed]}
          onPress={() => router.push('/pilot-profile')}
        >
          <View style={[s.iconWrap, s.iconWrapOrange]}>
            <MaterialCommunityIcons name="airplane" size={20} color="#C4611A" />
          </View>
          <Text style={s.rowLabel}>Pilot Information</Text>
          <Feather name="chevron-right" size={14} color="#1E3450" />
        </Pressable>
        <Pressable
          style={({ pressed }) => [s.row, s.rowBorder, pressed && s.rowPressed]}
          onPress={togglePublicProfile}
        >
          <View style={s.iconWrap}>
            <Feather name="users" size={18} color="#4E6E8A" />
          </View>
          <Text style={s.rowLabel}>Public Profile</Text>
          <View style={[s.toggleTrack, isPublic && s.toggleTrackOn]}>
            <View style={[s.toggleThumb, isPublic && s.toggleThumbOn]} />
          </View>
        </Pressable>
        <Pressable
          style={({ pressed }) => [s.row, pressed && s.rowPressed]}
        >
          <View style={s.iconWrap}>
            <Feather name="bell" size={18} color="#4E6E8A" />
          </View>
          <Text style={s.rowLabel}>Notifications</Text>
          <Feather name="chevron-right" size={14} color="#1E3450" />
        </Pressable>
      </View>

      {/* ── Section 2: About ───────────────────────────────────────────────── */}
      <View style={s.sectionLabelRow}>
        <View style={s.sectionAccent} />
        <Text style={s.sectionLabel}>About</Text>
      </View>
      <View style={s.card}>
        <View style={s.cardHighlight} pointerEvents="none" />
        <Pressable
          style={({ pressed }) => [s.row, pressed && s.rowPressed]}
          onPress={() => setAppInfoVisible(true)}
        >
          <View style={s.iconWrap}>
            <Feather name="file-text" size={18} color="#4E6E8A" />
          </View>
          <Text style={s.rowLabel}>App Info</Text>
          <Feather name="chevron-right" size={14} color="#1E3450" />
        </Pressable>
      </View>

      {/* ── Section 3: Account ─────────────────────────────────────────────── */}
      <View style={[s.sectionLabelRow, { marginTop: 40 }]}>
        <View style={s.sectionAccent} />
        <Text style={s.sectionLabel}>Account</Text>
      </View>
      <View style={s.card}>
        <View style={s.cardHighlight} pointerEvents="none" />
        {user ? (
          <>
            <View style={[s.row, s.rowBorder]}>
              <View style={s.iconWrap}>
                <Feather name="user" size={18} color="#4E6E8A" />
              </View>
              <Text style={[s.rowLabel, { flex: 1 }]} numberOfLines={1}>{user.email}</Text>
            </View>
            <Pressable
              style={({ pressed }) => [s.row, s.rowBorder, pressed && s.rowPressedDestructive]}
              onPress={handleSignOut}
            >
              <View style={[s.iconWrap, s.iconWrapRed]}>
                <Feather name="log-out" size={18} color="#7A5555" />
              </View>
              <Text style={[s.rowLabel, s.destructive]}>Sign Out</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [s.row, pressed && s.rowPressedDestructive]}
              onPress={handleDeleteAccount}
              disabled={deletingAccount}
            >
              <View style={[s.iconWrap, s.iconWrapRed]}>
                <Feather name="trash-2" size={18} color="#7A5555" />
              </View>
              <Text style={[s.rowLabel, s.destructive]}>
                {deletingAccount ? 'Deleting…' : 'Delete Account'}
              </Text>
            </Pressable>
          </>
        ) : (
          <>
            <View style={s.signInBanner}>
              <Feather name="lock" size={14} color="#3A5070" style={{ marginBottom: 6 }} />
              <Text style={s.signInBannerTitle}>Sync your data</Text>
              <Text style={s.signInBannerSub}>
                Sign in to back up your flights, bucket list, and settings across devices.
              </Text>
            </View>
            <Pressable
              style={({ pressed }) => [s.row, pressed && s.rowPressed]}
              onPress={() => router.push('/auth')}
            >
              <View style={[s.iconWrap, s.iconWrapSky]}>
                <Feather name="log-in" size={18} color="#2A6A8A" />
              </View>
              <Text style={[s.rowLabel, s.skyLabel]}>Sign In / Create Account</Text>
              <Feather name="chevron-right" size={14} color="#1E3450" />
            </Pressable>
          </>
        )}
      </View>

      {/* ── App Info modal ─────────────────────────────────────────────────── */}
      <Modal
        visible={appInfoVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setAppInfoVisible(false)}
      >
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setAppInfoVisible(false)}>
          <TouchableOpacity style={s.modalSheet} activeOpacity={1} onPress={() => {}}>
            <View style={s.modalHandle} />
            <Text style={s.modalAppName}>LeftSeat</Text>
            <Text style={s.modalVersion}>Version 1.0</Text>
            <Text style={s.modalDesc}>
              LeftSeat is your aviation companion — discover airports, plan flights, log destinations, and explore what's beyond the runway.
            </Text>
            <View style={s.modalDivider} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <Feather name="mail" size={14} color="#8A9BB5" />
              <Text style={s.modalRow}>Support: support@leftseat.app</Text>
            </View>
            <Text style={s.modalRow}>🔒  Privacy Policy: leftseat.app/privacy</Text>
            <Text style={s.modalRow}>📋  Terms of Use: leftseat.app/terms</Text>
            <TouchableOpacity style={s.modalCloseBtn} onPress={() => setAppInfoVisible(false)}>
              <Text style={s.modalCloseBtnText}>Close</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </ScrollView>

    {/* Bottom depth vignette — fades the empty space into atmosphere, not flat black.
        Absolute-positioned so it never affects layout or scroll behavior. */}
    <LinearGradient
      colors={['transparent', 'rgba(6, 9, 16, 0.82)']}
      style={s.bottomVignette}
      pointerEvents="none"
    />
    </BackgroundWrapper>
  );
}

// ── Glass Cockpit Plate System ────────────────────────────────────────────────
//
// Three-layer depth model:
//
//  1. CARD SHADOW — elevation lives on the card, not individual rows.
//     shadowOpacity: 0.40 / radius: 14 / offset (0, 5) — noticeable but not dramatic.
//     To increase depth: raise shadowOpacity toward 0.55 and radius toward 20.
//     To reduce depth: lower shadowOpacity toward 0.25 and radius toward 8.
//
//  2. CARD BORDER + CATCH LIGHT — the 1px border (#182C44) defines the plate edge.
//     `cardHighlight` is a 1px absolute View at the top of each card at ~7% white-blue
//     opacity — simulates light catching the top glass edge (instrument bezel).
//     To intensify: increase rgba alpha toward 0.14. To remove: delete the View.
//
//  3. ROW PRESSED STATE — `rowPressed` uses a 7% sky-blue tint on press.
//     This reads as the row "activating" — like an EFIS display selecting.
//     `rowPressedDestructive` uses a faint red tint for the Sign Out row.
//     To tune intensity: adjust the rgba alpha value in rowPressed.
//
// ─────────────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: 'transparent' },
  content: { paddingHorizontal: 0, paddingBottom: 100 },

  // Bottom vignette — absolute, sits above scroll content, behind all UI.
  // Fades the dead space at the bottom into depth rather than flat black.
  // To intensify: raise the rgba alpha toward 0.95.
  // To extend reach: increase height toward 180.
  bottomVignette: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    height: 130,
    pointerEvents: 'none',
  },

  // Header
  backBtn: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4 },
  backTxt: { fontSize: 17, color: '#38BDF8', fontWeight: '500' },
  title:   { fontSize: 28, fontWeight: '800', color: '#F0F4FF', letterSpacing: -0.4, paddingHorizontal: 20, marginTop: 8, marginBottom: 28 },

  // Section labels — panel-style with left accent bar
  sectionLabelRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 20, marginBottom: 10, marginTop: 28,
  },
  sectionAccent: {
    width: 2, height: 11, borderRadius: 1,
    backgroundColor: '#C4611A',  // aviation orange — restrained, not bright
  },
  sectionLabel: {
    fontSize: 11, fontWeight: '700', color: '#5C7A96',  // higher contrast than before
    letterSpacing: 1.4, textTransform: 'uppercase',
  },

  // ── Glass cockpit card ──────────────────────────────────────────────────────
  // Layer 1: card is the elevation unit. Shadow lives here.
  card: {
    marginHorizontal: 16,
    backgroundColor: '#080F1C',   // near-black cockpit glass
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#182C44',       // crisp cool-navy edge — the "bezel"
    overflow: 'hidden',
    // Elevation — noticeable, not theatrical
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.40,
    shadowRadius: 14,
    elevation: 7,
  },

  // Layer 2: 1px catch-light at the top of the card.
  // Absolute so it floats above content without affecting layout.
  cardHighlight: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    height: 1,
    backgroundColor: 'rgba(140, 190, 255, 0.07)',  // glass edge reflection
    zIndex: 1,
  },

  // ── Rows ────────────────────────────────────────────────────────────────────
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 16, paddingHorizontal: 18, gap: 14,
    backgroundColor: 'transparent',
  },
  // Layer 3: pressed state — "EFIS select" blue tint
  rowPressed:            { backgroundColor: 'rgba(38, 108, 188, 0.07)' },
  rowPressedDestructive: { backgroundColor: 'rgba(160, 70, 70, 0.06)' },

  // Separator — slightly inset feel via subtle opacity
  rowBorder: { borderBottomWidth: 1, borderBottomColor: 'rgba(24, 44, 68, 0.90)' },

  // ── Icon plate system ────────────────────────────────────────────────────────
  // Each icon lives in a 36×36 rounded container — the "instrument plate".
  // The plate tint matches the icon hue at ~9% fill + ~13% border.
  // This separates icon color from icon size concerns: change icon color here,
  // the plate tints automatically because they're the same rgba base.
  //
  // Variants:
  //   iconWrap         — default: steel-blue (most rows)
  //   iconWrapOrange   — aviation orange: navigation/primary only (Pilot Info)
  //   iconWrapRed      — muted red: destructive only (Sign Out)
  //
  // To reuse on other screens: copy these three styles verbatim and import
  // MaterialCommunityIcons / Feather at matching sizes (18–20px).
  iconWrap: {
    width: 36, height: 36, borderRadius: 10, flexShrink: 0,
    backgroundColor: 'rgba(78, 110, 138, 0.09)',
    borderWidth: 1, borderColor: 'rgba(78, 110, 138, 0.13)',
    alignItems: 'center', justifyContent: 'center',
  },
  iconWrapOrange: {
    backgroundColor: 'rgba(196, 97, 26, 0.09)',
    borderColor:     'rgba(196, 97, 26, 0.16)',
  },
  iconWrapRed: {
    backgroundColor: 'rgba(140, 70, 70, 0.08)',
    borderColor:     'rgba(140, 70, 70, 0.12)',
  },
  iconWrapSky: {
    backgroundColor: 'rgba(42, 106, 138, 0.10)',
    borderColor:     'rgba(42, 106, 138, 0.18)',
  },

  rowLabel: { flex: 1, fontSize: 15, color: '#EDF3FB', fontWeight: '600', letterSpacing: 0.05 },
  skyLabel: { color: '#38BDF8' },

  // Sign-in prompt banner — shown at top of Account card when logged out
  signInBanner: {
    paddingHorizontal: 18, paddingTop: 18, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: 'rgba(24, 44, 68, 0.90)',
    alignItems: 'flex-start', gap: 2,
  },
  signInBannerTitle: {
    fontSize: 14, fontWeight: '700', color: '#8A9BB5',
  },
  signInBannerSub: {
    fontSize: 13, color: '#3A5070', lineHeight: 19, fontWeight: '400',
  },
  destructive: { color: '#B87070' },  // brick rose — desaturated, calm, not alarming

  // Toggle switch — matches card palette
  toggleTrack: {
    width: 44, height: 26, borderRadius: 13,
    backgroundColor: '#152034',
    borderWidth: 1, borderColor: '#1E3350',
    justifyContent: 'center', paddingHorizontal: 3,
  },
  toggleTrackOn:  { backgroundColor: '#0E7CBD', borderColor: '#38BDF8' },
  toggleThumb:    { width: 20, height: 20, borderRadius: 10, backgroundColor: '#C8D8EC', alignSelf: 'flex-start' },
  toggleThumbOn:  { alignSelf: 'flex-end', backgroundColor: '#fff' },

  // App Info modal
  modalOverlay:      { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' },
  modalSheet:        { backgroundColor: '#0D1421', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 44, borderTopWidth: 1, borderColor: '#1E2D45' },
  modalHandle:       { width: 36, height: 4, borderRadius: 2, backgroundColor: '#243550', alignSelf: 'center', marginBottom: 20 },
  modalAppName:      { fontSize: 22, fontWeight: '800', color: '#F0F4FF', textAlign: 'center', marginBottom: 4 },
  modalVersion:      { fontSize: 13, color: '#38BDF8', textAlign: 'center', fontWeight: '600', marginBottom: 16 },
  modalDesc:         { fontSize: 14, color: '#8A9BB5', textAlign: 'center', lineHeight: 22, marginBottom: 20 },
  modalDivider:      { height: 1, backgroundColor: '#1E2D45', marginBottom: 16 },
  modalRow:          { fontSize: 14, color: '#8A9BB5', marginBottom: 10 },
  modalCloseBtn:     { marginTop: 20, backgroundColor: '#1E2D45', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  modalCloseBtnText: { fontSize: 15, fontWeight: '600', color: '#F0F4FF' },
});
