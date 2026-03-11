import { Platform } from 'react-native';

// Left Seat — Sectional Chart Theme
export const Colors = {
  dark: {
    // Backgrounds
    background: '#070B14',
    surface: '#0D1421',
    card: '#111827',
    border: '#1E2D45',

    // Text
    text: '#F0F4FF',
    textSecondary: '#8A9BB5',
    muted: '#4A5B73',

    // Accents
    tint: '#38BDF8',        // Sky blue — primary accent
    accent: '#38BDF8',
    accentAlt: '#0EA5E9',
    orange: '#F97316',      // Keep for VFR/warnings

    // Status
    vfr: '#22C55E',
    mvfr: '#38BDF8',
    ifr: '#EF4444',
    lifr: '#A855F7',

    // Tab bar
    tabIconDefault: '#4A5B73',
    tabIconSelected: '#38BDF8',

    // Chart-inspired
    chartBlue: '#1E3A5F',
    chartCyan: '#38BDF8',
    chartMagenta: '#C026D3',
  },
  light: {
    background: '#F0F4FF',
    surface: '#FFFFFF',
    card: '#E8EFF8',
    border: '#C5D3E8',
    text: '#0D1421',
    textSecondary: '#4A5B73',
    muted: '#8A9BB5',
    tint: '#0EA5E9',
    accent: '#0EA5E9',
    accentAlt: '#38BDF8',
    orange: '#F97316',
    vfr: '#16A34A',
    mvfr: '#0EA5E9',
    ifr: '#DC2626',
    lifr: '#9333EA',
    tabIconDefault: '#8A9BB5',
    tabIconSelected: '#0EA5E9',
    chartBlue: '#1E3A5F',
    chartCyan: '#0EA5E9',
    chartMagenta: '#C026D3',
  },
};

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
});

// Typography scale
export const Typography = {
  hero: { fontSize: 32, fontWeight: '800' as const, letterSpacing: -0.5 },
  title: { fontSize: 22, fontWeight: '700' as const, letterSpacing: -0.3 },
  subtitle: { fontSize: 17, fontWeight: '600' as const },
  body: { fontSize: 14, fontWeight: '400' as const },
  caption: { fontSize: 12, fontWeight: '500' as const },
  label: { fontSize: 10, fontWeight: '700' as const, letterSpacing: 1.5, textTransform: 'uppercase' as const },
  mono: { fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },
};

// Spacing
export const Spacing = {
  xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48,
};

// Border radius
export const Radius = {
  sm: 6, md: 10, lg: 14, xl: 20, full: 999,
};