import { MaterialCommunityIcons, Feather } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import AchievementCard, { Achievement } from './AchievementCard';

const ACHIEVEMENTS: Achievement[] = [
  {
    icon: <MaterialCommunityIcons name="airplane-landing" size={22} color="#F0F4FF" />,
    title: 'First 10 Airports',   description: 'Visit 10 different airports',               difficulty: 'medium' as const, current: 7, total: 10, complete: false,
  },
  {
    icon: <MaterialCommunityIcons name="food" size={22} color="#F0F4FF" />,
    title: '$100 Hamburger',        description: 'Fly to an airport for food',                difficulty: 'easy'   as const, current: 1, total: 1,  complete: true,
  },
  {
    icon: <MaterialCommunityIcons name="golf" size={22} color="#F0F4FF" />,
    title: 'Golf Destination',       description: 'Fly to an airport with a golf course nearby', difficulty: 'easy'   as const, current: 1, total: 1,  complete: true,
  },
  {
    icon: <Feather name="map" size={22} color="#F0F4FF" />,
    title: '5 States Flown',        description: 'Land in 5 different states',                difficulty: 'medium' as const, current: 3, total: 5,  complete: false,
  },
  {
    icon: <MaterialCommunityIcons name="star" size={22} color="#F0F4FF" />,
    title: 'Bucket List Starter',    description: 'Save 5 airports to your bucket list',       difficulty: 'easy'   as const, current: 4, total: 5,  complete: false,
  },
  {
    icon: <MaterialCommunityIcons name="home" size={22} color="#F0F4FF" />,
    title: 'Home Base Explorer',     description: 'Discover 10 airports near your home airport', difficulty: 'easy'   as const, current: 6, total: 10, complete: false,
  },
];

export default function AchievementsSection() {
  const completed = ACHIEVEMENTS.filter(a => a.complete).length;
  const inProgress = ACHIEVEMENTS.filter(a => !a.complete).length;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Achievements</Text>
      <Text style={styles.sectionSubtitle}>Track your flying milestones</Text>

      <View style={styles.summaryRow}>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryValue}>{completed}</Text>
          <Text style={styles.summaryLabel}>Completed</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={styles.summaryValue}>{inProgress}</Text>
          <Text style={styles.summaryLabel}>In Progress</Text>
        </View>
      </View>

      {ACHIEVEMENTS.map((a, i) => (
        <AchievementCard key={i} achievement={a} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginHorizontal: 16,
    marginBottom: 28,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#4A5B73',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  sectionSubtitle: {
    fontSize: 12,
    color: '#4A5B73',
    marginBottom: 14,
  },
  summaryRow: {
    flexDirection: 'row',
    backgroundColor: '#0A1628',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1E3A5F',
    marginBottom: 14,
    overflow: 'hidden',
  },
  summaryItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 14,
  },
  summaryDivider: {
    width: 1,
    backgroundColor: '#1E3A5F',
  },
  summaryValue: {
    fontSize: 22,
    fontWeight: '700',
    color: '#F0F4FF',
    marginBottom: 2,
  },
  summaryLabel: {
    fontSize: 11,
    color: '#4A5B73',
    fontWeight: '500',
  },
});
