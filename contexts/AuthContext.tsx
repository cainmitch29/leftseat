import AsyncStorage from '@react-native-async-storage/async-storage';
import { Session, User } from '@supabase/supabase-js';
import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

interface AuthContextType {
  session: Session | null;
  user: User | null;
  loading: boolean;
  /** True when the user just signed in and hasn't completed profile setup yet. */
  needsProfileSetup: boolean;
  clearProfileSetup: () => void;
  signUp: (email: string, password: string) => Promise<{ error: string | null }>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  loading: true,
  needsProfileSetup: false,
  clearProfileSetup: () => {},
  signUp: async () => ({ error: null }),
  signIn: async () => ({ error: null }),
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsProfileSetup, setNeedsProfileSetup] = useState(false);

  useEffect(() => {
    // Load the existing session (if the user was previously signed in)
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    // Keep the session in sync whenever auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  // ── Guest → Authenticated profile migration ────────────────────────────────
  // When a user authenticates for the first time, copy their guest onboarding
  // data into the user-keyed profile so nothing from onboarding is lost.
  useEffect(() => {
    if (!session?.user?.id) return;
    const userId = session.user.id;

    (async () => {
      try {
        const userKey = `userProfile:${userId}`;
        const existing = await AsyncStorage.getItem(userKey);

        // Only migrate if the authenticated user has no profile yet
        if (existing) {
          if (__DEV__) console.log('[Auth] user profile exists at', userKey, '— no migration needed');
          return;
        }

        const guestRaw = await AsyncStorage.getItem('userProfile:guest');
        if (!guestRaw) {
          if (__DEV__) console.log('[Auth] no guest profile to migrate');
          return;
        }

        const guestProfile = JSON.parse(guestRaw);
        await AsyncStorage.setItem(userKey, JSON.stringify(guestProfile));
        if (__DEV__) console.log('[Auth] migrated guest profile →', userKey);

        // Also seed Supabase pilot_profiles with onboarding data
        try {
          const dbPayload: Record<string, any> = { user_id: userId };
          if (guestProfile.name)            dbPayload.name = guestProfile.name;
          if (guestProfile.home_airport)    dbPayload.home_airport = guestProfile.home_airport;
          if (guestProfile.certificate)     dbPayload.certificate = guestProfile.certificate;
          if (guestProfile.aircraft_type)   dbPayload.aircraft_type = guestProfile.aircraft_type;
          const { error } = await supabase.from('pilot_profiles').upsert(dbPayload);
          if (error) console.warn('[Auth] Supabase profile seed failed:', error.message);
          else if (__DEV__) console.log('[Auth] Supabase profile seeded OK');
        } catch (e: any) {
          console.warn('[Auth] Supabase profile seed exception:', e?.message);
        }
      } catch (e: any) {
        console.warn('[Auth] guest profile migration failed:', e?.message ?? e);
      }
    })();
  }, [session?.user?.id]);

  async function signUp(email: string, password: string) {
    const { error } = await supabase.auth.signUp({ email, password });
    return { error: error?.message ?? null };
  }

  async function signIn(email: string, password: string) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (!error && data.user) {
      // Check if this user already has a name set — if not, flag for profile setup
      try {
        const userKey = `userProfile:${data.user.id}`;
        const raw = await AsyncStorage.getItem(userKey);
        // Also check guest profile (migration may not have run yet)
        const guestRaw = !raw ? await AsyncStorage.getItem('userProfile:guest') : null;
        const profile = raw ? JSON.parse(raw) : guestRaw ? JSON.parse(guestRaw) : null;
        if (!profile?.name) {
          setNeedsProfileSetup(true);
        }
      } catch {
        setNeedsProfileSetup(true);
      }
    }
    return { error: error?.message ?? null };
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  function clearProfileSetup() {
    setNeedsProfileSetup(false);
  }

  return (
    <AuthContext.Provider value={{
      session,
      user: session?.user ?? null,
      loading,
      needsProfileSetup,
      clearProfileSetup,
      signUp,
      signIn,
      signOut,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
