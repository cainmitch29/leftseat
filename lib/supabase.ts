import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rcqvutljdvqecwiegyrb.supabase.co';
const SUPABASE_KEY = 'sb_publishable_RzTyH-JZIKrMSRBr5JakwQ_HAvj0B3W';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
