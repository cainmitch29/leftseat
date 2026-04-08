import React from 'react';
import { Feather } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

export type Difficulty = 'easy' | 'medium' | 'hard';

export interface Achievement {
  icon: string | React.ReactElement;
  title: string;
  description: string;
  difficulty: Difficulty;
  current: number;
  total: number;
  complete: boolean;
}

interface Props {
  achievement: Achievement;
}

const COLORS: Record<Difficulty, string> = {
  easy: '#38BDF8', medium: '#F59E0B', hard: '#A855F7',
};

export default function AchievementCard({ achievement }: Props) {
  const { icon, title, description, difficulty, current, total, complete } = achievement;
  const color = COLORS[difficulty];
  const pct = total > 0 ? Math.min(current / total, 1) : 0;

  return (
    <View style={[s.card, complete && { borderColor: color + '30' }]}>
      {/* Left accent */}
      <View style={[s.accent, { backgroundColor: complete ? color : '#1A2535' }]} />

      {/* Icon */}
      <View style={[s.iconWrap, complete ? { backgroundColor: color + '12', borderColor: color + '30' } : {}]}>
        {complete
          ? <Feather name="check" size={18} color={color} />
          : <View style={{ opacity: 0.3 }}>{typeof icon === 'string' ? <Text style={{ fontSize: 18 }}>{icon}</Text> : icon}</View>
        }
      </View>

      {/* Content */}
      <View style={s.body}>
        <Text style={[s.title, !complete && s.titleLocked]}>{title}</Text>
        <Text style={[s.desc, !complete && s.descLocked]}>{description}</Text>

        {complete ? (
          <Text style={[s.status, { color }]}>Completed</Text>
        ) : (
          <View style={s.progressRow}>
            <View style={s.barTrack}>
              <View style={[s.barFill, { width: `${Math.max(pct * 100, 3)}%`, backgroundColor: color }]} />
            </View>
            <Text style={[s.progressText, { color }]}>{current}/{total}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 14, paddingRight: 14, marginBottom: 2,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.04)',
  },
  accent: { width: 3, alignSelf: 'stretch', borderRadius: 2 },
  iconWrap: {
    width: 38, height: 38, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1, borderColor: '#1A2535',
  },
  body: { flex: 1 },
  title: { fontSize: 14, fontWeight: '700', color: '#F0F4FF', marginBottom: 2 },
  titleLocked: { color: '#6B83A0' },
  desc: { fontSize: 12, color: '#6B83A0', lineHeight: 17, marginBottom: 6 },
  descLocked: { color: '#3D5068' },
  status: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  barTrack: { flex: 1, height: 4, backgroundColor: '#131E2D', borderRadius: 2, overflow: 'hidden' },
  barFill: { height: 4, borderRadius: 2 },
  progressText: { fontSize: 11, fontWeight: '700', minWidth: 28 },
});
