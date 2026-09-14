/** Per-league accent colors. Keys are stored on `leagues.color`. */
export const LEAGUE_COLOR_KEYS = ["lime", "sky", "amber", "violet", "rose", "teal"] as const;

export type LeagueColorKey = (typeof LEAGUE_COLOR_KEYS)[number];

const SWATCHES: Record<LeagueColorKey, string> = {
  lime: "oklch(0.84 0.19 128)",
  sky: "oklch(0.74 0.14 235)",
  amber: "oklch(0.82 0.16 78)",
  violet: "oklch(0.72 0.16 300)",
  rose: "oklch(0.7 0.18 15)",
  teal: "oklch(0.76 0.12 190)",
};

export const LEAGUE_COLOR_LABELS: Record<LeagueColorKey, string> = {
  lime: "Lime",
  sky: "Sky",
  amber: "Amber",
  violet: "Violet",
  rose: "Rose",
  teal: "Teal",
};

function isKey(value: string | null | undefined): value is LeagueColorKey {
  return !!value && (LEAGUE_COLOR_KEYS as readonly string[]).includes(value);
}

/** Resolve a stored color key (or fall back deterministically from an id) to a CSS color. */
export function leagueColor(key: string | null | undefined, fallbackSeed = ""): string {
  if (isKey(key)) return SWATCHES[key];
  let hash = 0;
  for (let i = 0; i < fallbackSeed.length; i += 1) hash = (hash * 31 + fallbackSeed.charCodeAt(i)) % 9973;
  return SWATCHES[LEAGUE_COLOR_KEYS[hash % LEAGUE_COLOR_KEYS.length]!];
}

/** Two or three letters used on the compact scoreboard tiles. */
export function leagueInitials(name: string): string {
  const words = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (words.length >= 2) return words.slice(0, 3).map((w) => w[0]!.toUpperCase()).join("");
  return (words[0] ?? name).slice(0, 3).toUpperCase();
}
