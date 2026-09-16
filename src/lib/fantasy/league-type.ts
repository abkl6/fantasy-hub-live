/**
 * League type (redraft / keeper / dynasty) and variant (none / empire /
 * guillotine), plus how we came to know them. Pure helpers, no I/O.
 *
 * The older `leagues.format` column stays as the internal switch every engine
 * already reads; it is derived from these two fields on every write.
 */

import type { LeagueFormat } from "./format";

export const LEAGUE_TYPES = ["redraft", "keeper", "dynasty"] as const;
export type LeagueType = (typeof LEAGUE_TYPES)[number];

export const LEAGUE_VARIANTS = ["none", "empire", "guillotine"] as const;
export type LeagueVariant = (typeof LEAGUE_VARIANTS)[number];

export const TYPE_SOURCES = ["detected", "inferred", "user"] as const;
export type TypeSource = (typeof TYPE_SOURCES)[number];

export const LEAGUE_TYPE_LABELS: Record<LeagueType, string> = {
  redraft: "Redraft",
  keeper: "Keeper",
  dynasty: "Dynasty",
};

export const LEAGUE_VARIANT_LABELS: Record<LeagueVariant, string> = {
  none: "Standard",
  empire: "Empire",
  guillotine: "Guillotine",
};

const PLATFORM_LABELS: Record<string, string> = {
  sleeper: "Sleeper",
  espn: "ESPN",
  yahoo: "Yahoo",
  ffpc: "FFPC",
  manual: "your setup",
};

export function asLeagueType(value: unknown): LeagueType {
  const v = String(value ?? "redraft").toLowerCase();
  return (LEAGUE_TYPES as readonly string[]).includes(v) ? (v as LeagueType) : "redraft";
}

export function asVariant(value: unknown): LeagueVariant {
  const v = String(value ?? "none").toLowerCase();
  return (LEAGUE_VARIANTS as readonly string[]).includes(v) ? (v as LeagueVariant) : "none";
}

export function asTypeSource(value: unknown): TypeSource {
  const v = String(value ?? "inferred").toLowerCase();
  return (TYPE_SOURCES as readonly string[]).includes(v) ? (v as TypeSource) : "inferred";
}

/** Small note beside the selects so the manager knows whether to trust them. */
export function typeSourceLabel(source: TypeSource, platform?: string | null): string {
  if (source === "user") return "set by you";
  if (source === "detected") {
    const name = PLATFORM_LABELS[String(platform ?? "").toLowerCase()];
    return name ? `detected from ${name}` : "detected";
  }
  return "inferred";
}

/**
 * The engine-facing format. Best ball has no league-type equivalent, so a
 * stored best-ball format is preserved.
 */
export function effectiveFormat(
  leagueType: LeagueType,
  variant: LeagueVariant,
  storedFormat?: string | null,
): LeagueFormat {
  if (variant === "guillotine") return "guillotine";
  if (String(storedFormat ?? "") === "best_ball") return "best_ball";
  return leagueType;
}

/** Dynasty, keeper and empire leagues trade on future value. */
export function showsPickValues(leagueType: LeagueType, variant: LeagueVariant) {
  return leagueType !== "redraft" || variant === "empire";
}

/** Guillotine swaps playoff odds for survival odds and a weekly cut line. */
export function showsSurvival(variant: LeagueVariant) {
  return variant === "guillotine";
}

// --- detection -------------------------------------------------------------

export interface TypeDetection {
  leagueType: LeagueType;
  variant: LeagueVariant;
  typeSource: Exclude<TypeSource, "user">;
}

const REDRAFT: TypeDetection = { leagueType: "redraft", variant: "none", typeSource: "inferred" };

export interface DetectionSignals {
  /** Sleeper `settings.type`: 0 redraft, 1 keeper, 2 dynasty. */
  sleeperType?: number | null;
  /** ESPN `draftSettings.keeperCount`. */
  keeperCount?: number | null;
  /** ESPN `previousSeasons` / any list of prior seasons the league has run. */
  previousSeasons?: unknown[] | null;
  /** Yahoo `renew` / `renewed` keys, present when a league carries over. */
  yahooRenew?: string | null;
  /** FFPC "League Type Description" text, or any platform's type name. */
  typeDescription?: string | null;
  /** FFPC Empire Details panel present on the league page. */
  hasEmpirePanel?: boolean;
  /** Any team owns a draft pick in a future season. */
  hasFuturePicks?: boolean;
  /** The draft contained only rookies. */
  rookieOnlyDraft?: boolean;
  /** Team count has fallen since an earlier read. */
  shrinkingTeamCount?: boolean;
  /** Rules / notice text from the league page. */
  rulesText?: string | null;
  /** Players were on rosters before the draft happened. */
  preDraftRostered?: boolean;
}

/**
 * Direct platform signals win. Anything worked out from roster or rules shape
 * is marked inferred, so the app can ask the manager to confirm it.
 */
export function detectLeagueType(signals: DetectionSignals): TypeDetection {
  const text = `${signals.typeDescription ?? ""} ${signals.rulesText ?? ""}`.toLowerCase();

  let variant: LeagueVariant = "none";
  let variantDetected = false;
  if (signals.hasEmpirePanel || /\bempire\b/.test(text)) {
    variant = "empire";
    variantDetected = true;
  } else if (/\bchop\b|\bguillotine\b/.test(text)) {
    variant = "guillotine";
    variantDetected = true;
  } else if (signals.shrinkingTeamCount || /\beliminated\b/.test(text)) {
    variant = "guillotine";
  }

  // --- direct signals
  if (signals.sleeperType != null) {
    const t = Number(signals.sleeperType);
    if (t === 2) return { leagueType: "dynasty", variant, typeSource: "detected" };
    if (t === 1) return { leagueType: "keeper", variant, typeSource: "detected" };
    if (t === 0 && !signals.hasFuturePicks) {
      return { leagueType: "redraft", variant, typeSource: "detected" };
    }
  }
  if (/\bdynasty\b/.test(text)) return { leagueType: "dynasty", variant, typeSource: "detected" };
  if (/\bkeeper\b/.test(text)) return { leagueType: "keeper", variant, typeSource: "detected" };
  if (/\bredraft\b|\bre-draft\b/.test(text)) {
    return { leagueType: "redraft", variant, typeSource: "detected" };
  }
  if (signals.keeperCount != null && Number(signals.keeperCount) > 0) {
    const many = Number(signals.keeperCount) >= 10;
    return { leagueType: many ? "dynasty" : "keeper", variant, typeSource: "detected" };
  }
  if (signals.yahooRenew) {
    return { leagueType: "keeper", variant, typeSource: "detected" };
  }

  // --- inference
  if (signals.hasFuturePicks || signals.rookieOnlyDraft) {
    return { leagueType: "dynasty", variant, typeSource: "inferred" };
  }
  if (signals.preDraftRostered || (signals.previousSeasons?.length ?? 0) > 0) {
    return { leagueType: "keeper", variant, typeSource: "inferred" };
  }

  return variantDetected
    ? { leagueType: "redraft", variant, typeSource: "detected" }
    : { ...REDRAFT, variant };
}
