/**
 * Team quality badges. One badge per team, from this season's odds plus (in
 * dynasty/keeper leagues) where the roster's future value ranks in the league.
 */

export type TeamBadgeKey =
  | "top-seed"
  | "contender"
  | "filler"
  | "bottom"
  | "dynasty-king"
  | "dynasty-contender"
  | "win-now"
  | "future-star"
  | "eternal-mediocrity"
  | "donator";

export interface TeamBadge {
  key: TeamBadgeKey;
  label: string;
  tone: "gold" | "good" | "neutral" | "bad";
  reason: string;
}

export interface ClassifyInput {
  /** 0-1 championship odds. */
  titleOdds: number;
  /** 0-1 playoff odds. */
  playoffOdds: number;
  /** 1 = best title odds in the league. */
  oddsRank: number;
  teamCount: number;
  isDynasty: boolean;
  /** 1 = best dynasty future value in the league. Ignored outside dynasty. */
  dynastyRank?: number | null;
}

const pctText = (v: number) => `${Math.round(v * 100)}%`;

/**
 * "Win now" means this team can realistically win the title this season:
 * top-third odds rank or a genuinely strong playoff chance.
 */
export function isWinNow(input: ClassifyInput) {
  const topThird = input.oddsRank <= Math.max(2, Math.ceil(input.teamCount / 3));
  return topThird || input.playoffOdds >= 0.6;
}

export function classifyTeam(input: ClassifyInput): TeamBadge {
  const { titleOdds, playoffOdds, oddsRank, teamCount, isDynasty } = input;
  const dynastyRank = input.dynastyRank ?? null;
  const winNow = isWinNow(input);
  const season = `${pctText(playoffOdds)} playoff chance, ${pctText(titleOdds)} title chance`;

  if (isDynasty && dynastyRank != null) {
    const bottomFive = dynastyRank > Math.max(1, teamCount - 5);
    if (winNow && dynastyRank === 1) {
      return {
        key: "dynasty-king",
        label: "Dynasty King",
        tone: "gold",
        reason: `Best roster value in the league and built to win now — ${season}.`,
      };
    }
    if (winNow && dynastyRank <= 4) {
      return {
        key: "dynasty-contender",
        label: "Dynasty Contender",
        tone: "gold",
        reason: `Top-four future value and winning now — ${season}.`,
      };
    }
    if (winNow) {
      return {
        key: "win-now",
        label: "Win-Now",
        tone: "good",
        reason: `Set up for this season (${season}) but only #${dynastyRank} in future value — this is the year.`,
      };
    }
    if (dynastyRank <= 4) {
      return {
        key: "future-star",
        label: "Future Star",
        tone: "good",
        reason: `Not winning this year (${season}) but #${dynastyRank} in future value.`,
      };
    }
    if (bottomFive) {
      return {
        key: "donator",
        label: "Donator",
        tone: "bad",
        reason: `Bottom-five future value and no shot this season — ${season}.`,
      };
    }
    return {
      key: "eternal-mediocrity",
      label: "Eternal Mediocrity",
      tone: "neutral",
      reason: `Middle of the pack now (${season}) and middle of the pack later (#${dynastyRank} future value).`,
    };
  }

  if (oddsRank === 1) {
    return { key: "top-seed", label: "Top Seed", tone: "gold", reason: `Best title odds in the league — ${season}.` };
  }
  if (playoffOdds >= 0.5 || oddsRank <= Math.max(2, Math.ceil(teamCount / 3))) {
    return { key: "contender", label: "Contender", tone: "good", reason: `Real playoff team — ${season}.` };
  }
  if (oddsRank > teamCount - Math.max(2, Math.floor(teamCount / 4))) {
    return { key: "bottom", label: "Bottom Feeder", tone: "bad", reason: `Bottom of the league — ${season}.` };
  }
  return {
    key: "filler",
    label: "League Filler",
    tone: "neutral",
    reason: `In the mix but unlikely to matter — ${season}.`,
  };
}

/** Ranks (1 = best) from a list of numbers, ties broken by order. */
export function rankOf<T>(items: T[], score: (item: T) => number): Map<T, number> {
  const sorted = [...items].sort((a, b) => score(b) - score(a));
  return new Map(sorted.map((item, i) => [item, i + 1]));
}
