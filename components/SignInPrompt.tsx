import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Headline shown at top of sheet — customise per context */
  title?: string;
  /** Body copy — customise per context */
  body?: string;
}

export default function SignInPrompt({
  visible,
  onClose,
  title = 'Create a Free Account',
  body = 'Sign up to save airports, track your flights, and plan your next adventure — all in one place.',
}: Props) {
  function goToAuth(mode: 'signup' | 'signin') {
    onClose();
    router.push({ pathname: '/auth', params: { mode } });
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={s.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity style={s.sheet} activeOpacity={1} onPress={() => {}}>
          <View style={s.handle} />
          <View style={s.body}>
            <View style={s.iconRing}>
              <MaterialCommunityIcons name="star-shooting" size={28} color="#FF4D00" />
            </View>
            <Text style={s.title}>{title}</Text>
            <Text style={s.sub}>{body}</Text>
            <TouchableOpacity style={s.primaryBtn} activeOpacity={0.85} onPress={() => goToAuth('signup')}>
              <Text style={s.primaryTxt}>Create Free Account</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.secondaryBtn} activeOpacity={0.75} onPress={() => goToAuth('signin')}>
              <Text style={s.secondaryTxt}>I Already Have an Account</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay:      { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet:        { backgroundColor: '#0D1421', borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderColor: '#1A2D45', paddingBottom: 40 },
  handle:       { width: 36, height: 4, borderRadius: 2, backgroundColor: '#1E2D45', alignSelf: 'center', marginTop: 12, marginBottom: 4 },
  body:         { alignItems: 'center', paddingHorizontal: 24, paddingTop: 16 },
  iconRing:     { width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(255,77,0,0.12)', alignItems: 'center', justifyContent: 'center', marginBottom: 16, borderWidth: 1, borderColor: 'rgba(255,77,0,0.25)' },
  title:        { fontSize: 22, fontWeight: '800', color: '#F0F4FF', textAlign: 'center', marginBottom: 10, letterSpacing: 0.2 },
  sub:          { fontSize: 15, color: '#6B83A0', textAlign: 'center', lineHeight: 22, marginBottom: 28 },
  primaryBtn:   { width: '100%', backgroundColor: '#FF4D00', borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginBottom: 12 },
  primaryTxt:   { color: '#0D1421', fontSize: 16, fontWeight: '800', letterSpacing: 0.3 },
  secondaryBtn: { width: '100%', borderRadius: 14, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: '#1E2D45' },
  secondaryTxt: { color: '#8A9BB5', fontSize: 15, fontWeight: '600' },
});
