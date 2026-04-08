/**
 * utils/featureDay.ts
 *
 * Computes the current "feature day key" in America/Chicago timezone with a 4:00 AM rollover.
 * Before 4 AM, the key is the previous day's date so the prior day's featured destinations
 * remain live until the new set goes live at 4 AM CST/CDT.
 *
 * Format: YYYY-MM-DD
 */
export function getFeatureDayKey(): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '00';
  const year  = get('year');
  const month = get('month');
  const day   = get('day');
  const hour  = parseInt(get('hour'), 10);

  // Before 4 AM Chicago time, the "feature day" is still the previous day
  if (hour < 4) {
    const d = new Date(`${year}-${month}-${day}T12:00:00`);
    d.setDate(d.getDate() - 1);
    return [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, '0'),
      String(d.getDate()).padStart(2, '0'),
    ].join('-');
  }

  return `${year}-${month}-${day}`;
}
