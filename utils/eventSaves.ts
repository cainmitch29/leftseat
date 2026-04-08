/**
 * utils/eventSaves.ts
 *
 * Supabase-backed event save/unsave with community save counts.
 * Table: event_saves (user_id, event_id, event_name)
 */

import { supabase } from '../lib/supabase';

/** Save an event for the current user */
export async function saveEvent(userId: string, eventId: string, eventName: string): Promise<void> {
  const { error } = await supabase.from('event_saves').upsert(
    { user_id: userId, event_id: eventId, event_name: eventName },
    { onConflict: 'user_id,event_id' },
  );
  if (error && __DEV__) console.warn('[EventSaves] save error:', error.message);
}

/** Unsave an event for the current user */
export async function unsaveEvent(userId: string, eventId: string): Promise<void> {
  const { error } = await supabase.from('event_saves')
    .delete()
    .eq('user_id', userId)
    .eq('event_id', eventId);
  if (error && __DEV__) console.warn('[EventSaves] unsave error:', error.message);
}

/** Get all event IDs saved by this user */
export async function getUserSavedEventIds(userId: string): Promise<Set<string>> {
  const { data } = await supabase.from('event_saves')
    .select('event_id')
    .eq('user_id', userId);
  return new Set((data ?? []).map(r => r.event_id));
}

/** Get save counts for a list of event IDs */
export async function getEventSaveCounts(eventIds: string[]): Promise<Record<string, number>> {
  if (eventIds.length === 0) return {};
  const { data } = await supabase.from('event_saves')
    .select('event_id')
    .in('event_id', eventIds);
  const counts: Record<string, number> = {};
  for (const r of (data ?? [])) {
    counts[r.event_id] = (counts[r.event_id] ?? 0) + 1;
  }
  return counts;
}
