/**
 * NFL game windows in US Eastern time. Used to decide when the live page
 * should poll for updates instead of sitting idle. Pure, browser-safe.
 */

export interface GameWindow {
  live: boolean;
  label: string;
}

function easternParts(date: Date) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  return { weekday, hour };
}

/** True during Thursday night, Sunday daytime/night, and Monday night football. */
export function gameWindow(now: Date = new Date()): GameWindow {
  const { weekday, hour } = easternParts(now);
  if (weekday === "Thu" && hour >= 20) return { live: true, label: "Thursday night" };
  if (weekday === "Fri" && hour < 1) return { live: true, label: "Thursday night" };
  if (weekday === "Sun" && hour >= 9 && hour < 24) return { live: true, label: "Sunday games" };
  if (weekday === "Mon" && hour < 1) return { live: true, label: "Sunday night" };
  if (weekday === "Mon" && hour >= 20) return { live: true, label: "Monday night" };
  if (weekday === "Tue" && hour < 1) return { live: true, label: "Monday night" };
  return { live: false, label: "No games right now" };
}

/** How often the live page should refresh itself, in ms (0 = manual only). */
export function pollInterval(now: Date = new Date()): number {
  return gameWindow(now).live ? 45_000 : 0;
}

export interface Kickoff {
  at: Date;
  label: string;
}

const KICKOFF_SLOTS: { day: number; hour: number; minute: number; label: string }[] = [
  { day: 0, hour: 13, minute: 0, label: "Sunday early games" },
  { day: 1, hour: 20, minute: 15, label: "Monday night" },
  { day: 4, hour: 20, minute: 15, label: "Thursday night" },
];

const DAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function easternMinuteOfWeek(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(date);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return (DAY_INDEX[weekday] ?? 0) * 1440 + hour * 60 + minute;
}

/** The next scheduled NFL kickoff after `now`. */
export function nextKickoff(now: Date = new Date()): Kickoff {
  const current = easternMinuteOfWeek(now);
  let best = KICKOFF_SLOTS[0]!;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const slot of KICKOFF_SLOTS) {
    const target = slot.day * 1440 + slot.hour * 60 + slot.minute;
    const delta = (target - current + 10080) % 10080 || 10080;
    if (delta < bestDelta) {
      bestDelta = delta;
      best = slot;
    }
  }
  return { at: new Date(now.getTime() + bestDelta * 60_000), label: best.label };
}

/**
 * The planning stretch between Monday night's final whistle and the first
 * kickoff of the new week: Tuesday 5am ET through Thursday 8pm ET.
 */
export function inPrepWindow(now: Date = new Date()): boolean {
  if (gameWindow(now).live) return false;
  const { weekday, hour } = easternParts(now);
  if (weekday === "Tue") return hour >= 5;
  if (weekday === "Wed") return true;
  if (weekday === "Thu") return hour < 20;
  return false;
}

/** Where a signed-in manager should land right now. */
export function homeRoute(now: Date = new Date()): "/this-week" | "/gameday" {
  return inPrepWindow(now) ? "/this-week" : "/gameday";
}

/** When waivers typically clear: Wednesday 3am ET. */
export function nextWaiverRun(now: Date = new Date()): Date {
  const current = easternMinuteOfWeek(now);
  const target = 3 * 1440 + 3 * 60;
  const delta = (target - current + 10080) % 10080 || 10080;
  return new Date(now.getTime() + delta * 60_000);
}

/** Human countdown such as "2d 4h" or "48m". */
export function countdownLabel(target: Date, now: Date = new Date()): string {
  const mins = Math.max(0, Math.round((target.getTime() - now.getTime()) / 60_000));
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins % 60}m`;
  return `${mins}m`;
}
