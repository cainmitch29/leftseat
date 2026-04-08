#!/usr/bin/env node
/**
 * Tower-status audit — scans airports.json for suspicious mismatches.
 *
 * Flags:
 *  1. has_tower is NON-ATCT (or missing) but tower_hours or tower freq exists
 *  2. has_tower starts with ATCT but was previously missed by === 'ATCT' checks
 *     (i.e. ATCT-TRACON, ATCT-RAPCON, ATCT-A/C variants)
 *
 * Run:  node scripts/audit-tower-status.mjs
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const airports = JSON.parse(readFileSync(resolve(__dirname, '../assets/images/airports.json'), 'utf-8'));

// ── 1. Collect has_tower value distribution ─────────────────────────────────
const valueCounts = {};
for (const a of airports) {
  const v = a.has_tower ?? '(missing)';
  valueCounts[v] = (valueCounts[v] || 0) + 1;
}
console.log('=== has_tower value distribution ===');
for (const [val, cnt] of Object.entries(valueCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(cnt).padStart(5)}  ${val}`);
}
console.log('');

// ── 2. Airports with ATCT-* variants (previously missed by === 'ATCT') ─────
const variants = airports.filter(a => a.has_tower?.startsWith('ATCT') && a.has_tower !== 'ATCT');
if (variants.length > 0) {
  console.log(`=== ATCT variant airports (${variants.length} — were misclassified as untowered) ===`);
  for (const a of variants) {
    const icao = a.icao || a.faa || a.id;
    console.log(`  ${icao.padEnd(6)} ${a.has_tower.padEnd(14)} ${a.name} (${a.city}, ${a.state})`);
  }
  console.log('');
}

// ── 3. Airports marked NON-ATCT but with tower-like indicators ──────────────
// Check for tower_hours, tower_freq, or airspace class that implies a tower.
const suspect = [];
for (const a of airports) {
  if (a.has_tower?.startsWith('ATCT')) continue; // already towered
  const icao = a.icao || a.faa || a.id || '';
  const reasons = [];

  if (a.tower_hours)  reasons.push(`tower_hours="${a.tower_hours}"`);
  if (a.tower_freq)   reasons.push(`tower_freq="${a.tower_freq}"`);
  if (a.twr_freq)     reasons.push(`twr_freq="${a.twr_freq}"`);
  if (a.class && ['B', 'C', 'D'].includes(a.class.toUpperCase()))
    reasons.push(`class="${a.class}"`);

  if (reasons.length > 0) {
    suspect.push({ icao, name: a.name, city: a.city, state: a.state, has_tower: a.has_tower, reasons });
  }
}

if (suspect.length > 0) {
  console.log(`=== Suspect NON-ATCT airports with tower indicators (${suspect.length}) ===`);
  for (const s of suspect) {
    console.log(`  ${s.icao.padEnd(6)} has_tower=${(s.has_tower ?? 'null').padEnd(10)} ${s.reasons.join(', ')}  — ${s.name}`);
  }
} else {
  console.log('=== No suspect NON-ATCT airports with conflicting tower indicators ===');
}

console.log('\nDone. Review any flagged airports manually against FAA data.');
