import { Tabs } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Animated, Image, View } from 'react-native';
import {
  BucketListIcon,
  DiscoverIcon,
  EventsIcon,
  MapIcon,
  ProfileIcon,
} from '../../components/TabIcons';
import { useProfilePhoto } from '../../contexts/ProfilePhotoContext';

// Active = bright warm white; orange is reserved for the indicator line only
const ACTIVE   = '#F0F4FF';
const INACTIVE = 'rgba(255,255,255,0.32)';
const ORANGE   = '#FF4D00';

// Thin orange indicator line at the top of the active tab.
// Always rendered (transparent when inactive) to prevent layout shifts.
function ActiveBar({ visible }: { visible: boolean }) {
  return (
    <View
      style={{
        height: 2,
        width: 26,
        borderRadius: 1,
        backgroundColor: visible ? ORANGE : 'transparent',
        shadowColor: ORANGE,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: visible ? 0.55 : 0,
        shadowRadius: 6,
        marginBottom: 3,
      }}
    />
  );
}

// Wrapper: stacks indicator bar above icon and applies tap-scale spring
function TabIcon({ icon, focused }: { icon: React.ReactNode; focused: boolean }) {
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (focused) {
      Animated.sequence([
        Animated.timing(scale, { toValue: 0.93, duration: 65, useNativeDriver: true }),
        Animated.spring(scale, { toValue: 1, friction: 5, tension: 220, useNativeDriver: true }),
      ]).start();
    }
  }, [focused]);

  return (
    <Animated.View style={{ alignItems: 'center', transform: [{ scale }] }}>
      <ActiveBar visible={focused} />
      {icon}
    </Animated.View>
  );
}

// Profile tab: shows user photo (if set) or placeholder icon, same animation
function ProfileTabIcon({ focused }: { focused: boolean }) {
  const { tabPhotoUri } = useProfilePhoto();
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (focused) {
      Animated.sequence([
        Animated.timing(scale, { toValue: 0.93, duration: 65, useNativeDriver: true }),
        Animated.spring(scale, { toValue: 1, friction: 5, tension: 220, useNativeDriver: true }),
      ]).start();
    }
  }, [focused]);

  if (__DEV__) console.log('[TabBar] ProfileTabIcon render — user photo:', tabPhotoUri ? 'AVATAR' : 'PLACEHOLDER', '| focused:', focused);

  return (
    <Animated.View style={{ alignItems: 'center', transform: [{ scale }] }}>
      <ActiveBar visible={focused} />
      {tabPhotoUri ? (
        <Image
          source={{ uri: tabPhotoUri }}
          style={{
            width: 24,
            height: 24,
            borderRadius: 12,
            opacity: focused ? 1 : 0.4,
            borderWidth: focused ? 1.5 : 0,
            borderColor: ORANGE,
          }}
        />
      ) : (
        <ProfileIcon color={focused ? ACTIVE : INACTIVE} size={24} />
      )}
    </Animated.View>
  );
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: ACTIVE,
        tabBarInactiveTintColor: INACTIVE,
        tabBarStyle: {
          backgroundColor: '#060A12',
          borderTopColor: 'rgba(255,255,255,0.08)',
          borderTopWidth: 1,
          height: 76,
          paddingBottom: 22,
          paddingTop: 4,
        },
        tabBarLabelStyle: {
          fontSize: 9,
          fontWeight: '600',
          letterSpacing: 0.5,
          marginTop: -1,
        },
        headerShown: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Discover',
          tabBarIcon: ({ focused }) => (
            <TabIcon focused={focused} icon={<DiscoverIcon color={focused ? ACTIVE : INACTIVE} />} />
          ),
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: 'Map',
          tabBarIcon: ({ focused }) => (
            <TabIcon focused={focused} icon={<MapIcon color={focused ? ACTIVE : INACTIVE} />} />
          ),
        }}
      />
      <Tabs.Screen
        name="events"
        options={{
          title: 'Events',
          tabBarIcon: ({ focused }) => (
            <TabIcon focused={focused} icon={<EventsIcon color={focused ? ACTIVE : INACTIVE} />} />
          ),
        }}
      />
      <Tabs.Screen
        name="hangar"
        options={{ href: null }}
      />
      <Tabs.Screen
        name="bucketlist"
        options={{
          title: 'Bucket List',
          tabBarIcon: ({ focused }) => (
            <TabIcon focused={focused} icon={<BucketListIcon color={focused ? ACTIVE : INACTIVE} />} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ focused }) => <ProfileTabIcon focused={focused} />,
        }}
      />
    </Tabs>
  );
}
