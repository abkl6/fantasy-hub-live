/**
 * Where a league's projections come from.
 *
 * Each league picks one of three settings:
 *  - `platform` — the numbers the host platform (Sleeper, ESPN) publishes
 *  - `app`      — the shared, admin-maintained projection database
 *  - `user`     — the league owner's own uploaded projections
 *
 * Stat lines for every source live side by side in `player_week_stats`,
 * keyed by a `source` string: "sleeper", "espn", "app", or "user:{userId}".
 * Reads always fall back to the app database when the chosen source has no
 * line for a player.
 */

export type ProjectionSourceSetting = "platform" | "app" | "user";

export const PROJECTION_SOURCES: ProjectionSourceSetting[] = ["platform", "app", "user"];

export function asProjectionSource(value: unknown): ProjectionSourceSetting {
  const v = String(value ?? "").toLowerCase();
  return v === "platform" || v === "user" ? v : "app";
}

/** The stored `source` key for a platform, when we can import its numbers. */
export function platformSourceKey(platform: string | null | undefined): string | null {
  const p = (platform ?? "").toLowerCase();
  return p === "sleeper" || p === "espn" ? p : null;
}

export function userSourceKey(userId: string): string {
  return `user:${userId}`;
}

export interface LeagueSourceInput {
  platform?: string | null;
  projection_source?: string | null;
  user_id?: string | null;
}

export interface ResolvedProjectionSource {
  setting: ProjectionSourceSetting;
  /** Source keys in priority order; the app database is always the fallback. */
  sources: string[];
  /** Short label shown beside projected totals. */
  label: string;
}

export function resolveProjectionSource(league: LeagueSourceInput): ResolvedProjectionSource {
  const setting = asProjectionSource(league.projection_source);

  if (setting === "platform") {
    const key = platformSourceKey(league.platform);
    if (key) {
      return {
        setting,
        sources: [key, "app"],
        label: key === "sleeper" ? "Sleeper projections" : "ESPN projections",
      };
    }
    return { setting: "app", sources: ["app"], label: "App projections" };
  }

  if (setting === "user" && league.user_id) {
    return { setting, sources: [userSourceKey(league.user_id), "app"], label: "My projections" };
  }

  return { setting: "app", sources: ["app"], label: "App projections" };
}

/** Default setting for a newly imported league. */
export function defaultProjectionSource(platform: string | null | undefined): ProjectionSourceSetting {
  return platformSourceKey(platform) ? "platform" : "app";
}
