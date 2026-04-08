/**
 * supabase/functions/delete-account/index.ts
 *
 * Deletes all data owned by the authenticated user and then removes the auth
 * record itself. Called from the app's Settings > Delete Account flow.
 *
 * Required env vars (auto-injected by Supabase runtime):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Request:
 *   POST /functions/v1/delete-account
 *   Authorization: Bearer <user JWT>
 *
 * Response:
 *   200 { success: true }
 *   4xx/5xx { stage: "...", error: "..." }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

Deno.serve(async (req: Request) => {
  // ── CORS preflight ────────────────────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
    });
  }

  if (req.method !== 'POST') {
    return json({ stage: 'method', error: 'Method not allowed' }, 405);
  }

  try {
    // ── 1. Verify env vars ────────────────────────────────────────────────
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      console.error('[delete-account] missing env vars — URL:', !!SUPABASE_URL, 'KEY:', !!SERVICE_ROLE_KEY);
      return json({ stage: 'config', error: 'Server misconfigured — missing environment variables' }, 500);
    }

    // ── 2. Extract JWT from request ─────────────────────────────────────────
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      return json({ stage: 'auth', error: 'Missing Authorization bearer token' }, 401);
    }

    // ── 3. Admin client (service role — bypasses RLS) ───────────────────────
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // ── 4. Validate the user's JWT ──────────────────────────────────────────
    const { data: userData, error: authError } = await admin.auth.getUser(token);
    if (authError || !userData?.user) {
      console.error('[delete-account] auth.getUser failed:', authError?.message);
      return json({ stage: 'lookup', error: authError?.message ?? 'Invalid or expired token' }, 401);
    }

    const userId = userData.user.id;
    console.log('[delete-account] deleting user:', userId);

    // ── 5. Delete user data from tables ─────────────────────────────────────
    // Non-fatal: log errors but continue — don't block account deletion
    // because a table is missing or empty.
    const tableErrors: Array<{ table: string; msg: string }> = [];

    async function deleteWhere(table: string, column: string, value: string) {
      try {
        const { error } = await admin.from(table).delete().eq(column, value);
        if (error) tableErrors.push({ table, msg: error.message });
      } catch (e: any) {
        tableErrors.push({ table, msg: e?.message ?? 'unknown' });
      }
    }

    await deleteWhere('bucket_list', 'user_id', userId);
    await deleteWhere('visited_airports', 'user_id', userId);
    await deleteWhere('crew_cars', 'user_id', userId);
    await deleteWhere('user_place_reports', 'user_id', userId);
    await deleteWhere('pilot_follows', 'follower_id', userId);
    await deleteWhere('pilot_follows', 'following_id', userId);
    await deleteWhere('pilot_profiles', 'user_id', userId);

    if (tableErrors.length > 0) {
      console.warn('[delete-account] non-fatal table errors:', JSON.stringify(tableErrors));
    }

    // ── 6. Delete profile photos from storage (non-fatal) ───────────────────
    try {
      const { data: files } = await admin.storage
        .from('profile-photos')
        .list(userId);

      if (files && files.length > 0) {
        const paths = files.map((f: { name: string }) => `${userId}/${f.name}`);
        await admin.storage.from('profile-photos').remove(paths);
      }
    } catch (e: any) {
      // Storage bucket may not exist — non-fatal
      console.warn('[delete-account] storage cleanup skipped:', e?.message);
    }

    // ── 7. Delete the auth user — point of no return ────────────────────────
    const { error: deleteAuthError } = await admin.auth.admin.deleteUser(userId);
    if (deleteAuthError) {
      console.error('[delete-account] auth.admin.deleteUser failed:', deleteAuthError.message);
      return json({ stage: 'delete_auth', error: deleteAuthError.message }, 500);
    }

    console.log('[delete-account] success — user removed:', userId);
    return json({ success: true }, 200);

  } catch (e: any) {
    // Top-level catch — ensures we always return JSON, never an opaque 500
    console.error('[delete-account] unhandled error:', e?.message ?? e);
    return json({ stage: 'unhandled', error: e?.message ?? 'Internal server error' }, 500);
  }
});
