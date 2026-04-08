/**
 * components/FlyThisWeekendSheet.tsx
 *
 * Bottom sheet that runs the Claude-powered weekend trip planner and
 * displays 2–3 destination cards. Tap any card to go to the airport page.
 */

import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { generateWeekendPlan, WeekendDestination } from '../utils/flyThisWeekend';

// ── Typing animation for the "thinking" state ─────────────────────────────────
function ThinkingDots() {
  const dots = [
    useRef(new Animated.Value(0)).current,
    useRef(new Animated.Value(0)).current,
    useRef(new Animated.Value(0)).current,
  ];
  useEffect(() => {
    dots.forEach((d, i) => {
      Animated.loop(Animated.sequence([
        Animated.delay(i * 200),
        Animated.timing(d, { toValue: 1, duration: 400, useNativeDriver: true }),
        Animated.timing(d, { toValue: 0, duration: 400, useNativeDriver: true }),
        Animated.delay((2 - i) * 200),
      ])).start();
    });
  }, []);
  return (
    <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
      {dots.map((d, i) => (
        <Animated.View
          key={i}
          style={{
            width: 8, height: 8, borderRadius: 4,
            backgroundColor: '#FF4D00',
            opacity: d,
            transform: [{ scale: d.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1.2] }) }],
          }}
        />
      ))}
    </View>
  );
}

// ── Destination card ──────────────────────────────────────────────────────────
function DestCard({ dest, onPress }: { dest: WeekendDestination; onPress: () => void }) {
  const scale = useRef(new Animated.Value(1)).current;
  return (
    <TouchableOpacity
      activeOpacity={1}
      onPressIn={() => Animated.spring(scale, { toValue: 0.97, useNativeDriver: true, tension: 300, friction: 20 }).start()}
      onPressOut={() => Animated.spring(scale, { toValue: 1, useNativeDriver: true, tension: 300, friction: 20 }).start()}
      onPress={onPress}
    >
      <Animated.View style={[s.destCard, { transform: [{ scale }] }]}>
        {/* ICAO + distance */}
        <View style={s.destTop}>
          <View style={s.icaoBadge}>
            <Text style={s.icaoTxt}>{dest.icao}</Text>
          </View>
          <View style={s.distPill}>
            <MaterialCommunityIcons name="airplane" size={11} color="#8A9BB5" />
            <Text style={s.distTxt}>{dest.distance_nm} nm</Text>
          </View>
        </View>

        {/* City + state */}
        <Text style={s.destCity}>{dest.city}, {dest.state}</Text>

        {/* Highlight pill */}
        <View style={s.highlightPill}>
          <MaterialCommunityIcons name="star-four-points" size={10} color="#FF4D00" />
          <Text style={s.highlightTxt}>{dest.highlight}</Text>
        </View>

        {/* Why */}
        <Text style={s.whyTxt}>{dest.why}</Text>

        {/* CTA */}
        <View style={s.cardCta}>
          <Text style={s.ctaTxt}>View Airport</Text>
          <MaterialCommunityIcons name="arrow-right" size={13} color="#FF4D00" />
        </View>
      </Animated.View>
    </TouchableOpacity>
  );
}

// ── Main sheet ────────────────────────────────────────────────────────────────
interface Props {
  visible: boolean;
  onClose: () => void;
  userId?: string;
}

export default function FlyThisWeekendSheet({ visible, onClose, userId }: Props) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [destinations, setDestinations] = useState<WeekendDestination[]>([]);
  const [errorMsg, setErrorMsg] = useState('');
  const shimmer = useRef(new Animated.Value(0)).current;

  // Shimmer loop for loading state
  useEffect(() => {
    if (state !== 'loading') return;
    Animated.loop(
      Animated.timing(shimmer, { toValue: 1, duration: 1800, easing: Easing.linear, useNativeDriver: true })
    ).start();
    return () => { shimmer.setValue(0); };
  }, [state]);

  // Auto-run when sheet opens
  useEffect(() => {
    if (!visible) { setState('idle'); setDestinations([]); setErrorMsg(''); return; }
    run();
  }, [visible]);

  async function run() {
    setState('loading');
    try {
      const result = await generateWeekendPlan(userId);
      setDestinations(result.destinations);
      setState('done');
    } catch (e: any) {
      setErrorMsg(e?.message ?? 'Something went wrong. Try again.');
      setState('error');
    }
  }

  function goToAirport(dest: WeekendDestination) {
    onClose();
    router.push({ pathname: '/airport', params: { icao: dest.icao } });
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={s.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity style={s.sheet} activeOpacity={1} onPress={() => {}}>
          {/* Handle */}
          <View style={s.handle} />

          {/* Header */}
          <View style={s.header}>
            <View style={s.headerLeft}>
              <View style={s.aiBadge}>
                <MaterialCommunityIcons name="brain" size={14} color="#FF4D00" />
                <Text style={s.aiBadgeTxt}>AI</Text>
              </View>
              <View>
                <Text style={s.title}>Fly This Weekend</Text>
                <Text style={s.subtitle}>Powered by Claude</Text>
              </View>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <MaterialCommunityIcons name="close" size={20} color="#4A5F77" />
            </TouchableOpacity>
          </View>

          {/* Content */}
          <ScrollView style={s.body} showsVerticalScrollIndicator={false}>

            {state === 'loading' && (
              <View style={s.loadingWrap}>
                <ThinkingDots />
                <Text style={s.loadingTitle}>Planning your weekend...</Text>
                <Text style={s.loadingSubtitle}>
                  Checking your range, local weather, nearby events, and airports to find the best bets for this weekend.
                </Text>
                {/* Skeleton cards */}
                {[0, 1, 2].map(i => (
                  <View key={i} style={[s.destCard, s.skeletonCard, { opacity: 1 - i * 0.25 }]}>
                    <View style={s.skelLine} />
                    <View style={[s.skelLine, { width: '55%', marginTop: 8 }]} />
                    <View style={[s.skelLine, { width: '80%', marginTop: 12, height: 8 }]} />
                    <View style={[s.skelLine, { width: '65%', marginTop: 6, height: 8 }]} />
                  </View>
                ))}
              </View>
            )}

            {state === 'error' && (
              <View style={s.errorWrap}>
                <MaterialCommunityIcons name="weather-cloudy-alert" size={48} color="#4A5F77" />
                <Text style={s.errorTitle}>Couldn't plan your trip</Text>
                <Text style={s.errorMsg}>{errorMsg}</Text>
                <TouchableOpacity style={s.retryBtn} onPress={run}>
                  <Text style={s.retryTxt}>Try Again</Text>
                </TouchableOpacity>
              </View>
            )}

            {state === 'done' && destinations.length > 0 && (
              <View style={{ gap: 12 }}>
                <Text style={s.intro}>
                  Based on your range, home weather, and what's happening this weekend —
                </Text>
                {destinations.map((dest, i) => (
                  <DestCard key={dest.icao + i} dest={dest} onPress={() => goToAirport(dest)} />
                ))}
                <TouchableOpacity style={s.refreshBtn} onPress={run}>
                  <MaterialCommunityIcons name="refresh" size={14} color="#4A5F77" />
                  <Text style={s.refreshTxt}>Regenerate suggestions</Text>
                </TouchableOpacity>
              </View>
            )}

            <View style={{ height: 40 }} />
          </ScrollView>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.60)' },
  sheet: {
    backgroundColor: '#0B1220',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    borderWidth: 1, borderColor: '#1A2D45',
    maxHeight: '88%',
  },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#1E2D45', alignSelf: 'center', marginTop: 12, marginBottom: 4 },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  aiBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(255,77,0,0.12)', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 4,
    borderWidth: 1, borderColor: 'rgba(255,77,0,0.25)',
  },
  aiBadgeTxt: { fontSize: 11, fontWeight: '800', color: '#FF4D00', letterSpacing: 0.5 },
  title: { fontSize: 18, fontWeight: '800', color: '#F0F4FF' },
  subtitle: { fontSize: 11, color: '#4A5F77', fontWeight: '500', marginTop: 1 },

  body: { paddingHorizontal: 20 },

  // Loading
  loadingWrap: { alignItems: 'center', paddingTop: 16, paddingBottom: 8, gap: 12 },
  loadingTitle: { fontSize: 17, fontWeight: '700', color: '#F0F4FF' },
  loadingSubtitle: { fontSize: 13, color: '#4A5F77', textAlign: 'center', lineHeight: 20, paddingHorizontal: 8 },
  skeletonCard: { opacity: 0.4 },
  skelLine: { height: 12, backgroundColor: '#1E2D45', borderRadius: 6, width: '70%' },

  // Error
  errorWrap: { alignItems: 'center', paddingVertical: 40, gap: 12 },
  errorTitle: { fontSize: 17, fontWeight: '700', color: '#F0F4FF' },
  errorMsg: { fontSize: 14, color: '#4A5F77', textAlign: 'center', lineHeight: 20 },
  retryBtn: { backgroundColor: '#FF4D00', borderRadius: 14, paddingVertical: 12, paddingHorizontal: 28, marginTop: 8 },
  retryTxt: { color: '#0D1421', fontSize: 15, fontWeight: '800' },

  // Results
  intro: { fontSize: 13, color: '#6B83A0', lineHeight: 19, marginBottom: 4 },
  destCard: {
    backgroundColor: '#0D1829',
    borderRadius: 16,
    borderWidth: 1, borderColor: '#1A2D45',
    padding: 16,
    gap: 8,
  },
  destTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  icaoBadge: {
    backgroundColor: 'rgba(255,77,0,0.12)', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 4,
    borderWidth: 1, borderColor: 'rgba(255,77,0,0.2)',
  },
  icaoTxt: { fontSize: 13, fontWeight: '800', color: '#FF4D00', letterSpacing: 0.5 },
  distPill: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  distTxt: { fontSize: 12, color: '#6B83A0', fontWeight: '600' },
  destCity: { fontSize: 20, fontWeight: '800', color: '#F0F4FF', letterSpacing: -0.3 },
  highlightPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,77,0,0.08)', borderRadius: 20,
    paddingHorizontal: 10, paddingVertical: 4,
    borderWidth: 1, borderColor: 'rgba(255,77,0,0.15)',
  },
  highlightTxt: { fontSize: 11, fontWeight: '700', color: '#FF4D00' },
  whyTxt: { fontSize: 14, color: '#8A9BB5', lineHeight: 20 },
  cardCta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  ctaTxt: { fontSize: 13, fontWeight: '700', color: '#FF4D00' },

  refreshBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12 },
  refreshTxt: { fontSize: 13, color: '#4A5F77', fontWeight: '600' },
});
