import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

interface Props {
  icon: string | React.ReactElement;
  title: string;
  subtitle?: string;
  onPress?: () => void;
}

export default function ProfileSectionCard({ icon, title, subtitle, onPress }: Props) {
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.iconWrap}>
        {typeof icon === 'string' ? <Text style={styles.icon}>{icon}</Text> : icon}
      </View>
      <View style={styles.textWrap}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      <Feather name="chevron-right" size={14} color="#364A60" />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: '#080F1C',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#182C44',
    paddingVertical: 14,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 4,
  },
  iconWrap: {
    width: 34,
    height: 34,
    backgroundColor: 'rgba(78, 110, 138, 0.09)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(78, 110, 138, 0.13)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  icon: {
    fontSize: 16,
  },
  textWrap: {
    flex: 1,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    color: '#E0E8F5',
    marginBottom: 1,
  },
  subtitle: {
    fontSize: 10,
    color: '#4A5B73',
    fontWeight: '500',
    letterSpacing: 0.1,
  },
});
