import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  return (
    <ThemeProvider value={DarkTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        <Stack.Screen name="airport" options={{ headerShown: false }} />
        <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
      </Stack>
      <StatusBar style="light" />
    </ThemeProvider>
  );
}
{/* <Tabs.Screen
  name="events"
  options={{
    title: 'Events',
    tabBarIcon: () => <TabIcon emoji="📅" />,
  }}
/> */}{/* <Tabs.Screen
  name="explore"
  options={{
    title: 'Map',
    tabBarIcon: () => <TabIcon emoji="🗺️" />,
  }}
/> */}