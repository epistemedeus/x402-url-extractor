export function utcDayMs(isoOrDate) {
  if (isoOrDate == null) return NaN;
  const text = String(isoOrDate);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) return NaN;
  const date = new Date(parsed);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function daysUntil(target, clock) {
  const targetMs = utcDayMs(target);
  const clockMs = utcDayMs(clock);
  if (!Number.isFinite(targetMs) || !Number.isFinite(clockMs)) return null;
  return Math.round((targetMs - clockMs) / 86_400_000);
}
