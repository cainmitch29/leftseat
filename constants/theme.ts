/**
 * constants/theme.ts
 *
 * LeftSeat Design System — single source of truth.
 *
 * Built from the glass cockpit aesthetic established across Settings,
 * Bucket List, Profile, Events, and Hangar screens.
 *
 * ── Exports ───────────────────────────────────────────────────────────────────
 *   Colors      — full color palette (background, glass, text, accent, wx)
 *   Surfaces    — pre-built View style objects for card / row / input surfaces
 *   Elevation   — shadow presets: sm / md / lg
 *   Borders     — border helpers: standard, separator, highlight
 *   Typography  — all text styles in one place
 *   Spacing     — layout constants (padding, gaps, row heights)
 *   Radius      — border radius scale
 *   Icons       — icon size, color, and container rules
 *
 * ── How to use ────────────────────────────────────────────────────────────────
 *   import { Colors, Surfaces, Elevation, Typography, Spacing } from '../constants/theme';
 *
 *   // In a StyleSheet:
 *   card: { ...Surfaces.card },
 *   title: { ...Typography.screenTitle, marginBottom: Spacing.sm },
 *
 *   // Inline (color only):
 *   <Text style={{ color: Colors.accent.orange }}>KSUS</Text>
 *
 * ── What NOT to do ────────────────────────────────────────────────────────────
 *   ✗ Hard-code '#38BDF8' in a new file — use Colors.accent.sky
 *   ✗ Write { shadowOpacity: 0.4, shadowRadius: 14 } from scratch — use Elevation.md
 *   ✗ Use backgroundColor: '#080F1C' directly — use Surfaces.card
 *   ✗ Invent a new font size — map to the closest Typography token
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Platform, TextStyle, ViewStyle } from 'react-native';

// ── Color palette ─────────────────────────────────────────────────────────────

export const Colors = {

  // Background layers — used by BackgroundWrapper gradient stops.
  // Do NOT use these directly as backgroundColor on screens.
  // Use BackgroundWrapper instead.
  bg: {
    top:    '#121A2E',   // gradient start (cool deep navy)
    mid:    '#0D1422',   // gradient midpoint
    bottom: '#0A0F1C',   // gradient end / deepest dark
  },

  // Glass surfaces — card and panel backgrounds.
  // primary: standard card (Settings, Bucket List, Hangar rows)
  // secondary: slightly lighter — elevated/featured cards
  // input: search bars and text fields
  glass: {
    primary:   '#080F1C',
    secondary: '#0A1220',
    input:     '#091119',
  },

  // Borders — always use these, never invent new border colors.
  // default:   standard card bezel (1px)
  // subtle:    row separator (slightly transparent)
  // active:    focused / hover / elevated state
  // highlight: 1px catch-light at card top (glass edge reflection)
  border: {
    default:   '#182C44',
    subtle:    'rgba(24, 44, 68, 0.90)',
    active:    '#1E3A5F',
    highlight: 'rgba(140, 190, 255, 0.07)',
  },

  // Text hierarchy — 5 levels, strictly enforced.
  // primary:   main labels, card names, row text        #EDF3FB
  // secondary: supporting detail, distance, fuel        #7A96B0
  // muted:     city/state, tertiary labels              #4E6E8A
  // label:     section headers, panel labels            #5C7A96
  // dim:       lowest hierarchy (badge labels, captions)#3E5269
  text: {
    primary:   '#EDF3FB',
    secondary: '#7A96B0',
    muted:     '#4E6E8A',
    label:     '#5C7A96',
    dim:       '#3E5269',
  },

  // Accents — reserved usage, do not reuse freely.
  // sky:       interactive / primary actions / links / toggles on
  // orange:    aviation emphasis — ICAO codes, section accent bars,
  //            primary icon plates. USE SPARINGLY (1 orange thing per screen).
  // steel:     standard icon color (most icons in the app)
  // red:       destructive label text (calm, not alarming)
  // redIcon:   destructive icon (even more muted than label)
  accent: {
    sky:     '#38BDF8',
    orange:  '#C4611A',
    steel:   '#4E6E8A',
    red:     '#B87070',
    redIcon: '#7A5555',
  },

  // Weather / flight condition status — unchanged, used on map + WX widgets.
  wx: {
    vfr:  '#22C55E',
    mvfr: '#38BDF8',
    ifr:  '#EF4444',
    lifr: '#A855F7',
  },

  // Legacy — kept for backward compatibility with existing screens.
  // Migrate away from these over time.
  dark: {
    background:      '#070B14',   // ← old; prefer BackgroundWrapper
    surface:         '#0D1421',   // ← old; prefer glass.primary
    card:            '#111827',   // ← old; prefer glass.primary
    border:          '#1E2D45',   // ← old; prefer border.default
    text:            '#F0F4FF',   // ← old; prefer text.primary
    textSecondary:   '#8A9BB5',   // ← old; prefer text.secondary
    muted:           '#4A5B73',   // ← old; prefer text.muted
    tint:            '#38BDF8',   // ← old; prefer accent.sky
    accent:          '#38BDF8',
    accentAlt:       '#0EA5E9',
    orange:          '#F97316',   // ← old; prefer accent.orange (#C4611A)
    vfr:             '#22C55E',
    mvfr:            '#38BDF8',
    ifr:             '#EF4444',
    lifr:            '#A855F7',
    tabIconDefault:  '#4A5B73',
    tabIconSelected: '#38BDF8',
    chartBlue:       '#1E3A5F',
    chartCyan:       '#38BDF8',
    chartMagenta:    '#C026D3',
  },
} as const;


// ── Surfaces ──────────────────────────────────────────────────────────────────
//
// Three surface levels. Spread into a StyleSheet like this:
//   card: { ...Surfaces.card, marginHorizontal: 16 },
//
// Surface 1 (card):        standard glass card — Settings, Bucket List, Hangar rows
// Surface 2 (cardElevated):featured / hero cards — Surprise Me, prominent content
// Surface 3 (input):       search bars, text fields — no shadow, sits flush

export const Surfaces: Record<string, ViewStyle> = {

  // Surface 1 — Standard glass card.
  // Elevation lives here. Children inside overflow:hidden cannot have their own shadow.
  card: {
    backgroundColor: Colors.glass.primary,
    borderRadius:    16,
    borderWidth:     1,
    borderColor:     Colors.border.default,
    overflow:        'hidden',
    shadowColor:     '#000',
    shadowOffset:    { width: 0, height: 5 },
    shadowOpacity:   0.40,
    shadowRadius:    14,
    elevation:       7,
  },

  // Surface 2 — Elevated / featured card.
  // Larger radius + stronger shadow for hero/featured content.
  cardElevated: {
    backgroundColor: Colors.glass.secondary,
    borderRadius:    20,
    borderWidth:     1,
    borderColor:     Colors.border.active,
    overflow:        'hidden',
    shadowColor:     '#000',
    shadowOffset:    { width: 0, height: 8 },
    shadowOpacity:   0.50,
    shadowRadius:    20,
    elevation:       10,
  },

  // Surface 3 — Input / search surface.
  // No shadow — inputs sit flush with the background.
  input: {
    backgroundColor: Colors.glass.input,
    borderRadius:    14,
    borderWidth:     1,
    borderColor:     Colors.border.active,
  },
};


// ── Elevation ─────────────────────────────────────────────────────────────────
//
// Standalone shadow presets. Spread onto any View that is NOT inside overflow:hidden.
//
// Tuning guide:
//   shadowOpacity: 0.25 (subtle) → 0.40 (standard) → 0.55 (maximum)
//   shadowRadius:  8 (tight) → 14 (standard) → 20 (broad)
//
// Usage:
//   someCard: { backgroundColor: Colors.glass.primary, borderRadius: 16, ...Elevation.md }

export const Elevation: Record<string, ViewStyle> = {
  sm: {
    shadowColor:   '#000',
    shadowOffset:  { width: 0, height: 3 },
    shadowOpacity: 0.28,
    shadowRadius:  8,
    elevation:     4,
  },
  md: {
    shadowColor:   '#000',
    shadowOffset:  { width: 0, height: 5 },
    shadowOpacity: 0.40,
    shadowRadius:  14,
    elevation:     7,
  },
  lg: {
    shadowColor:   '#000',
    shadowOffset:  { width: 0, height: 8 },
    shadowOpacity: 0.50,
    shadowRadius:  20,
    elevation:     10,
  },
};


// ── Borders ───────────────────────────────────────────────────────────────────
//
// Pre-built border style fragments. Spread where needed.
//
// Usage:
//   row: { ...Borders.separator }        → row divider
//   card: { ...Borders.standard }        → card bezel

export const Borders: Record<string, ViewStyle> = {
  // Standard 1px card/panel border
  standard: {
    borderWidth: 1,
    borderColor: Colors.border.default,
  },
  // Active/focused state border (slightly brighter)
  active: {
    borderWidth: 1,
    borderColor: Colors.border.active,
  },
  // Row separator (used between rows inside a card)
  separator: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.border.subtle,
  },
  // 1px catch-light — absolute View at top of card (glass edge reflection)
  // Usage: <View style={[Borders.highlight, { position:'absolute', top:0, left:0, right:0 }]} />
  highlight: {
    height:          1,
    backgroundColor: Colors.border.highlight,
  },
  // Aviation orange left accent (section labels, count badges)
  accentLeft: {
    borderLeftWidth:  2,
    borderLeftColor:  Colors.accent.orange,
  },
};


// ── Typography ────────────────────────────────────────────────────────────────
//
// Every text element in the app maps to one of these styles.
// No ad-hoc font sizes. If something doesn't fit, discuss before adding a new token.
//
// Usage:
//   titleText: { ...Typography.screenTitle, marginBottom: Spacing.sm },
//
// Hierarchy (top to bottom):
//   hero → screenTitle → cardTitle → rowLabel → body → detail → meta / icao

export const Typography: Record<string, TextStyle> = {

  // Large cinematic display (collection titles, destination hero)
  hero: {
    fontSize:      32,
    fontWeight:    '800',
    color:         Colors.text.primary,
    letterSpacing: -0.8,
  },

  // Standard screen title (Discover, Hangar, Events — 28px)
  screenTitle: {
    fontSize:      28,
    fontWeight:    '800',
    color:         Colors.text.primary,
    letterSpacing: -0.4,
  },

  // Card / list item primary name (airport name, pilot name)
  cardTitle: {
    fontSize:      18,
    fontWeight:    '700',
    color:         Colors.text.primary,
    letterSpacing: -0.2,
  },

  // Settings row label, list item primary text
  rowLabel: {
    fontSize:      15,
    fontWeight:    '600',
    color:         Colors.text.primary,
    letterSpacing: 0.05,
  },

  // Body copy (descriptions, modal text)
  body: {
    fontSize:   14,
    fontWeight: '400',
    color:      Colors.text.secondary,
    lineHeight: 22,
  },

  // Section / panel label (small caps, tracked, orange accent bar alongside it)
  sectionLabel: {
    fontSize:        11,
    fontWeight:      '700',
    color:           Colors.text.label,
    letterSpacing:   1.4,
    textTransform:   'uppercase',
  },

  // Aviation identifier — ICAO code, primary card anchor
  // Orange, wide tracking, always uppercase. One per card maximum.
  icao: {
    fontSize:      13,
    fontWeight:    '800',
    color:         Colors.accent.orange,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
  },

  // Supporting detail (distance, fuel, timestamps, city/state)
  detail: {
    fontSize:   12,
    fontWeight: '500',
    color:      Colors.text.secondary,
  },

  // Technical metadata (badge labels, stat counts labels)
  meta: {
    fontSize:      11,
    fontWeight:    '600',
    color:         Colors.text.dim,
    letterSpacing: 0.3,
  },
};


// ── Spacing ───────────────────────────────────────────────────────────────────
//
// Use these constants instead of hard-coded numbers.
// Every screen should use the same values for padding, gaps, and margins.
//
// Usage:
//   paddingHorizontal: Spacing.screenPadding,
//   marginTop: Spacing.sectionGap,

export const Spacing = {
  // Screen-level padding
  screenPadding: 20,   // horizontal page margin (left/right edge of content)
  screenTop:     70,   // top padding for screens without SafeAreaView header

  // Section structure
  sectionGap:    28,   // vertical space above each section label
  sectionBottom: 10,   // space between section label and its card/content

  // Card internals
  cardPadding:   16,   // internal card padding (all sides)
  cardGap:       20,   // vertical space between cards in a list

  // Row internals
  rowPaddingV:   16,   // row vertical padding (top + bottom)
  rowPaddingH:   18,   // row horizontal padding (left + right)
  rowIconGap:    14,   // gap between icon plate and label text

  // Chips / pills
  chipPaddingH:   8,
  chipPaddingV:   4,

  // General scale — for one-off values that don't fit above
  xs:  4,
  sm:  8,
  md:  16,
  lg:  24,
  xl:  32,
  xxl: 48,
} as const;


// ── Radius ────────────────────────────────────────────────────────────────────
//
// Consistent border radius scale. Never use arbitrary values.

export const Radius = {
  chip:     8,    // amenity pills, small badges, icon containers
  iconWrap: 10,   // icon plate containers (36×36 instrument plates)
  card:     16,   // standard glass cards (Settings, Bucket List)
  cardLg:   20,   // elevated/featured cards
  full:     999,  // fully rounded (toggles, circular avatars)
} as const;


// ── Icon system ───────────────────────────────────────────────────────────────
//
// Rules — read these before placing any icon:
//   - Style: Feather (outline stroke) for all UI/navigation icons
//            MaterialCommunityIcons for aviation-domain icons (airplane, gas-station, etc.)
//   - NEVER mix filled and outline icons on the same screen
//   - All icons in rows must sit inside an instrument plate (36×36 container)
//   - Icon color comes from Icons.color.* — never hard-code a color
//
// Usage:
//   <View style={[Icons.plate, Icons.plateOrange]}>
//     <MaterialCommunityIcons name="airplane" size={Icons.size.rowPrimary} color={Icons.color.primary} />
//   </View>

export const Icons = {

  // Sizes
  size: {
    chip:       12,   // inside amenity pills
    row:        18,   // standard Feather icon in a row
    rowPrimary: 20,   // primary/domain icon (MaterialCommunityIcons, airplane etc.)
    chevron:    14,   // navigation affordance (chevron-right)
    action:     18,   // contextual actions (more-vertical, etc.)
  },

  // Colors
  color: {
    default:     Colors.accent.steel,    // '#4E6E8A' — standard row icon
    primary:     Colors.accent.orange,   // '#C4611A' — aviation emphasis (use once per screen)
    destructive: Colors.accent.redIcon,  // '#7A5555' — destructive action icons
    chevron:     '#1E3450',              // barely-visible navigation affordance
    action:      '#3A5472',              // menu/action buttons
    chip:        Colors.accent.steel,    // inside amenity pills
  },

  // Instrument plate — 36×36 container for row icons.
  // The subtle tinted background gives the icon a physical "seat."
  // Combine with plateOrange or plateRed for variant colors.
  plate: {
    width:           36,
    height:          36,
    borderRadius:    Radius.iconWrap,
    flexShrink:      0,
    backgroundColor: 'rgba(78, 110, 138, 0.09)',
    borderWidth:     1,
    borderColor:     'rgba(78, 110, 138, 0.13)',
    alignItems:      'center',
    justifyContent:  'center',
  } as ViewStyle,

  // Orange variant — Pilot Information, primary aviation action. ONE per screen.
  plateOrange: {
    backgroundColor: 'rgba(196, 97, 26, 0.09)',
    borderColor:     'rgba(196, 97, 26, 0.16)',
  } as ViewStyle,

  // Red variant — destructive actions only (Sign Out, Delete).
  plateRed: {
    backgroundColor: 'rgba(140, 70, 70, 0.08)',
    borderColor:     'rgba(140, 70, 70, 0.12)',
  } as ViewStyle,
};


// ── Fonts (platform) ──────────────────────────────────────────────────────────

export const Fonts = Platform.select({
  ios: {
    sans:    'system-ui',
    serif:   'ui-serif',
    rounded: 'ui-rounded',
    mono:    'ui-monospace',
  },
  default: {
    sans:    'normal',
    serif:   'serif',
    rounded: 'normal',
    mono:    'monospace',
  },
});


// ── Shorthand tokens ──────────────────────────────────────────────────────────
//
// Flat constants for screens that use simple local aliases.
// Import these instead of defining per-file copies.
//
//   import { ORANGE, SKY, BORDER } from '../../constants/theme';

export const ORANGE = '#FF4D00';                      // aviation orange — event/discover accent
export const SKY    = Colors.accent.sky;              // '#38BDF8' — sky blue interactive
export const BORDER = 'rgba(255,255,255,0.08)';       // glass card border (all card types)
export const TEXT1  = '#E5E7EB';                      // primary text on dark glass
export const TEXT2  = '#94A3B8';                      // secondary text
export const TEXT3  = '#64748B';                      // muted / tertiary text
