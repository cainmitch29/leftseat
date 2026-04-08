/**
 * useCruiseSpeed
 *
 * Returns the user's saved cruise speed (KTAS) from their pilot profile.
 * Falls back to DEFAULT_CRUISE_KTS if no profile exists or no speed is set.
 *
 * Usage:
 *   const cruiseSpeed = useCruiseSpeed();
 *   const time = estimateFlightTime(distNm, cruiseSpeed);
 *
 * The value is read from AsyncStorage (`userProfile:<userId>`) which is kept
 * in sync with Supabase by pilot-profile.tsx whenever the user saves.
 *
 * To change the fallback default, update DEFAULT_CRUISE_KTS below.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

export const DEFAULT_CRUISE_KTS = 120;

export function useCruiseSpeed(): number {
  const { user } = useAuth();
  const [speed, setSpeed] = useState(DEFAULT_CRUISE_KTS);

  useEffect(() => {
    if (!user) return;
    AsyncStorage.getItem(`userProfile:${user.id}`).then(raw => {
      if (!raw) return;
      try {
        const p = JSON.parse(raw);
        const s = Number(p.cruise_speed);
        if (s > 0) {
          setSpeed(s);
          if (__DEV__) console.log('[useCruiseSpeed] loaded:', s, 'kts for user:', user.id);
        }
      } catch {}
    });
  }, [user?.id]);

  return speed;
}
