/**
 * import_courtesy_cars.mjs
 *
 * Imports courtesy car data from docs/courtesy_cars_data.tsv into the
 * Supabase `crew_cars` table.
 *
 * Usage:
 *   SUPABASE_URL=https://xxx.supabase.co \
 *   SUPABASE_SERVICE_KEY=eyJ... \
 *   node scripts/import_courtesy_cars.mjs
 *
 * Flags:
 *   --dry-run   Print rows that would be inserted without writing to DB
 *   --force     Re-insert even for airports that already have an AirNav row
 *
 * Behaviour:
 *   - Skips airports that already have a row with reporter_name = 'AirNav Community Data'
 *     (unless --force is passed).
 *   - Converts "M/YYYY" last-reported dates to "YYYY-MM-01".
 *   - Maps every row to status = 'Available', available = true.
 *   - Inserts in batches of 100.
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Config ────────────────────────────────────────────────────────────────────
const TSV_PATH    = path.join(__dirname, '../docs/courtesy_cars_data.tsv');
const BATCH_SIZE  = 100;
const DRY_RUN     = process.argv.includes('--dry-run');
const FORCE       = process.argv.includes('--force');
const REPORTER    = 'AirNav Community Data';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!DRY_RUN && (!SUPABASE_URL || !SUPABASE_KEY)) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_KEY env vars (or pass --dry-run).');
  process.exit(1);
}

const supabase = DRY_RUN
  ? null
  : createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Convert "M/YYYY" or "MM/YYYY" → "YYYY-MM-01", or return today if unparseable. */
function parseDate(raw) {
  if (!raw) return new Date().toISOString().slice(0, 10);
  const [m, y] = raw.trim().split('/');
  if (m && y && !isNaN(+m) && !isNaN(+y)) {
    const month = String(+m).padStart(2, '0');
    return `${y}-${month}-01`;
  }
  return new Date().toISOString().slice(0, 10);
}

/** Normalise airport ID — uppercase, strip surrounding whitespace. */
function normaliseIcao(id) {
  return (id || '').trim().toUpperCase();
}

// ── Parse TSV ─────────────────────────────────────────────────────────────────
const raw   = fs.readFileSync(TSV_PATH, 'utf8');
const lines = raw.split('\n').filter(l => l.trim());
const [header, ...rows] = lines;

const cols = header.split('\t').map(c => c.trim());
const stateIdx  = cols.indexOf('State');
const icaoIdx   = cols.indexOf('Airport ID');
const dateIdx   = cols.indexOf('Last Reported');
const notesIdx  = cols.indexOf('Vehicle Description');

if ([stateIdx, icaoIdx, dateIdx, notesIdx].some(i => i === -1)) {
  console.error('TSV header columns not found. Got:', cols);
  process.exit(1);
}

const records = rows
  .map(line => {
    const parts = line.split('\t');
    const icao  = normaliseIcao(parts[icaoIdx]);
    if (!icao) return null;
    return {
      icao,
      available:     true,
      status:        'Available',
      notes:         (parts[notesIdx] || 'Courtesy car available').trim(),
      reported_at:   parseDate(parts[dateIdx]),
      reporter_name: REPORTER,
      // user_id is intentionally omitted — Supabase will use the default (null)
      // which is fine for system-imported data.
    };
  })
  .filter(Boolean);

console.log(`Parsed ${records.length} records from TSV.`);

if (DRY_RUN) {
  console.log('\n-- DRY RUN: first 5 rows --');
  console.table(records.slice(0, 5));
  console.log(`\nWould insert up to ${records.length} rows in batches of ${BATCH_SIZE}.`);
  process.exit(0);
}

// ── Fetch existing AirNav airports to skip ────────────────────────────────────
let skipSet = new Set();
if (!FORCE) {
  console.log('Fetching airports already imported from AirNav…');
  const { data: existing, error } = await supabase
    .from('crew_cars')
    .select('icao')
    .eq('reporter_name', REPORTER);

  if (error) {
    console.error('Failed to fetch existing rows:', error.message);
    process.exit(1);
  }
  skipSet = new Set((existing || []).map(r => r.icao));
  console.log(`  ${skipSet.size} airports already have AirNav data — skipping.`);
}

const toInsert = FORCE ? records : records.filter(r => !skipSet.has(r.icao));
console.log(`Inserting ${toInsert.length} rows…`);

// ── Batch insert ──────────────────────────────────────────────────────────────
let inserted = 0;
let skipped  = 0;
let errors   = 0;

for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
  const batch = toInsert.slice(i, i + BATCH_SIZE);
  const { error } = await supabase.from('crew_cars').insert(batch);

  if (error) {
    console.error(`  Batch ${i / BATCH_SIZE + 1} failed:`, error.message);
    errors += batch.length;
  } else {
    inserted += batch.length;
    if (inserted % 500 === 0 || i + BATCH_SIZE >= toInsert.length) {
      console.log(`  ${inserted} / ${toInsert.length} inserted…`);
    }
  }
}

console.log(`\nDone. Inserted: ${inserted}  Errors: ${errors}  Skipped (already existed): ${skipSet.size}`);
