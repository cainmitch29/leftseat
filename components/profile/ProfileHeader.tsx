import { Image, ImageSourcePropType, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MaterialCommunityIcons, Feather } from '@expo/vector-icons';

const AVATAR_PLACEHOLDER: ImageSourcePropType = require('../../assets/images/icon.png');

interface Props {
  name: string;
  username?: string;
  badge: string;           // e.g. "Private Pilot"
  rank?: string;           // e.g. "Cross-Country Explorer"
  homeAirport: string;     // e.g. "KSUS"
  homeAirportName: string;
  aircraft: string;
  photoUri?: string | null;
  onPhotoPress?: () => void;
  onEditPress?: () => void;
  // Stats
  airportsVisited: string;
  bucketListCount: string;
  followingCount: number;
  followerCount: number;
  onFollowersPress?: () => void;
  onFollowingPress?: () => void;
}

export default function ProfileHeader({
  name, username, badge, rank,
  homeAirport, homeAirportName, aircraft,
  photoUri,
  onPhotoPress, onEditPress,
  airportsVisited, bucketListCount, followingCount, followerCount,
  onFollowersPress, onFollowingPress,
}: Props) {
  const avatarSource: ImageSourcePropType = photoUri ? { uri: photoUri } : AVATAR_PLACEHOLDER;

  return (
    <View style={styles.container}>
      {onEditPress && (
        <TouchableOpacity style={styles.gearBtn} onPress={onEditPress} activeOpacity={0.7}>
          <Feather name="settings" size={20} color="#6B83A0" />
        </TouchableOpacity>
      )}

      {/* ── Photo + identity ─────────────────────────────────────────────── */}
      <View style={styles.topSection}>
        <TouchableOpacity style={styles.photoWrap} onPress={onPhotoPress} activeOpacity={0.85}>
          <View style={styles.photoRing}>
            <Image source={avatarSource} style={styles.photo} />
          </View>
          <View style={styles.cameraBadge}>
            <MaterialCommunityIcons name="camera" size={11} color="#8A9BB5" />
          </View>
        </TouchableOpacity>

        <View style={styles.identityCol}>
          <Text style={styles.name}>{name}</Text>
          {username ? <Text style={styles.usernameHandle}>@{username}</Text> : null}

          {/* Certificate + rank as pill badges */}
          <View style={styles.pillRow}>
            {badge ? (
              <View style={styles.certPill}>
                <MaterialCommunityIcons name="shield-check" size={11} color="#38BDF8" />
                <Text style={styles.certPillText}>{badge}</Text>
              </View>
            ) : null}
          </View>
        </View>
      </View>

      {/* ── Rank callsign ────────────────────────────────────────────────── */}
      {rank ? (
        <View style={styles.rankStrip}>
          <MaterialCommunityIcons name="chevron-triple-right" size={12} color="#C4611A" />
          <Text style={styles.rankText}>{rank}</Text>
        </View>
      ) : null}

      {/* ── Home base + aircraft ──────────────────────────────────────────── */}
      <View style={styles.detailRow}>
        {homeAirport ? (
          <View style={styles.detailChip}>
            <MaterialCommunityIcons name="home-variant" size={12} color="#6B83A0" />
            <Text style={styles.detailText}>{homeAirport}{homeAirportName ? ` - ${homeAirportName}` : ''}</Text>
          </View>
        ) : null}
        {aircraft ? (
          <View style={styles.detailChip}>
            <MaterialCommunityIcons name="airplane" size={12} color="#6B83A0" />
            <Text style={styles.detailText}>{aircraft}</Text>
          </View>
        ) : null}
      </View>

      {/* ── Flight stats strip ────────────────────────────────────────────── */}
      <View style={styles.statsStrip}>
        <View style={styles.statCell}>
          <Text style={styles.statValue}>{airportsVisited}</Text>
          <Text style={styles.statLabel}>Airports</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statCell}>
          <Text style={styles.statValue}>{bucketListCount}</Text>
          <Text style={styles.statLabel}>Bucket List</Text>
        </View>
        <View style={styles.statDivider} />
        <TouchableOpacity style={styles.statCell} onPress={onFollowersPress} activeOpacity={0.7}>
          <Text style={styles.statValueSocial}>{followerCount}</Text>
          <Text style={styles.statLabel}>Followers</Text>
        </TouchableOpacity>
        <View style={styles.statDivider} />
        <TouchableOpacity style={styles.statCell} onPress={onFollowingPress} activeOpacity={0.7}>
          <Text style={styles.statValueSocial}>{followingCount}</Text>
          <Text style={styles.statLabel}>Following</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 20,
    paddingTop: 0,
    paddingBottom: 14,
    position: 'relative',
  },

  gearBtn: {
    position: 'absolute',
    top: 6,
    right: 18,
    padding: 6,
    zIndex: 1,
  },

  // ── Top section: photo + identity side by side ────────────────────────
  topSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 10,
  },

  identityCol: {
    flex: 1,
    gap: 2,
  },

  photoWrap: { position: 'relative', flexShrink: 0 },

  photoRing: {
    borderRadius: 48,
    borderWidth: 2.5,
    borderColor: 'rgba(196, 97, 26, 0.50)',
    padding: 2.5,
    backgroundColor: '#060B16',
  },

  photo: {
    width: 84,
    height: 84,
    borderRadius: 42,
  },

  cameraBadge: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    backgroundColor: '#0D1421',
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: '#1E3A5F',
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Identity ─────────────────────────────────────────────────────────────
  name: {
    fontSize: 26,
    fontWeight: '800',
    color: '#F0F4FF',
    letterSpacing: -0.5,
  },

  usernameHandle: {
    fontSize: 13,
    fontWeight: '500',
    color: '#4A5F77',
    letterSpacing: 0.2,
  },

  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },

  certPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(56, 189, 248, 0.08)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.15)',
  },

  certPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#38BDF8',
    letterSpacing: 0.2,
  },

  // ── Rank strip ──────────────────────────────────────────────────────────
  rankStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },

  rankText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#C4611A',
    letterSpacing: 0.3,
  },

  // ── Detail chips ────────────────────────────────────────────────────────
  detailRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 14,
  },

  detailChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },

  detailText: {
    fontSize: 12,
    color: '#6B83A0',
    fontWeight: '500',
  },

  // ── Stats strip (cockpit instrument feel) ─────────────────────────────
  statsStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#080F1C',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#182C44',
    paddingVertical: 12,
    paddingHorizontal: 4,
  },

  statCell: {
    flex: 1,
    alignItems: 'center',
  },

  statDivider: {
    width: 1,
    height: 26,
    backgroundColor: '#182C44',
  },

  statValue: {
    fontSize: 20,
    fontWeight: '800',
    color: '#F0F4FF',
    letterSpacing: -0.3,
    fontVariant: ['tabular-nums'],
  },

  statValueSocial: {
    fontSize: 18,
    fontWeight: '700',
    color: '#8A9BB5',
    letterSpacing: -0.3,
    fontVariant: ['tabular-nums'],
  },

  statLabel: {
    fontSize: 9,
    color: '#4A5F77',
    fontWeight: '700',
    letterSpacing: 0.6,
    textAlign: 'center',
    marginTop: 2,
  },
});
