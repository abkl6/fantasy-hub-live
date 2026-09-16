/**
 * League settings that a platform sync can detect but a manager can also set
 * by hand. Each field records where its value came from in `settings_source`,
 * and a value the manager set is never overwritten by a later sync.
 */

export const DETECTABLE_SETTINGS = [
  "playoff_week_start",
  "playoff_weeks",
  "playoff_teams",
  "playoff_byes",
  "third_place_game",
  "consolation",
  "waiver_type",
  "waiver_run_times",
  "divisions",
  "playoff_seed_type",
  "rules_text",
  "all_play_weeks",
  "regular_season_weeks",
  "contest_format",
] as const;

export type DetectableSetting = (typeof DETECTABLE_SETTINGS)[number];
export type SettingsSource = Partial<Record<DetectableSetting, "detected" | "user">>;

export function asSettingsSource(value: unknown): SettingsSource {
  if (!value || typeof value !== "object") return {};
  const out: SettingsSource = {};
  for (const key of DETECTABLE_SETTINGS) {
    const found = (value as Record<string, unknown>)[key];
    if (found === "user" || found === "detected") out[key] = found;
  }
  return out;
}

/**
 * Keeps only the detected values the manager has not overridden, and marks
 * those it keeps as detected.
 */
export function mergeDetectedSettings(
  stored: unknown,
  detected: Partial<Record<DetectableSetting, unknown>>,
): { patch: Record<string, unknown>; settingsSource: SettingsSource } {
  const source = asSettingsSource(stored);
  const patch: Record<string, unknown> = {};
  for (const key of DETECTABLE_SETTINGS) {
    if (source[key] === "user") continue;
    const value = detected[key];
    if (value === undefined || value === null) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    patch[key] = value;
    source[key] = "detected";
  }
  return { patch, settingsSource: source };
}

/** Marks the fields the manager just edited as theirs. */
export function markUserSettings(stored: unknown, keys: DetectableSetting[]): SettingsSource {
  const source = asSettingsSource(stored);
  for (const key of keys) source[key] = "user";
  return source;
}

export function settingSourceLabel(source: SettingsSource, key: DetectableSetting): string {
  return source[key] === "user" ? "set by you" : source[key] === "detected" ? "detected" : "default";
}
