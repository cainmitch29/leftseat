import { Tabs } from 'expo-router';
import { Text, View } from 'react-native';

function TabIcon({ emoji, focused }: { emoji: string; focused: boolean }) {
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', gap: 4 }}>
      <Text style={{ fontSize: 21, opacity: focused ? 1 : 0.45 }}>{emoji}</Text>
      {focused && (
        <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: '#60CEFF' }} />
      )}
    </View>
  );
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#60CEFF',
        tabBarInactiveTintColor: '#4A6080',
        tabBarStyle: {
          backgroundColor: '#06090F',
          borderTopColor: '#111E30',
          borderTopWidth: 1,
          height: 84,
          paddingBottom: 26,
          paddingTop: 10,
        },
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '700',
          letterSpacing: 0.2,
        },
        headerShown: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Discover',
          tabBarIcon: ({ focused }) => <TabIcon emoji="✈️" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: 'Map',
          tabBarIcon: ({ focused }) => <TabIcon emoji="🗺️" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="events"
        options={{
          title: 'Events',
          tabBarIcon: ({ focused }) => <TabIcon emoji="📅" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="bucketlist"
        options={{
          title: 'Bucket List',
          tabBarIcon: ({ focused }) => <TabIcon emoji="⭐" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ focused }) => <TabIcon emoji="👤" focused={focused} />,
        }}
      />
    </Tabs>
  );
}
