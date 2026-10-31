// Calendar-day helpers on "YYYY-MM-DD" strings, in UTC so the server time zone never shifts a day.

export function toDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function parseDay(s: string): Date {
  return new Date(`${s}T00:00:00Z`);
}

export function addDays(s: string, n: number): string {
  const d = parseDay(s);
  d.setUTCDate(d.getUTCDate() + n);
  return toDay(d);
}

/** Monday = 0 ... Sunday = 6 (pandas dayofweek). */
export function dayOfWeek(s: string): number {
  return (parseDay(s).getUTCDay() + 6) % 7;
}

export function dayOfYear(s: string): number {
  const d = parseDay(s);
  return Math.round((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000) + 1;
}

export function month(s: string): number {
  return parseDay(s).getUTCMonth() + 1;
}
