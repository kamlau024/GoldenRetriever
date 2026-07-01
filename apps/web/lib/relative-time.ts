const DIVISIONS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 60 * 60 * 24 * 365],
  ["month", 60 * 60 * 24 * 30],
  ["day", 60 * 60 * 24],
  ["hour", 60 * 60],
  ["minute", 60],
];
const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** Compact relative timestamp: "just now", "2 minutes ago", "3 hours ago", "3 days ago". */
export function relativeTime(date: Date, now: Date = new Date()): string {
  const secs = Math.round((date.getTime() - now.getTime()) / 1000); // negative for the past
  const abs = Math.abs(secs);
  if (abs < 45) return "just now";
  for (const [unit, inSecs] of DIVISIONS) {
    if (abs >= inSecs) return rtf.format(Math.round(secs / inSecs), unit);
  }
  return "just now";
}
