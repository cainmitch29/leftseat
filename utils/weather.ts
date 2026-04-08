// Lightweight METAR parser to derive FAA flight category from a METAR string.
// Exports `getFlightCategory(metar: string)` which returns one of: 'VFR'|'MVFR'|'IFR'|'LIFR'.

function parseVisibilitySM(metar: string): number | null {
  if (!metar) return null;
  const m = metar.toUpperCase();

  // Look for visibility in statute miles (e.g., '10SM', '1/2SM', 'P6SM')
  const smMatch = m.match(/(P?\d+\/\d+|P?\d+)(?=SM)/);
  if (smMatch) {
    const token = smMatch[0];
    if (token.startsWith('P')) return 6; // greater than 6 SM -> treat as >5
    if (token.includes('/')) {
      const parts = token.split('/').map(Number);
      if (parts.length === 2 && parts[1] !== 0) return parts[0] / parts[1];
    }
    const n = Number(token);
    if (!isNaN(n)) return n;
  }

  // Look for metric visibility (meters) like ' 9999 ' or '/ 8000 ' typical in international METARs
  const mMatch = m.match(/\b(\d{4})\b/);
  if (mMatch) {
    const meters = Number(mMatch[1]);
    if (!isNaN(meters)) return meters / 1609.344;
  }

  return null;
}

function parseCeilingFeet(metar: string): number | null {
  if (!metar) return null;
  const m = metar.toUpperCase();

  // Find the lowest BKN/OVC layer (e.g., OVC010, BKN025)
  const re = /(OVC|BKN)(\d{3})/g;
  let match: RegExpExecArray | null;
  let lowest: number | null = null;
  while ((match = re.exec(m)) !== null) {
    const hundreds = Number(match[2]);
    if (!isNaN(hundreds)) {
      const feet = hundreds * 100;
      if (lowest === null || feet < lowest) lowest = feet;
    }
  }

  // If no BKN/OVC, treat ceiling as very high (no ceiling)
  return lowest ?? null;
}

export function getFlightCategory(metar: string): 'VFR' | 'MVFR' | 'IFR' | 'LIFR' {
  const met = (metar || '').toString();
  const vis = parseVisibilitySM(met);
  const ceiling = parseCeilingFeet(met);

  // Apply standard FAA thresholds. If a value is missing, prefer conservative classification
  // only when both are missing default to VFR.
  if ((ceiling === null || ceiling > 3000) && (vis === null || vis > 5)) return 'VFR';

  // LIFR
  if ((ceiling !== null && ceiling < 500) || (vis !== null && vis < 1)) return 'LIFR';

  // IFR
  if ((ceiling !== null && ceiling >= 500 && ceiling < 1000) || (vis !== null && vis >= 1 && vis < 3)) return 'IFR';

  // MVFR
  if ((ceiling !== null && ceiling >= 1000 && ceiling <= 3000) || (vis !== null && vis >= 3 && vis <= 5)) return 'MVFR';

  // Fallback: if we have visibility but not ceiling
  if (vis !== null) {
    if (vis > 5) return 'VFR';
    if (vis >= 3) return 'MVFR';
    if (vis >= 1) return 'IFR';
    return 'LIFR';
  }

  // If only ceiling available
  if (ceiling !== null) {
    if (ceiling > 3000) return 'VFR';
    if (ceiling >= 1000) return 'MVFR';
    if (ceiling >= 500) return 'IFR';
    return 'LIFR';
  }

  return 'VFR';
}

export default { getFlightCategory };
