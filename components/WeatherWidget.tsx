import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

function getWeatherType(weather: any): string {
  if (!weather) return 'clear';
  const metar = (weather.metar || '').toUpperCase();
  if (/\sTS[A-Z]*(\s|$)/.test(metar)) return 'storm';
  if (/\s(SN|FZRA|FZDZ|SNSH|BLSN)[A-Z]*(\s|$)/.test(metar)) return 'snow';
  if (/\s(RA|DZ|SH)[A-Z]*(\s|$)/.test(metar) || /\s[A-Z]*(RA|DZ)(\s|$)/.test(metar)) return 'rain';
  if (/\s(FG|BR)(\s|$)/.test(metar) || weather.flightCat === 'IFR' || weather.flightCat === 'LIFR') return 'fog';
  if (typeof weather.windSpd === 'number' && weather.windSpd > 20) return 'windy';
  if (weather.clouds && weather.clouds !== 'Clear' && weather.clouds.includes('OVC')) return 'cloudy';
  if (weather.clouds && weather.clouds !== 'Clear') return 'partlycloudy';
  return 'clear';
}

function SunWidget() {
  const rotate = useRef(new Animated.Value(0)).current;
  const pulse  = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.loop(Animated.timing(rotate, { toValue: 1, duration: 8000, easing: Easing.linear, useNativeDriver: true })).start();
    Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1.12, duration: 1500, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1,    duration: 1500, useNativeDriver: true }),
    ])).start();
  }, []);
  const spin = rotate.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <View style={styles.widgetContainer}>
      <Animated.View style={{ transform: [{ rotate: spin }, { scale: pulse }] }}>
        <MaterialCommunityIcons name="white-balance-sunny" size={64} color="#FBBF24" />
      </Animated.View>
      <Text style={styles.widgetLabel}>Clear Skies</Text>
    </View>
  );
}

function PartlyCloudyWidget() {
  const sunRotate  = useRef(new Animated.Value(0)).current;
  const cloudSlide = useRef(new Animated.Value(-10)).current;
  useEffect(() => {
    Animated.loop(Animated.timing(sunRotate, { toValue: 1, duration: 10000, easing: Easing.linear, useNativeDriver: true })).start();
    Animated.loop(Animated.sequence([
      Animated.timing(cloudSlide, { toValue: 10, duration: 2000, useNativeDriver: true }),
      Animated.timing(cloudSlide, { toValue: -10, duration: 2000, useNativeDriver: true }),
    ])).start();
  }, []);
  const spin = sunRotate.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <View style={styles.widgetContainer}>
      <View style={{ width: 100, height: 80, alignItems: 'center', justifyContent: 'center' }}>
        <Animated.View style={{ position: 'absolute', left: 0, top: 0, transform: [{ rotate: spin }] }}>
          <MaterialCommunityIcons name="white-balance-sunny" size={44} color="#FBBF24" />
        </Animated.View>
        <Animated.View style={{ position: 'absolute', right: 0, bottom: 0, transform: [{ translateX: cloudSlide }] }}>
          <MaterialCommunityIcons name="cloud" size={50} color="#94A3B8" />
        </Animated.View>
      </View>
      <Text style={styles.widgetLabel}>Partly Cloudy</Text>
    </View>
  );
}

function CloudyWidget() {
  const slide1 = useRef(new Animated.Value(0)).current;
  const slide2 = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(Animated.sequence([
      Animated.timing(slide1, { toValue: 15,  duration: 2500, useNativeDriver: true }),
      Animated.timing(slide1, { toValue: -15, duration: 2500, useNativeDriver: true }),
    ])).start();
    Animated.loop(Animated.sequence([
      Animated.timing(slide2, { toValue: -10, duration: 2000, useNativeDriver: true }),
      Animated.timing(slide2, { toValue: 10,  duration: 2000, useNativeDriver: true }),
    ])).start();
  }, []);
  return (
    <View style={styles.widgetContainer}>
      <View style={{ width: 100, height: 70, alignItems: 'center', justifyContent: 'center' }}>
        <Animated.View style={{ position: 'absolute', transform: [{ translateX: slide1 }] }}>
          <MaterialCommunityIcons name="cloud" size={44} color="#94A3B8" />
        </Animated.View>
        <Animated.View style={{ position: 'absolute', top: 20, transform: [{ translateX: slide2 }] }}>
          <MaterialCommunityIcons name="cloud" size={36} color="#64748B" />
        </Animated.View>
      </View>
      <Text style={styles.widgetLabel}>Overcast</Text>
    </View>
  );
}

function RainWidget() {
  const drops = Array.from({ length: 6 }, () => useRef(new Animated.Value(-20)).current);
  useEffect(() => {
    drops.forEach((drop, i) => {
      Animated.loop(Animated.sequence([
        Animated.delay(i * 150),
        Animated.timing(drop, { toValue: 80,  duration: 800, easing: Easing.linear, useNativeDriver: true }),
        Animated.timing(drop, { toValue: -20, duration: 0,   useNativeDriver: true }),
      ])).start();
    });
  }, []);
  return (
    <View style={styles.widgetContainer}>
      <View style={{ width: 100, height: 80, alignItems: 'center' }}>
        <MaterialCommunityIcons name="weather-rainy" size={36} color="#60A5FA" style={{ marginBottom: 4 }} />
        <View style={{ flexDirection: 'row', gap: 8, height: 40, overflow: 'hidden' }}>
          {drops.map((drop, i) => (
            <Animated.View key={i} style={{ transform: [{ translateY: drop }] }}>
              <MaterialCommunityIcons name="water" size={12} color="#38BDF8" />
            </Animated.View>
          ))}
        </View>
      </View>
      <Text style={styles.widgetLabel}>Rain</Text>
    </View>
  );
}

function SnowWidget() {
  const flakes = Array.from({ length: 6 }, () => useRef(new Animated.Value(-10)).current);
  useEffect(() => {
    flakes.forEach((flake, i) => {
      Animated.loop(Animated.sequence([
        Animated.delay(i * 200),
        Animated.timing(flake, { toValue: 80,  duration: 1500, easing: Easing.linear, useNativeDriver: true }),
        Animated.timing(flake, { toValue: -10, duration: 0,    useNativeDriver: true }),
      ])).start();
    });
  }, []);
  return (
    <View style={styles.widgetContainer}>
      <View style={{ width: 100, height: 80, alignItems: 'center' }}>
        <MaterialCommunityIcons name="weather-snowy" size={36} color="#BAE6FD" style={{ marginBottom: 4 }} />
        <View style={{ flexDirection: 'row', gap: 8, height: 40, overflow: 'hidden' }}>
          {flakes.map((flake, i) => (
            <Animated.View key={i} style={{ transform: [{ translateY: flake }] }}>
              <MaterialCommunityIcons name="snowflake" size={14} color="#BAE6FD" />
            </Animated.View>
          ))}
        </View>
      </View>
      <Text style={styles.widgetLabel}>Snow</Text>
    </View>
  );
}

function WindyWidget({ windSpd }: { windSpd: any }) {
  const lines = Array.from({ length: 4 }, () => useRef(new Animated.Value(-100)).current);
  useEffect(() => {
    lines.forEach((line, i) => {
      Animated.loop(Animated.sequence([
        Animated.delay(i * 200),
        Animated.timing(line, { toValue: 100,  duration: 600, easing: Easing.linear, useNativeDriver: true }),
        Animated.timing(line, { toValue: -100, duration: 0,   useNativeDriver: true }),
      ])).start();
    });
  }, []);
  return (
    <View style={styles.widgetContainer}>
      <View style={{ width: 100, height: 70, overflow: 'hidden', justifyContent: 'center', gap: 8 }}>
        {lines.map((line, i) => (
          <Animated.View key={i} style={{ transform: [{ translateX: line }] }}>
            <MaterialCommunityIcons name="weather-windy" size={18} color="#8A9BB5" />
          </Animated.View>
        ))}
      </View>
      <Text style={styles.widgetLabel}>Windy · {windSpd} kts</Text>
    </View>
  );
}

function FogWidget() {
  const opacity1 = useRef(new Animated.Value(0.3)).current;
  const opacity2 = useRef(new Animated.Value(0.6)).current;
  useEffect(() => {
    Animated.loop(Animated.sequence([
      Animated.timing(opacity1, { toValue: 0.8, duration: 2000, useNativeDriver: true }),
      Animated.timing(opacity1, { toValue: 0.3, duration: 2000, useNativeDriver: true }),
    ])).start();
    Animated.loop(Animated.sequence([
      Animated.timing(opacity2, { toValue: 0.2, duration: 1500, useNativeDriver: true }),
      Animated.timing(opacity2, { toValue: 0.7, duration: 1500, useNativeDriver: true }),
    ])).start();
  }, []);
  return (
    <View style={styles.widgetContainer}>
      <View style={{ width: 100, height: 70, justifyContent: 'center', gap: 6 }}>
        {[opacity1, opacity2, opacity1].map((op, i) => (
          <Animated.View key={i} style={{ height: 8, backgroundColor: '#8A9BB5', borderRadius: 4, opacity: op, marginHorizontal: i * 8 }} />
        ))}
      </View>
      <Text style={styles.widgetLabel}>Low Visibility</Text>
    </View>
  );
}

function StormWidget() {
  const flash = useRef(new Animated.Value(0)).current;
  const rain  = Array.from({ length: 5 }, () => useRef(new Animated.Value(-20)).current);
  useEffect(() => {
    Animated.loop(Animated.sequence([
      Animated.delay(2000),
      Animated.timing(flash, { toValue: 1, duration: 80, useNativeDriver: true }),
      Animated.timing(flash, { toValue: 0, duration: 80, useNativeDriver: true }),
      Animated.timing(flash, { toValue: 1, duration: 80, useNativeDriver: true }),
      Animated.timing(flash, { toValue: 0, duration: 80, useNativeDriver: true }),
    ])).start();
    rain.forEach((drop, i) => {
      Animated.loop(Animated.sequence([
        Animated.delay(i * 120),
        Animated.timing(drop, { toValue: 80,  duration: 600, easing: Easing.linear, useNativeDriver: true }),
        Animated.timing(drop, { toValue: -20, duration: 0,   useNativeDriver: true }),
      ])).start();
    });
  }, []);
  return (
    <View style={styles.widgetContainer}>
      <Animated.View style={{ width: 100, height: 80, alignItems: 'center', opacity: flash.interpolate({ inputRange: [0, 1], outputRange: [1, 0.3] }) }}>
        <MaterialCommunityIcons name="weather-lightning-rainy" size={36} color="#A78BFA" style={{ marginBottom: 4 }} />
        <View style={{ flexDirection: 'row', gap: 6, height: 40, overflow: 'hidden' }}>
          {rain.map((drop, i) => (
            <Animated.View key={i} style={{ transform: [{ translateY: drop }] }}>
              <MaterialCommunityIcons name="water" size={12} color="#38BDF8" />
            </Animated.View>
          ))}
        </View>
      </Animated.View>
      <Text style={styles.widgetLabel}>Thunderstorm</Text>
    </View>
  );
}

export default function WeatherWidget({ weather }: { weather: any }) {
  const type = getWeatherType(weather);
  const renderWidget = () => {
    switch (type) {
      case 'storm':        return <StormWidget />;
      case 'snow':         return <SnowWidget />;
      case 'rain':         return <RainWidget />;
      case 'fog':          return <FogWidget />;
      case 'windy':        return <WindyWidget windSpd={weather?.windSpd} />;
      case 'cloudy':       return <CloudyWidget />;
      case 'partlycloudy': return <PartlyCloudyWidget />;
      default:             return <SunWidget />;
    }
  };
  return <View style={styles.container}>{renderWidget()}</View>;
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#0D1421',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1E2D45',
    padding: 20,
    marginBottom: 14,
    alignItems: 'center',
    minHeight: 140,
    justifyContent: 'center',
  },
  widgetContainer: { alignItems: 'center', gap: 8 },
  widgetLabel: { fontSize: 13, color: '#8A9BB5', fontWeight: '600' },
});
