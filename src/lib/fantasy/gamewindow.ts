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
