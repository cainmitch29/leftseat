/**
 * utils/bucketListStorage.ts
 *
 * Unified save/unsave logic for the Bucket List system.
 * Handles festivals and aviation events (airports are still stored in Supabase).
 *
 * Storage key: `savedDestinations:{userId}` → JSON array of SavedDestination[]
 *
 * Notifications (expo-notifications):
 *   Lazy-loaded so the module is safe in Expo Go (which lacks the native push
 *   token module). Notifications silently no-op when the native module is absent.
 *   7 days before, 2 days before, and day-of reminders are scheduled when an
 *   item is saved and cancelled when it is unsaved.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// ── Types ─────────────────────────────────────────────────────────────────────

export type SavedItemType = 'festival' | 'event';

export interface SavedDestination {
  id: string;              // unique key — use event id or a slug
  _type: SavedItemType;
  event_name: string;
  city: string;
  state: string;
  start_date: string;      // YYYY-MM-DD
  end_date: string;        // YYYY-MM-DD
  nearest_airport: string; // ICAO
  category: string;        // Festival, Food Festival, Fly-In, Airshow, etc.
  event_link?: string;
  saved_at: string;        // ISO timestamp
  // Notification IDs scheduled for this item (so we can cancel them)
  notifIds?: string[];
}

// ── Storage helpers ───────────────────────────────────────────────────────────

const storageKey = (userId: string) => `savedDestinations:${userId}`;

export async function getSavedDestinations(userId: string): Promise<SavedDestination[]> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(userId));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function isSaved(userId: string, itemId: string): Promise<boolean> {
  const items = await getSavedDestinations(userId);
  return items.some(i => i.id === itemId);
}

export async function saveDestination(
  userId: string,
  item: Omit<SavedDestination, 'saved_at' | 'notifIds'>
): Promise<void> {
  const items = await getSavedDestinations(userId);
  if (items.some(i => i.id === item.id)) return; // already saved

  const notifIds = await scheduleEventNotifications(item);
  const saved: SavedDestination = {
    ...item,
    saved_at: new Date().toISOString(),
    notifIds,
  };

  await AsyncStorage.setItem(storageKey(userId), JSON.stringify([...items, saved]));
}

export async function unsaveDestination(userId: string, itemId: string): Promise<void> {
  const items = await getSavedDestinations(userId);
  const target = items.find(i => i.id === itemId);
  if (target?.notifIds?.length) {
    await cancelEventNotifications(target.notifIds);
  }
  const next = items.filter(i => i.id !== itemId);
  await AsyncStorage.setItem(storageKey(userId), JSON.stringify(next));
}

// ── Notification helpers ──────────────────────────────────────────────────────
// expo-notifications is lazy-loaded so this module is safe in Expo Go.
// When the native module is absent, scheduling silently returns [] and
// cancellation is a no-op — saving/unsaving works in all environments.

async function getNotifications() {
  try {
    // Dynamic import keeps Expo Go from crashing on missing native module
    const Notifications = await import('expo-notifications');
    return Notifications;
  } catch {
    return null;
  }
}

async function scheduleEventNotifications(
  item: Omit<SavedDestination, 'saved_at' | 'notifIds'>
): Promise<string[]> {
  const Notifications = await getNotifications();
  if (!Notifications) return [];

  try {
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') return [];

    // Parse start date as local noon to avoid timezone shifts
    const [year, month, day] = item.start_date.split('-').map(Number);
    const eventDate = new Date(year, month - 1, day, 8, 0, 0);

    const offsets = [
      { days: 7, label: 'in 1 week' },
      { days: 2, label: 'in 2 days' },
      { days: 0, label: 'today' },
    ];

    const ids: string[] = [];

    for (const { days, label } of offsets) {
      const triggerDate = new Date(eventDate);
      triggerDate.setDate(triggerDate.getDate() - days);

      // Skip if trigger time is in the past
      if (triggerDate.getTime() <= Date.now()) continue;

      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title: item.event_name,
          body: `${item.category} at ${item.nearest_airport} starts ${label} — ${item.city}, ${item.state}`,
          data: { eventId: item.id },
          sound: true,
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: triggerDate,
        },
      });
      ids.push(id);
    }

    return ids;
  } catch (e) {
    if (__DEV__) console.warn('[bucketList] notification scheduling failed', e);
    return [];
  }
}

async function cancelEventNotifications(ids: string[]): Promise<void> {
  const Notifications = await getNotifications();
  if (!Notifications) return;

  try {
    await Promise.all(ids.map(id => Notifications.cancelScheduledNotificationAsync(id)));
  } catch (e) {
    if (__DEV__) console.warn('[bucketList] notification cancel failed', e);
  }
}
