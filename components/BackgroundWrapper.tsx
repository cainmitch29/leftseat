/**
 * components/BackgroundWrapper.tsx
 *
 * Global cinematic background — the single source of truth for every screen.
 *
 * Palette:
 *   Top    #0B1A2A  — deep cool navy, slight altitude feel
 *   Mid    #08121E  — near-black ocean
 *   Bottom #050A12  — grounded dark base
 *
 * Two stacked layers:
 *   1. Primary — vertical gradient, the foundational atmosphere
 *   2. Depth   — diagonal blue-tinted accent at ~6% opacity, breaks flatness
 *               and adds the subtle dimensionality that reads as cinematic depth
 *
 * Usage:
 *   <BackgroundWrapper>
 *     <YourScreenContent />
 *   </BackgroundWrapper>
 *
 * The wrapper is flex: 1. Do NOT set backgroundColor on the screen's root
 * container — let this own it.
 */

import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View, ViewStyle } from 'react-native';

interface Props {
  children: React.ReactNode;
  style?: ViewStyle;
}

export default function BackgroundWrapper({ children, style }: Props) {
  return (
    <View style={[styles.root, style]}>
      {/* Layer 1: Primary vertical gradient */}
      <LinearGradient
        colors={['#0B1A2A', '#08121E', '#050A12']}
        locations={[0, 0.50, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      {/* Layer 2: Diagonal depth accent — makes the background feel dimensional */}
      <LinearGradient
        colors={['rgba(30, 68, 130, 0.08)', 'transparent', 'rgba(4, 8, 18, 0.12)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
