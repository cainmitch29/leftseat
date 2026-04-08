import AsyncStorage from '@react-native-async-storage/async-storage';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useRef, useState } from 'react';
import { Feather } from '@expo/vector-icons';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { router, useLocalSearchParams } from 'expo-router';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

type Mode = 'signin' | 'signup';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateUsername(u: string): string | null {
  if (u.length === 0) return null;
  if (u.length < 3)  return 'Too short — minimum 3 characters';
  if (u.length > 20) return 'Too long — maximum 20 characters';
  if (!/^[a-z0-9_]+$/.test(u)) return 'Only lowercase letters, numbers, and underscores';
  return null;
}

export default function AuthScreen() {
  const { signIn, signUp, user, needsProfileSetup, clearProfileSetup } = useAuth();
  const params = useLocalSearchParams<{ mode?: string; returnTo?: string }>();
  const [mode, setMode] = useState<Mode>(params.mode === 'signup' ? 'signup' : 'signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [appleLoading, setAppleLoading] = useState(false);
  const passwordRef = useRef<TextInput>(null);

  // Navigate back — or to returnTo destination if coming from welcome screen
  function navDone() {
    if (params.returnTo === 'onboarding') {
      router.replace('/onboarding');
    } else {
      router.back();
    }
  }

  // ── Profile setup step (shown after sign-in when name is missing) ──────────
  const [showProfileStep, setShowProfileStep] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [profileUsername, setProfileUsername] = useState('');
  const [usernameError, setUsernameError] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);

  /** Check whether a name already exists in AsyncStorage or Supabase. */
  async function checkHasName(): Promise<boolean> {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) return false;

      // Check user-keyed profile first, then guest fallback
      const raw = await AsyncStorage.getItem(`userProfile:${userId}`);
      const guestRaw = !raw ? await AsyncStorage.getItem('userProfile:guest') : null;
      const profile = raw ? JSON.parse(raw) : guestRaw ? JSON.parse(guestRaw) : null;
      if (profile?.name?.trim()) {
        if (__DEV__) console.log('[Auth:checkName] found in AsyncStorage:', profile.name);
        return true;
      }

      // Fallback: check Supabase pilot_profiles table
      const { data: dbProfile } = await supabase
        .from('pilot_profiles')
        .select('name')
        .eq('user_id', userId)
        .maybeSingle();
      if (dbProfile?.name?.trim()) {
        if (__DEV__) console.log('[Auth:checkName] found in Supabase:', dbProfile.name);
        return true;
      }

      if (__DEV__) console.log('[Auth:checkName] no name found anywhere');
      return false;
    } catch (e: any) {
      if (__DEV__) console.warn('[Auth:checkName] error:', e?.message);
      return false;
    }
  }

  // Focus state — drives border glow on inputs
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);

  // Button press animation
  const btnScale = useSharedValue(1);
  const btnStyle = useAnimatedStyle(() => ({
    transform: [{ scale: withSpring(btnScale.value, { damping: 18, stiffness: 280 }) }],
  }));

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setMessage(null);
  }

  function validate(): string | null {
    if (!email.trim()) return 'Please enter your email address.';
    if (!EMAIL_RE.test(email.trim())) return 'Please enter a valid email address.';
    if (!password) return 'Please enter your password.';
    if (mode === 'signup' && password.length < 6) return 'Password must be at least 6 characters.';
    return null;
  }

  async function handleSubmit() {
    setError(null);
    setMessage(null);
    const validationError = validate();
    if (validationError) {
      if (__DEV__) console.log('[Auth] validation error:', validationError);
      setError(validationError);
      return;
    }
    if (__DEV__) console.log(`[Auth] login attempt — mode=${mode} email=${email.trim()}`);
    setLoading(true);
    try {
      if (mode === 'signin') {
        const { error } = await signIn(email.trim(), password);
        if (error) {
          if (__DEV__) console.log('[Auth] login failure:', error);
          setError(error);
          setLoading(false);
        } else {
          if (__DEV__) console.log('[Auth] login success');
          setLoading(false);
          // Only show profile step if user has no name saved
          const hasName = await checkHasName();
          if (__DEV__) console.log('[Auth] hasName:', hasName);
          if (hasName) {
            navDone();
          } else {
            setShowProfileStep(true);
          }
        }
      } else {
        const { error } = await signUp(email.trim(), password);
        if (error) {
          if (__DEV__) console.log('[Auth] signup failure:', error);
          setError(error);
          setLoading(false);
        } else {
          if (__DEV__) console.log('[Auth] signup success');
          setMessage('Account created! Sign in below.');
          setMode('signin');
          setLoading(false);
        }
      }
    } catch (e: any) {
      if (__DEV__) console.warn('[Auth] unexpected error:', e?.message ?? e);
      setError('Something went wrong. Please try again.');
      setLoading(false);
    }
  }

  async function handleAppleSignIn() {
    if (__DEV__) console.log('[Auth] Apple button tapped');
    setError(null);
    setAppleLoading(true);
    try {
      if (__DEV__) console.log('[Auth] Apple auth started');
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (__DEV__) console.log('[Auth] Apple auth response received, exchanging with Supabase…');

      const identityToken = credential.identityToken;
      if (!identityToken) throw new Error('Apple sign-in returned no identity token.');

      if (__DEV__) console.log('[Auth] Supabase Apple auth exchange started');
      const { error } = await supabase.auth.signInWithIdToken({
        provider: 'apple',
        token: identityToken,
      });

      if (error) {
        if (__DEV__) console.log('[Auth] Supabase Apple exchange failure:', error.message);
        setError(error.message);
        setAppleLoading(false);
      } else {
        if (__DEV__) console.log('[Auth] Apple sign-in success');
        setAppleLoading(false);
        const hasName = await checkHasName();
        if (__DEV__) console.log('[Auth:Apple] hasName:', hasName);
        if (hasName) {
          navDone();
        } else {
          setShowProfileStep(true);
        }
      }
    } catch (e: any) {
      // ERR_CANCELED = user dismissed the Apple sheet — not an error worth showing
      if (e?.code === 'ERR_REQUEST_CANCELED' || e?.code === 'ERR_CANCELED') {
        if (__DEV__) console.log('[Auth] Apple sign-in cancelled by user');
        setAppleLoading(false);
        return;
      }
      if (__DEV__) console.warn('[Auth] Apple sign-in threw:', e?.message ?? e);
      setError(e?.message ?? 'Apple sign-in failed. Please try again.');
      setAppleLoading(false);
    }
  }

  async function handleForgotPassword() {
    if (!email.trim()) {
      Alert.alert('Reset Password', 'Enter your email address above, then tap Forgot Password.');
      return;
    }
    if (!EMAIL_RE.test(email.trim())) {
      Alert.alert('Reset Password', 'Please enter a valid email address first.');
      return;
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim());
    if (error) {
      Alert.alert('Error', error.message);
    } else {
      Alert.alert('Check your email', 'A password reset link has been sent to ' + email.trim());
    }
  }

  async function handleProfileSave() {
    const trimmedName = profileName.trim();
    if (!trimmedName) { setError('Please enter your name.'); return; }
    const trimmedUsername = profileUsername.trim();
    if (trimmedUsername) {
      const validErr = validateUsername(trimmedUsername);
      if (validErr) { setUsernameError(validErr); return; }
    }

    setProfileSaving(true);
    setError(null);
    try {
      const userId = user?.id;
      if (!userId) { navDone(); return; }

      // Merge into AsyncStorage profile (preserves onboarding data)
      const storageKey = `userProfile:${userId}`;
      const existingRaw = await AsyncStorage.getItem(storageKey);
      const existing = existingRaw ? JSON.parse(existingRaw) : {};
      const updated = { ...existing, name: trimmedName, username: trimmedUsername || existing.username || null };
      await AsyncStorage.setItem(storageKey, JSON.stringify(updated));
      if (__DEV__) console.log('[Auth:profile] AsyncStorage saved —', storageKey);

      // Upsert to Supabase
      try {
        const dbPayload: Record<string, any> = {
          user_id: userId,
          name: trimmedName,
          home_airport: updated.home_airport || null,
          certificate: updated.certificate || null,
          aircraft_type: updated.aircraft_type || null,
        };
        if (trimmedUsername) dbPayload.username = trimmedUsername;
        const { error: upsertErr } = await supabase.from('pilot_profiles').upsert(dbPayload);
        if (upsertErr) console.warn('[Auth:profile] Supabase upsert failed:', upsertErr.message);
        else if (__DEV__) console.log('[Auth:profile] Supabase upsert OK');
      } catch (e: any) {
        console.warn('[Auth:profile] Supabase upsert exception:', e?.message);
      }

      clearProfileSetup();
      navDone();
    } catch (e: any) {
      console.warn('[Auth:profile] save error:', e?.message);
      // Don't block — let them through
      clearProfileSetup();
      navDone();
    } finally {
      setProfileSaving(false);
    }
  }

  function skipProfileStep() {
    clearProfileSetup();
    navDone();
  }

  // ── Profile setup step ────────────────────────────────────────────────────
  if (showProfileStep) {
    return (
      <View style={styles.root}>
        <LinearGradient
          colors={['#060911', '#07101C', '#08132B']}
          locations={[0, 0.48, 1]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <KeyboardAvoidingView
          style={styles.container}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={styles.inner}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.logoWrap}>
              <Feather name="user" size={36} color="#38BDF8" />
            </View>
            <Text style={styles.appName}>Complete Your Profile</Text>
            <Text style={styles.tagline}>
              Tell us your name so other pilots can find you.
            </Text>

            <Text style={styles.profileLabel}>NAME</Text>
            <TextInput
              style={styles.input}
              placeholder="Your name"
              placeholderTextColor="#5A7A98"
              value={profileName}
              onChangeText={setProfileName}
              autoCapitalize="words"
              autoFocus
              returnKeyType="next"
            />

            <Text style={styles.profileLabel}>USERNAME <Text style={styles.profileOptional}>OPTIONAL</Text></Text>
            <TextInput
              style={[styles.input, usernameError ? styles.inputError : null]}
              placeholder="e.g. mitchellcain"
              placeholderTextColor="#5A7A98"
              value={profileUsername}
              onChangeText={text => {
                const clean = text.toLowerCase().replace(/[^a-z0-9_]/g, '');
                setProfileUsername(clean);
                setUsernameError(validateUsername(clean) ?? '');
              }}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={20}
            />
            {usernameError ? (
              <Text style={styles.profileFieldError}>{usernameError}</Text>
            ) : profileUsername.length >= 3 ? (
              <Text style={styles.profileFieldHint}>@{profileUsername}</Text>
            ) : null}

            {error && <Text style={styles.error}>{error}</Text>}

            <Pressable
              style={[styles.btn, profileSaving && styles.btnDisabled]}
              onPress={handleProfileSave}
              disabled={profileSaving}
            >
              <View style={styles.btnHighlight} pointerEvents="none" />
              {profileSaving
                ? <ActivityIndicator color="#070B14" />
                : <Text style={styles.btnText}>Save & Continue</Text>
              }
            </Pressable>

            <TouchableOpacity onPress={skipProfileStep} activeOpacity={0.7} style={styles.skipRow}>
              <Text style={styles.skipText}>Skip for now</Text>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    );
  }

  return (
    // Root: dark base + subtle vertical gradient — removes flat wall, adds atmosphere
    <View style={styles.root}>
      <LinearGradient
        colors={['#060911', '#07101C', '#08132B']}
        locations={[0, 0.48, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      {router.canGoBack() && (
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={{ position: 'absolute', top: 56, left: 20, zIndex: 10, flexDirection: 'row', alignItems: 'center', gap: 4 }}
        >
          <Feather name="chevron-left" size={20} color="#4A5B73" />
          <Text style={{ color: '#4A5B73', fontSize: 15, fontWeight: '500' }}>Back</Text>
        </TouchableOpacity>
      )}

      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.inner}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── Logo / wordmark ─────────────────────────────────────────────── */}
          {/* Subtle glow shadow on logo wrap lifts it from the background     */}
          <View style={styles.logoWrap}>
            <Image source={require('../assets/images/icon.png')} style={styles.logo} />
          </View>
          <Text style={styles.appName}>Left Seat</Text>

          {/* Soft light-sweep accent line — centered under title */}
          <View style={{ alignSelf: 'center', width: 72, height: 1.5, borderRadius: 1, overflow: 'hidden', marginBottom: 10 }}>
            <LinearGradient
              colors={['transparent', 'rgba(255,255,255,0.72)', 'transparent']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={{ flex: 1 }}
            />
          </View>

          <Text style={styles.tagline}>
            Built by a pilot, for pilots.{'\n'}Find your next destination in seconds.
          </Text>

          {/* ── Mode toggle — premium glass segmented control ────────────────── */}
          {/*                                                                      */}
          {/* Track: near-transparent dark glass panel.                           */}
          {/* Active: sky-tinted glass pill with sky border + sky text.           */}
          {/* Inactive: dim text, no fill — clearly deselected.                  */}
          {/* No animation — instant state change feels crisp, not sluggish.     */}
          <View style={styles.toggle}>
            <TouchableOpacity
              style={[styles.toggleBtn, mode === 'signin' && styles.toggleActive]}
              onPress={() => switchMode('signin')}
              activeOpacity={0.8}
            >
              <Text style={[styles.toggleText, mode === 'signin' && styles.toggleTextActive]}>
                Sign In
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.toggleBtn, mode === 'signup' && styles.toggleActive]}
              onPress={() => switchMode('signup')}
              activeOpacity={0.8}
            >
              <Text style={[styles.toggleText, mode === 'signup' && styles.toggleTextActive]}>
                Create Account
              </Text>
            </TouchableOpacity>
          </View>

          {/* ── Email input ──────────────────────────────────────────────────── */}
          {/* Focus state: border brightens to sky ring + subtle shadow.         */}
          {/* Keeps readability paramount — no colored background tint on focus. */}
          <TextInput
            style={[styles.input, emailFocused && styles.inputFocused]}
            placeholder="Email"
            placeholderTextColor="#3A5070"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            autoFocus
            returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()}
            onFocus={() => setEmailFocused(true)}
            onBlur={() => setEmailFocused(false)}
          />

          {/* ── Password input ───────────────────────────────────────────────── */}
          {/* Eye icon: Feather, clean and technical. Hit area generous (44px+). */}
          <View style={[styles.passwordRow, passwordFocused && styles.inputFocused]}>
            <TextInput
              ref={passwordRef}
              style={styles.passwordInput}
              placeholder="Password"
              placeholderTextColor="#3A5070"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              returnKeyType="done"
              onSubmitEditing={handleSubmit}
              onFocus={() => setPasswordFocused(true)}
              onBlur={() => setPasswordFocused(false)}
            />
            <TouchableOpacity
              onPress={() => setShowPassword(v => !v)}
              style={styles.eyeBtn}
              activeOpacity={0.7}
            >
              <Feather name={showPassword ? 'eye-off' : 'eye'} size={18} color="#4A6080" />
            </TouchableOpacity>
          </View>

          {/* ── Forgot password ──────────────────────────────────────────────── */}
          {mode === 'signin' && (
            <TouchableOpacity onPress={handleForgotPassword} activeOpacity={0.7} style={styles.forgotRow}>
              <Text style={styles.forgotText}>Forgot Password?</Text>
            </TouchableOpacity>
          )}

          {/* ── Error / success feedback ─────────────────────────────────────── */}
          {error   && <Text style={styles.error}>{error}</Text>}
          {message && <Text style={styles.success}>{message}</Text>}

          {/* ── Primary CTA — cockpit primary control treatment ─────────────── */}
          {/*                                                                     */}
          {/* Depth model:                                                        */}
          {/*   1. Outer shadow (soft blue glow, not theatrical)                 */}
          {/*   2. 1px top catch-light (glass surface — sky-tinted)              */}
          {/*   3. Scale press 0.97 spring via Reanimated                        */}
          {/*                                                                     */}
          {/* Color: same sky blue — premium treatment, not a new color.         */}
          <Animated.View style={[btnStyle, { marginTop: 4 }]}>
            <Pressable
              style={[styles.btn, loading && styles.btnDisabled]}
              onPressIn={() => { btnScale.value = 0.97; }}
              onPressOut={() => { btnScale.value = 1; }}
              onPress={handleSubmit}
              disabled={loading}
            >
              {/* 1px top catch-light — glass surface micro-detail */}
              <View style={styles.btnHighlight} pointerEvents="none" />
              {loading
                ? <ActivityIndicator color="#070B14" />
                : <Text style={styles.btnText}>
                    {mode === 'signin' ? 'Sign In' : 'Create Account'}
                  </Text>
              }
            </Pressable>
          </Animated.View>

          {/* Helper text */}
          <Text style={styles.helperText}>Join pilots discovering better places to fly</Text>

          {/* ── Divider + Apple sign-in — iOS only ─────────────────────────── */}
          {/*                                                                    */}
          {/* IMPORTANT: Must use AppleAuthenticationButton (native component), */}
          {/* NOT a custom TouchableOpacity + signInAsync. On iPad, Apple's     */}
          {/* AuthenticationServices presents the sign-in sheet as a popover    */}
          {/* anchored to the triggering native button. A custom button has no  */}
          {/* anchor reference, causing ERR_INVALID_OPERATION on iPad.          */}
          {/* The native button also satisfies Apple HIG / App Review.          */}
          {Platform.OS === 'ios' && (
            <>
              <View style={styles.dividerRow}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>or continue with</Text>
                <View style={styles.dividerLine} />
              </View>
              {appleLoading
                ? (
                  <View style={styles.appleLoadingBtn}>
                    <ActivityIndicator color="#EDF3FB" />
                  </View>
                )
                : (
                  <AppleAuthentication.AppleAuthenticationButton
                    buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                    buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                    cornerRadius={14}
                    style={styles.appleNativeBtn}
                    onPress={handleAppleSignIn}
                  />
                )
              }
            </>
          )}

          {/* ── Legal links ──────────────────────────────────────────────────── */}
          <View style={styles.legalRow}>
            <TouchableOpacity
              onPress={() => Linking.openURL('https://leftseatapp.com/privacy')}
              activeOpacity={0.7}
            >
              <Text style={styles.legalLink}>Privacy Policy</Text>
            </TouchableOpacity>
            <Text style={styles.legalDot}>·</Text>
            <TouchableOpacity
              onPress={() => Linking.openURL('https://leftseatapp.com/terms')}
              activeOpacity={0.7}
            >
              <Text style={styles.legalLink}>Terms of Service</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  // ── Layout ────────────────────────────────────────────────────────────────
  // root holds the gradient; container is transparent so gradient shows through
  root: {
    flex: 1,
    backgroundColor: '#060911',   // fallback before gradient renders
  },
  container: {
    flex: 1,
  },
  inner: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingBottom: 44,
  },

  // ── Logo / wordmark ────────────────────────────────────────────────────────
  //
  // logoWrap: isolates the shadow so it doesn't clip the image.
  // Shadow: faint sky-blue ambient glow — present, not theatrical.
  logoWrap: {
    alignSelf: 'center',
    marginBottom: 16,
    shadowColor: '#38BDF8',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.10,
    shadowRadius: 20,
    elevation: 6,
  },
  logo: {
    width: 80,
    height: 80,
    borderRadius: 20,
  },
  appName: {
    fontSize: 34,
    fontWeight: '800',
    color: '#EDF3FB',
    textAlign: 'center',
    letterSpacing: -0.8,
    marginBottom: 6,
  },
  tagline: {
    fontSize: 14,
    color: '#4A5B73',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 40,
  },

  // ── Segmented control — glass instrument selection indicator ───────────────
  //
  // Track: near-transparent dark glass panel with hairline border.
  // padding: 3 creates visual separation between track edge and tab pills.
  // Active tab: sky-tinted glass + sky border + sky text = clear without harsh fill.
  // Inactive: transparent, muted text — reads "not selected" without confusion.
  toggle: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255, 255, 255, 0.025)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#131D2C',
    marginBottom: 22,
    padding: 3,
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: 11,
    alignItems: 'center',
    borderRadius: 11,
  },
  toggleActive: {
    backgroundColor: 'rgba(56, 189, 248, 0.10)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.28)',
    borderRadius: 11,
  },
  toggleText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#3A5070',
    letterSpacing: 0.1,
  },
  toggleTextActive: {
    color: '#38BDF8',
    fontWeight: '700',
  },

  // ── Inputs — dark glass surface ────────────────────────────────────────────
  //
  // Base: slightly elevated above background (darker bg than root gradient).
  // Idle border: hairline `#141F2F` — perceptible but quiet.
  // Focus border: sky ring + soft shadow — confirms interaction, feels precise.
  // Placeholder: `#3A5070` — readable but clearly deselected.
  input: {
    backgroundColor: '#070E1A',
    borderRadius: 13,
    borderWidth: 1,
    borderColor: '#141F2F',
    paddingHorizontal: 16,
    paddingVertical: 15,
    fontSize: 15,
    color: '#EDF3FB',
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.20,
    shadowRadius: 4,
    elevation: 2,
  },
  inputFocused: {
    borderColor: 'rgba(56, 189, 248, 0.40)',
    shadowColor: '#38BDF8',
    shadowOpacity: 0.10,
    shadowRadius: 8,
  },

  // Password row: same glass surface as input — must match exactly.
  // passwordInput gets no background (container owns it).
  passwordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#070E1A',
    borderRadius: 13,
    borderWidth: 1,
    borderColor: '#141F2F',
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.20,
    shadowRadius: 4,
    elevation: 2,
  },
  passwordInput: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 15,
    fontSize: 15,
    color: '#EDF3FB',
  },
  eyeBtn: {
    paddingHorizontal: 14,
    paddingVertical: 14,
  },

  // ── Forgot password ────────────────────────────────────────────────────────
  forgotRow: {
    alignSelf: 'flex-end',
    marginBottom: 18,
    paddingVertical: 2,
  },
  forgotText: {
    fontSize: 13,
    color: '#38BDF8',
    fontWeight: '500',
  },

  // ── Error / success ────────────────────────────────────────────────────────
  error: {
    color: '#F87171',
    fontSize: 13,
    marginBottom: 12,
    textAlign: 'center',
    lineHeight: 18,
  },
  success: {
    color: '#34D399',
    fontSize: 13,
    marginBottom: 12,
    textAlign: 'center',
    lineHeight: 18,
  },

  // ── Primary CTA — cockpit primary control ─────────────────────────────────
  //
  // Depth model (three layers):
  //   Layer 1: box shadow — soft sky-blue ambient lift
  //   Layer 2: 1px catch-light at top edge — glass surface micro-detail
  //   Layer 3: Reanimated scale-spring on press — physical, responsive
  //
  // Color: same sky blue — no new accent. Premium through depth, not hue.
  // overflow: 'hidden' so catch-light clips correctly at borderRadius.
  btn: {
    backgroundColor: '#38BDF8',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    overflow: 'hidden',
    shadowColor: '#38BDF8',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 14,
    elevation: 6,
  },
  btnDisabled: {
    opacity: 0.55,
  },
  // 1px top catch-light — glass surface treatment
  btnHighlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
  },
  btnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#070B14',
    letterSpacing: 0.1,
  },

  // Helper text
  helperText: {
    fontSize: 12,
    color: '#2E3E54',
    textAlign: 'center',
    marginTop: 12,
    letterSpacing: 0.1,
  },

  // ── Divider ────────────────────────────────────────────────────────────────
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 22,
    marginBottom: 14,
    gap: 10,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#0F1A27',
  },
  dividerText: {
    fontSize: 12,
    color: '#2A3A52',
    fontWeight: '500',
    letterSpacing: 0.2,
  },

  // ── Apple button — native component required for iPad popover anchor ────────
  //
  // AppleAuthenticationButton is the only way to get a valid presentation
  // anchor on iPad. Height must be set explicitly (Apple requires >= 44pt).
  appleNativeBtn: {
    width: '100%',
    height: 52,
  },
  // Shown while appleLoading=true (native button is hidden to avoid double-tap)
  appleLoadingBtn: {
    height: 52,
    borderRadius: 14,
    backgroundColor: '#070E1A',
    borderWidth: 1,
    borderColor: '#1A2D44',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Legal ──────────────────────────────────────────────────────────────────
  legalRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    marginTop: 26,
  },
  legalLink: {
    fontSize: 11,
    color: '#3A5070',
    textDecorationLine: 'underline',
  },
  legalDot: {
    fontSize: 11,
    color: '#2A3A52',
  },

  // ── Profile setup step ──────────────────────────────────────────────────
  profileLabel: {
    fontSize: 10, fontWeight: '800', color: '#6B83A0',
    letterSpacing: 1.6, textTransform: 'uppercase', marginBottom: 10,
  },
  profileOptional: { color: '#4A5B73', fontWeight: '700', letterSpacing: 1.4 },
  profileFieldError: { fontSize: 12, color: '#F87171', fontWeight: '500', marginBottom: 12, marginTop: -6, paddingHorizontal: 4 },
  profileFieldHint:  { fontSize: 12, color: '#38BDF8', fontWeight: '500', marginBottom: 12, marginTop: -6, paddingHorizontal: 4 },
  inputError: { borderColor: '#F87171' },
  skipRow:  { alignItems: 'center', paddingVertical: 14 },
  skipText: { fontSize: 14, color: '#6B83A0', fontWeight: '500' },
});
