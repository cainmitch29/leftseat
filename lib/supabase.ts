import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = 'https://rcqvutljdvqecwiegyrb.supabase.co';
const SUPABASE_KEY = 'sb_publishable_RzTyH-JZIKrMSRBr5JakwQ_HAvj0B3W';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
