import AsyncStorage from '@react-native-async-storage/async-storage';
import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { router, Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle, useSharedValue, withTiming,
} from 'react-native-reanimated';
import 'react-native-reanimated';
import { AuthProvider } from '../contexts/AuthContext';
import { ProfilePhotoProvider } from '../contexts/ProfilePhotoContext';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const noiseSrc = require('../assets/images/noise.png') as number;

// Keep the native splash visible until our JS is ready to take over.
SplashScreen.preventAutoHideAsync();

// ── Global atmosphere overlay ───────────────────────────────────────────────────
// Sits above all screens, pointerEvents="none" so it never blocks interaction.
// Warm top glow anchors the header region; dark bottom grounds the tab bar.
// Gradient is concentrated at edges — middle ~60% of screen stays transparent.

function AtmosphereLayer() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* Top lighting — subtle cool-blue glow at header region */}
      <LinearGradient
        colors={[
          'rgba(20,55,110,0.09)',
          'transparent',
          'transparent',
          'rgba(0,0,0,0.20)',
        ]}
        locations={[0, 0.28, 0.68, 1]}
        style={StyleSheet.absoluteFill}
      />
      {/* Film grain — static 256×256 noise tile, 3% opacity, imperceptible but felt */}
      <Image
        source={noiseSrc}
        style={[StyleSheet.absoluteFill, { opacity: 0.032 }]}
        resizeMode="repeat"
      />
    </View>
  );
}

export const unstable_settings = {
  anchor: '(tabs)',
};

// ── In-app splash overlay ──────────────────────────────────────────────────────

function AppSplash({ visible }: { visible: boolean }) {
  const opacity = useSharedValue(1);
  const [mounted, setMounted] = useState(true);

  // All hooks must be called before any conditional return.
  const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  useEffect(() => {
    if (!visible) {
      opacity.value = withTiming(0, { duration: 500 });
      const t = setTimeout(() => setMounted(false), 500);
      return () => clearTimeout(t);
    }
  }, [visible]);

  if (!mounted) return null;

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.splash, animStyle]}>
      <Image
        source={require('../assets/images/icon.png')}
        style={styles.splashIcon}
      />
      <Text style={styles.splashTitle}>LeftSeat</Text>
      <Text style={styles.splashTagline}>Fly beyond the runway</Text>
    </Animated.View>
  );
}

// ── Root navigator ─────────────────────────────────────────────────────────────

function RootNavigator() {
  // 'checking' = not yet read AsyncStorage | 'needed' = new user | 'done' = returning user
  const [onboardingState, setOnboardingState] = useState<'checking' | 'needed' | 'done'>('checking');
  const [splashVisible, setSplashVisible] = useState(true);
  const splashStart = useRef(Date.now());

  // Check onboarding completion on mount — no auth required.
  // Checks both the new key and the legacy key so existing users aren't re-onboarded.
  useEffect(() => {
    (async () => {
      try {
        const newFlag = await AsyncStorage.getItem('hasCompletedOnboarding');
        if (newFlag === 'true') {
          if (__DEV__) console.log('[App] onboarding check → done (new key)');
          setOnboardingState('done');
          return;
        }
        // Check legacy key for users who onboarded before the key was renamed
        const legacyFlag = await AsyncStorage.getItem('onboardingComplete:guest');
        if (legacyFlag === 'true') {
          // Migrate: write the new key so this check only runs once
          await AsyncStorage.setItem('hasCompletedOnboarding', 'true');
          if (__DEV__) console.log('[App] onboarding check → done (migrated from legacy key)');
          setOnboardingState('done');
          return;
        }
        if (__DEV__) console.log('[App] onboarding check → needed');
        setOnboardingState('needed');
      } catch {
        if (__DEV__) console.warn('[App] AsyncStorage read failed — defaulting to onboarding');
        setOnboardingState('needed');
      }
    })();
  }, []);

  // Navigate once onboarding state is resolved.
  useEffect(() => {
    if (onboardingState === 'checking') return;
    if (onboardingState === 'needed') {
      if (__DEV__) console.log('[App] onboarding needed → /welcome');
      router.replace('/welcome');
    } else {
      if (__DEV__) console.log('[App] onboarding done → /(tabs)');
      router.replace('/(tabs)');
    }
  }, [onboardingState]);

  // Hide splash once onboarding state is resolved, with a minimum display time.
  useEffect(() => {
    if (onboardingState === 'checking') return;
    const elapsed = Date.now() - splashStart.current;
    const delay = Math.max(0, 1200 - elapsed);
    const t = setTimeout(() => setSplashVisible(false), delay);
    return () => clearTimeout(t);
  }, [onboardingState]);

  return (
    <>
      <Stack>
        <Stack.Screen name="(tabs)"        options={{ headerShown: false }} />
        <Stack.Screen name="welcome"       options={{ headerShown: false }} />
        <Stack.Screen name="auth"          options={{ headerShown: false }} />
        <Stack.Screen name="onboarding"    options={{ headerShown: false }} />
        <Stack.Screen name="airport"       options={{ headerShown: false }} />
        <Stack.Screen name="adventures"    options={{ headerShown: false }} />
        <Stack.Screen name="achievements"  options={{ headerShown: false }} />
        <Stack.Screen name="pilot-profile"      options={{ headerShown: false }} />
        <Stack.Screen name="community-profile" options={{ headerShown: false }} />
        <Stack.Screen name="settings"          options={{ headerShown: false }} />
        <Stack.Screen name="route"             options={{ headerShown: false }} />
        <Stack.Screen name="dog-airports"      options={{ headerShown: false }} />
        <Stack.Screen name="my-reviews"       options={{ headerShown: false }} />
        <Stack.Screen name="follow-list"      options={{ headerShown: false }} />
        <Stack.Screen name="notifications"    options={{ headerShown: false }} />
        <Stack.Screen name="my-activity"      options={{ headerShown: false }} />
        <Stack.Screen name="achievement-detail" options={{ headerShown: false }} />
        <Stack.Screen name="modal"             options={{ presentation: 'modal', title: 'Modal' }} />
      </Stack>
      <AppSplash visible={splashVisible} />
    </>
  );
}

// ── Root layout ────────────────────────────────────────────────────────────────

export default function RootLayout() {
  useEffect(() => {
    // Hand off from the native splash to our custom in-app splash immediately.
    SplashScreen.hideAsync();

    // Configure foreground notification presentation (lazy — safe in Expo Go)
    import('expo-notifications').then(async (Notifications) => {
      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: true,
          shouldPlaySound: true,
          shouldSetBadge: false,
          shouldShowList: true,
        }),
      });

      // Schedule weekly local notification (Saturday 9am) — only if not already scheduled
      try {
        const existing = await Notifications.getAllScheduledNotificationsAsync();
        const hasWeekly = existing.some(n => (n.content.data as any)?.type === 'weekly_flyout');
        if (!hasWeekly) {
          const { status } = await Notifications.getPermissionsAsync();
          if (status === 'granted') {
            await Notifications.scheduleNotificationAsync({
              content: {
                title: 'Where are you flying this weekend?',
                body: 'Check out new pilot reports and destinations near you.',
                data: { type: 'weekly_flyout' },
              },
              trigger: {
                type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
                weekday: 7, // Saturday
                hour: 9,
                minute: 0,
              },
            });
            if (__DEV__) console.log('[Notifications] weekly flyout scheduled for Saturdays 9am');
          }
        }
      } catch (e) {
        if (__DEV__) console.warn('[Notifications] weekly schedule error:', e);
      }
    }).catch(() => { /* Expo Go — no native module, silently skip */ });
  }, []);

  return (
    <AuthProvider>
      <ProfilePhotoProvider>
        <ThemeProvider value={DarkTheme}>
          <View style={{ flex: 1, backgroundColor: '#050A12' }}>
            <RootNavigator />
            <AtmosphereLayer />
          </View>
          <StatusBar style="light" />
        </ThemeProvider>
      </ProfilePhotoProvider>
    </AuthProvider>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  splash: {
    backgroundColor: '#060B16',
    alignItems: 'center',
    justifyContent: 'center',
  },
  splashIcon: {
    width: 88,
    height: 88,
    borderRadius: 22,
    marginBottom: 20,
  },
  splashTitle: {
    fontSize: 32,
    fontWeight: '800',
    color: '#F0F4FF',
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  splashTagline: {
    fontSize: 14,
    color: '#4A5B73',
    fontWeight: '500',
    letterSpacing: 0.3,
  },
});
