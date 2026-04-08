/**
 * components/TabIcons.tsx
 *
 * Feather icon wrappers for the bottom tab bar.
 *
 * Why Feather (not Ionicons):
 *   Feather icons are drawn on a strict 24×24 px grid with a uniform 2 px stroke,
 *   round line caps, and no fills — giving every icon identical visual weight.
 *   Ionicons outline variants vary in stroke width across icons, which creates
 *   an inconsistent feel when they sit side-by-side in a tab bar.
 *
 * Usage:
 *   import { DiscoverIcon } from '../../components/TabIcons';
 *   <DiscoverIcon color="#38BDF8" size={24} />
 */

import { Feather } from '@expo/vector-icons';

interface IconProps {
  color: string;
  size?: number;
}

/** Discover tab — compass representing aviation exploration */
export function DiscoverIcon({ color, size = 24 }: IconProps) {
  return <Feather name="compass" size={size} color={color} />;
}

/** Map tab — folded map representing the chart/map view */
export function MapIcon({ color, size = 24 }: IconProps) {
  return <Feather name="map" size={size} color={color} />;
}

/** Events tab — calendar representing fly-ins and air shows */
export function EventsIcon({ color, size = 24 }: IconProps) {
  return <Feather name="calendar" size={size} color={color} />;
}

/** Hangar tab — group of people representing the pilot community */
export function HangarIcon({ color, size = 24 }: IconProps) {
  return <Feather name="users" size={size} color={color} />;
}

/** Bucket List tab — bookmark representing saved/wishlist airports */
export function BucketListIcon({ color, size = 24 }: IconProps) {
  return <Feather name="bookmark" size={size} color={color} />;
}

/** Profile tab — person silhouette representing the pilot's own profile */
export function ProfileIcon({ color, size = 24 }: IconProps) {
  return <Feather name="user" size={size} color={color} />;
}
