export const GOOGLE_KEY = process.env.EXPO_PUBLIC_GOOGLE_API_KEY ?? '';

// Set EXPO_PUBLIC_PLACES_TEST_MODE=true in .env to skip all Google Places nearbysearch calls.
// The app will use mock data and log what would have been requested.
export const USE_PLACES_TEST_MODE = process.env.EXPO_PUBLIC_PLACES_TEST_MODE === 'true';

// Key-presence check runs in EVERY build (dev, preview, TestFlight, production).
// This surfaces the root cause if the key is absent in a real build.
// Does NOT print the actual key — only whether it exists and its length.
if (!GOOGLE_KEY) {
  console.error(
    '[config] GOOGLE_KEY is EMPTY — Google Places will not work in this build.\n' +
    'Dev: check .env has EXPO_PUBLIC_GOOGLE_API_KEY and run: npx expo start --clear\n' +
    'EAS: ensure eas.json build profiles each have env.EXPO_PUBLIC_GOOGLE_API_KEY set'
  );
} else if (__DEV__) {
  console.log(`[config] GOOGLE_KEY present — prefix: ${GOOGLE_KEY.slice(0, 8)}…, length: ${GOOGLE_KEY.length}`);
}
if (USE_PLACES_TEST_MODE) {
  console.warn('[config] PLACES TEST MODE ON — nearbysearch calls are mocked, no API spend');
}