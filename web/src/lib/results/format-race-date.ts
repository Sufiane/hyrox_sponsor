function format(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(iso));
}

export function formatRaceDate(iso: string, timezone: string): string {
  try {
    return format(iso, timezone);
  } catch {
    return format(iso, 'UTC');
  }
}
