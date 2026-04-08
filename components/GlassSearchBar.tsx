/**
 * components/GlassSearchBar.tsx
 *
 * Aviation glassmorphic search bar — glass-cockpit MCDU aesthetic.
 *
 * ─── Tailwind color tokens (add NativeWind later and these drop right in) ───
 *   Glass surface bg:     bg-[rgba(15,22,41,0.82)]
 *   Border resting:       border-[rgba(255,77,0,0.18)]
 *   Border focused:       border-[rgba(255,77,0,0.72)]
 *   Input text:           text-[#F0EDE8]
 *   Placeholder:          text-[#3D5470]
 *   Glow / accent:        #FF4D00
 *   Icon resting:         #2E7070   (muted teal)
 *   Icon focused:         #FF4D00   (orange)
 *
 * ─── Shadow / elevation values ───────────────────────────────────────────────
 *   Resting: shadowOpacity 0.0  | shadowRadius 0   | elevation 2
 *   Focused: shadowOpacity 0.10 | shadowRadius 4   | elevation 3
 *
 * Note: expo-blur (BlurView) is not installed. If you add it, wrap the inner
 * container with <BlurView tint="dark" intensity={30}> for true backdrop blur.
 */

import React, { useCallback, useRef, useState } from 'react';
import {
  Platform,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

// ── Design tokens ─────────────────────────────────────────────────────────────
const ORANGE       = '#FF4D00';
const GLASS_BG     = 'rgba(15,22,41,0.82)';
const BORDER_REST  = 'rgba(255,77,0,0.18)';
const BORDER_FOCUS = 'rgba(255,77,0,0.72)';  // crisp, not glowing
const TEXT_IN      = '#F0EDE8';
const TEXT_PH      = '#5A7A98';
const ICON_REST    = '#4A8080';   // teal — visible at rest
const ICON_FOCUS   = ORANGE;
const HEIGHT       = 56;
const RADIUS       = 16;

// ── Faint horizontal runway lines ─────────────────────────────────────────────
// Simulates the subtle ruled texture on avionics glass displays.
function RunwayLines() {
  // Five lines spaced evenly within the HEIGHT
  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
      {[1, 2, 3, 4, 5].map(i => (
        <View
          key={i}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: (i * HEIGHT) / 6,
            height: StyleSheet.hairlineWidth,
            backgroundColor: 'rgba(255,255,255,0.035)',
          }}
        />
      ))}
    </View>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────
interface GlassSearchBarProps {
  value?: string;
  onChangeText?: (text: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  placeholder?: string;
  style?: ViewStyle;
  /** Pass a ref to get direct access to the inner TextInput (e.g. for autoFocus via ref.focus()) */
  inputRef?: React.RefObject<TextInput | null>;
  autoFocus?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
}

// ── Component ─────────────────────────────────────────────────────────────────
export function GlassSearchBar({
  value = '',
  onChangeText,
  onFocus: onFocusProp,
  onBlur: onBlurProp,
  placeholder = 'Airport, city, or ICAO…',
  style,
  inputRef,
  autoFocus = false,
  autoCapitalize = 'characters',
}: GlassSearchBarProps) {
  // React state drives icon color (Feather doesn't support animated props)
  const [focused, setFocused] = useState(false);

  // Shared value 0 → 1 drives all Reanimated animations
  const focusAnim = useSharedValue(0);

  const handleFocus = useCallback(() => {
    setFocused(true);
    focusAnim.value = withTiming(1, { duration: 200 });
    onFocusProp?.();
  }, [onFocusProp]);

  const handleBlur = useCallback(() => {
    setFocused(false);
    focusAnim.value = withTiming(0, { duration: 280 });
    onBlurProp?.();
  }, [onBlurProp]);

  const handleClear = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onChangeText?.('');
  }, [onChangeText]);

  // Outer container: border color transition only — no spread shadow, no lift.
  // The border IS the focus indicator: precise, tight, avionics-grade.
  const outerAnim = useAnimatedStyle(() => ({
    borderColor: interpolateColor(
      focusAnim.value,
      [0, 1],
      [BORDER_REST, BORDER_FOCUS],
    ),
    // Hairline shadow stays close — just enough to separate from bg, never glows
    shadowOpacity: focusAnim.value * 0.10,
    shadowRadius: 2 + focusAnim.value * 2,
  }));

  const iconColor = focused ? ICON_FOCUS : ICON_REST;

  return (
    // Outer: shadow + border + transform. Must NOT have overflow:hidden —
    // overflow:hidden clips the shadow on iOS.
    <Animated.View style={[styles.outer, outerAnim, style]}>

      {/* Inner: overflow:hidden clips gradients cleanly at the border radius */}
      <View style={styles.inner}>

        {/* Runway line texture */}
        <RunwayLines />

        {/* Top-edge inner glow — cockpit illuminated glass effect */}
        <LinearGradient
          colors={['rgba(255,255,255,0.08)', 'rgba(255,255,255,0)']}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 0.65 }}
          style={StyleSheet.absoluteFillObject}
          pointerEvents="none"
        />

        {/* Bottom-edge warm tint — barely perceptible depth cue when focused */}
        {focused && (
          <LinearGradient
            colors={['rgba(255,77,0,0)', 'rgba(255,77,0,0.04)']}
            start={{ x: 0.5, y: 0.5 }}
            end={{ x: 0.5, y: 1 }}
            style={StyleSheet.absoluteFillObject}
            pointerEvents="none"
          />
        )}

        {/* Content row */}
        <View style={styles.row}>

          {/* Search icon with optional radial glow halo */}
          <View style={styles.iconWrap}>
            {focused && <View style={styles.iconHalo} />}
            <Feather name="search" size={16} color={iconColor} />
          </View>

          {/* Text input */}
          <TextInput
            ref={inputRef}
            style={styles.input}
            value={value}
            onChangeText={onChangeText}
            placeholder={placeholder}
            placeholderTextColor={TEXT_PH}
            onFocus={handleFocus}
            onBlur={handleBlur}
            autoCorrect={false}
            autoCapitalize={autoCapitalize}
            autoFocus={autoFocus}
            returnKeyType="search"
            selectionColor={ORANGE}
            // cursorColor is Android-only; iOS inherits from selectionColor
            {...(Platform.OS === 'android' ? { cursorColor: ORANGE } : {})}
          />

          {/* Clear button — X in a small pill ring */}
          {value.length > 0 && (
            <TouchableOpacity
              onPress={handleClear}
              activeOpacity={0.7}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <View style={styles.clearRing}>
                <Feather name="x" size={9} color="rgba(200,216,238,0.7)" />
              </View>
            </TouchableOpacity>
          )}

        </View>
      </View>
    </Animated.View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  // Outer shell: holds border + shadow + scale transform.
  // overflow must remain default (visible) so iOS shadow isn't clipped.
  outer: {
    height: HEIGHT,
    marginHorizontal: 20,
    borderRadius: RADIUS,
    borderWidth: 1,
    // Static shadow base — animated values override opacity/radius at runtime
    shadowColor: ORANGE,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 3,
  },

  // Inner shell: clips gradients at the rounded corner.
  // backgroundColor lives here so it doesn't fight the outer border.
  inner: {
    flex: 1,
    borderRadius: RADIUS - 1,
    backgroundColor: GLASS_BG,
    overflow: 'hidden',
  },

  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 10,
  },

  iconWrap: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Tight inner disc behind the icon — indicates active state, not a glow
  iconHalo: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(255,77,0,0.10)',
  },

  input: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: TEXT_IN,
    letterSpacing: 0.7,
    backgroundColor: 'transparent',
    // Remove default Android padding so text is vertically centered
    ...Platform.select({ android: { paddingVertical: 0 } }),
  },

  // Small circular ring around the X clear button
  clearRing: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.09)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.13)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
