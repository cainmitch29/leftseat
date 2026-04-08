/**
 * app/welcome.tsx  ·  Entry Screen
 *
 * Shown once before onboarding for first-time users.
 * Offers "Continue as Guest" (→ onboarding) or "Create Account" (→ auth → onboarding).
 */

import { Image, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import Animated, {
  useAnimatedStyle, useSharedValue, withSpring,
} from 'react-native-reanimated';
import { Pressable } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

const SKY = '#38BDF8';

function AnimBtn({
  label, onPress, style, textStyle,
}: { label: string; onPress: () => void; style?: any; textStyle?: any }) {
  const sc = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: withSpring(sc.value, { damping: 18, stiffness: 280 }) }],
  }));
  return (
    <Animated.View style={animStyle}>
      <Pressable
        style={style}
        onPressIn={() => { sc.value = 0.97; }}
        onPressOut={() => { sc.value = 1; }}
        onPress={onPress}
      >
        <View style={s.btnShine} pointerEvents="none" />
        <Text style={textStyle}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

export default function WelcomeScreen() {
  return (
    <SafeAreaView style={s.root} edges={['top', 'bottom']}>
      <LinearGradient
        colors={['#060911', '#07101C', '#08132B']}
        locations={[0, 0.48, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      <View style={s.content}>
        {/* Logo + branding */}
        <View style={s.top}>
          <View style={s.logoWrap}>
            <Image
              source={require('../assets/images/icon.png')}
              style={s.logo}
            />
          </View>
          <Text style={s.appName}>LeftSeat</Text>

          {/* Accent line */}
          <View style={s.accentLine}>
            <LinearGradient
              colors={['transparent', 'rgba(255,255,255,0.60)', 'transparent']}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              style={{ flex: 1 }}
            />
          </View>

          <Text style={s.title}>Find your next{'\n'}reason to fly</Text>
          <Text style={s.sub}>
            No account needed — create one anytime to save your flights and sync your data.
          </Text>
        </View>

        {/* CTAs */}
        <View style={s.bottom}>
          <AnimBtn
            label="Continue as Guest"
            onPress={() => router.replace('/onboarding')}
            style={s.primaryBtn}
            textStyle={s.primaryTxt}
          />

          <AnimBtn
            label="Create Account"
            onPress={() => router.push({ pathname: '/auth', params: { mode: 'signup', returnTo: 'onboarding' } })}
            style={s.secondaryBtn}
            textStyle={s.secondaryTxt}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#060911' },
  content: { flex: 1, paddingHorizontal: 28, justifyContent: 'space-between' },

  // ── Top — logo, title, subtitle ──────────────────────────────────────────
  top: { alignItems: 'center', paddingTop: 48 },
  logoWrap: {
    marginBottom: 16,
    shadowColor: SKY,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.12, shadowRadius: 24,
    elevation: 6,
  },
  logo: { width: 80, height: 80, borderRadius: 20 },
  appName: {
    fontSize: 28, fontWeight: '800', color: '#EDF3FB',
    letterSpacing: -0.5, marginBottom: 10,
  },
  accentLine: {
    width: 72, height: 1.5, borderRadius: 1,
    overflow: 'hidden', marginBottom: 36,
  },
  title: {
    fontSize: 34, fontWeight: '900', color: '#EDF3FB',
    letterSpacing: -0.8, lineHeight: 42, textAlign: 'center',
    marginBottom: 16,
  },
  sub: {
    fontSize: 15, color: '#7A90AA', lineHeight: 24,
    textAlign: 'center', paddingHorizontal: 8,
  },

  // ── Bottom — CTA buttons ─────────────────────────────────────────────────
  bottom: { paddingBottom: 20, gap: 12 },
  primaryBtn: {
    backgroundColor: SKY, borderRadius: 14,
    paddingVertical: 17, alignItems: 'center', overflow: 'hidden',
    shadowColor: SKY, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28, shadowRadius: 18, elevation: 8,
  },
  primaryTxt: {
    fontSize: 16, fontWeight: '800', color: '#030A14', letterSpacing: 0.2,
  },
  secondaryBtn: {
    borderRadius: 14, paddingVertical: 16, alignItems: 'center',
    borderWidth: 1, borderColor: '#1E2D42', overflow: 'hidden',
  },
  secondaryTxt: {
    fontSize: 15, fontWeight: '600', color: '#6B83A0',
  },
  btnShine: {
    position: 'absolute', top: 0, left: 0, right: 0,
    height: 1, backgroundColor: 'rgba(255,255,255,0.15)',
  },
});
