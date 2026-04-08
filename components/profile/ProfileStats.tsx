import { StyleSheet, Text, View } from 'react-native';

interface Stat {
  icon: string;
  value: string | number;
  label: string;
}

interface Props {
  stats: Stat[];
}

export default function ProfileStats({ stats }: Props) {
  // Render as 2-column grid
  const rows: Stat[][] = [];
  for (let i = 0; i < stats.length; i += 2) {
    rows.push(stats.slice(i, i + 2));
  }

  return (
    <View style={styles.container}>
      {rows.map((row, rowIdx) => (
        <View key={rowIdx} style={[styles.row, rowIdx > 0 && styles.rowBorder]}>
          {row.map((stat, colIdx) => (
            <View
              key={colIdx}
              style={[styles.stat, colIdx === 0 && row.length > 1 && styles.statBorderRight]}
            >
              <Text style={styles.icon}>{stat.icon}</Text>
              <Text style={styles.value}>{stat.value}</Text>
              <Text style={styles.label}>{stat.label}</Text>
            </View>
          ))}
          {/* Fill empty cell if row has only 1 item */}
          {row.length === 1 && <View style={styles.stat} />}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    marginBottom: 24,
    backgroundColor: '#0A1628',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#1E3A5F',
  },
  row: {
    flexDirection: 'row',
  },
  rowBorder: {
    borderTopWidth: 1,
    borderTopColor: '#1E3A5F',
  },
  stat: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 18,
    paddingHorizontal: 8,
  },
  statBorderRight: {
    borderRightWidth: 1,
    borderRightColor: '#1E3A5F',
  },
  icon: {
    fontSize: 20,
    marginBottom: 6,
  },
  value: {
    fontSize: 22,
    fontWeight: '700',
    color: '#F0F4FF',
    marginBottom: 4,
  },
  label: {
    fontSize: 11,
    color: '#4A5B73',
    textAlign: 'center',
    fontWeight: '500',
  },
});
