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
  | "donator"
  // guillotine: survival is the only thing that matters
  | "safe"
  | "comfortable"
  | "bubble"
  | "chopping-block"
  | "broke-exposed"
  | "loaded";


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

// --- guillotine survival badges -------------------------------------------

export interface SurvivalClassifyInput {
  /** 0-1 chance of NOT being eliminated this coming week. */
  surviveWeekOdds: number;
  /** 0-1 chance of being the last team standing. */
  winOdds: number;
  /** 1 = strongest team left. */
  powerRank: number;
  /** How many teams are still alive. */
  teamCount: number;
  /** Dollars of bidding money left; null when we don't know. */
  faabRemaining?: number | null;
  /** The league's starting budget, used to read "a lot" vs "nothing". */
  faabBudget?: number | null;
}

/**
 * Guillotine has no playoffs and no title race: the only question each week is
 * whether you outscore the worst team. Badges read off weekly survival odds,
 * with budget deciding between "dangerous" and "dangerous but broke".
 */
export function classifySurvivalTeam(input: SurvivalClassifyInput): TeamBadge {
  const { surviveWeekOdds, winOdds, powerRank, teamCount } = input;
  const budget = input.faabBudget && input.faabBudget > 0 ? input.faabBudget : 100;
  const left = input.faabRemaining ?? null;
  const share = left != null ? left / budget : null;
  const risk = 1 - surviveWeekOdds;
  const evenRisk = 1 / Math.max(2, teamCount);
  const line = `${pctText(surviveWeekOdds)} to survive the week, ${pctText(winOdds)} to win it all`;
  const money = left != null ? ` $${Math.round(left)} left in budget.` : "";

  const inDanger = risk >= evenRisk * 1.6 || powerRank > teamCount - 2;

  if (inDanger && share != null && share <= 0.15) {
    return {
      key: "broke-exposed",
      label: "Broke and Exposed",
      tone: "bad",
      reason: `On the edge and nearly out of money — ${line}.${money}`,
    };
  }
  if (powerRank === teamCount || risk >= evenRisk * 2.2) {
    return {
      key: "chopping-block",
      label: "Chopping Block",
      tone: "bad",
      reason: `Weakest projection in the league — ${line}.${money}`,
    };
  }
  if (inDanger) {
    return {
      key: "bubble",
      label: "On the Bubble",
      tone: "neutral",
      reason: `One bad week from elimination — ${line}.${money}`,
    };
  }
  const veryStrong = risk <= evenRisk * 0.45 || powerRank <= 2;
  if (veryStrong && share != null && share >= 0.6) {
    return {
      key: "loaded",
      label: "Loaded",
      tone: "gold",
      reason: `Safe and still holding most of the budget — ${line}.${money}`,
    };
  }
  if (veryStrong) {
    return {
      key: "safe",
      label: "Safe",
      tone: "gold",
      reason: `Nowhere near the cut line — ${line}.${money}`,
    };
  }
  return {
    key: "comfortable",
    label: "Comfortable",
    tone: "good",
    reason: `Clear of the chopping block, but not untouchable — ${line}.${money}`,
  };
}


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
