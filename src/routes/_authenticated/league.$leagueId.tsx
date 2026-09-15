import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Loader2,
  RefreshCw,
  Shield,
  Trophy,
  Users,
} from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { CacheStatus } from "@/components/CacheStatus";
import { DraftPicksPanel } from "@/components/DraftPicksPanel";
import { useCachedQuery } from "@/hooks/useCachedQuery";
import type { TeamBadge as TeamBadgeValue } from "@/lib/fantasy/team-class";
import { TeamBadge } from "@/components/TeamBadge";
import { TradeBuilder } from "@/components/TradeBuilder";
import { GameDayBoard } from "@/components/GameDayBoard";
import { ManualUpkeep } from "@/components/ManualUpkeep";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  applyMoveFn,
  evaluateTradeFn,
  getAnalysis,
  getDraftRecapFn,
  getPlayoffPictureFn,
  getTrendsFn,
  getWaiverBoard,
  importSleeperDraftFn,
  setBestLineupFn,
  updateFaab,
  updateLeagueSettings,

} from "@/lib/fantasy.functions";
import { logTrade } from "@/lib/platforms.functions";
import { LEAGUE_COLOR_KEYS, LEAGUE_COLOR_LABELS, leagueColor } from "@/lib/league-colors";
import { CONTEST_DESCRIPTIONS, CONTEST_FORMATS, CONTEST_LABELS } from "@/lib/fantasy/contest";

const statusTone: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  Active: "default",
  Questionable: "secondary",
  Doubtful: "destructive",
  Out: "destructive",
  IR: "destructive",
};

interface LeagueSearch {
  tab?: string;
  swap?: string;
  with?: string;
}

export const Route = createFileRoute("/_authenticated/league/$leagueId")({
  head: () => ({
    meta: [
      { title: "League analyzer — Gridiron Edge" },
      {
        name: "description",
        content:
          "Live scoreboard, championship odds, position grades and the moves that raise your title chances the most.",
      },
      { property: "og:title", content: "League analyzer — Gridiron Edge" },
      { property: "og:description", content: "Championship odds and ranked moves for your fantasy team." },
    ],
  }),
  // Notification deep links land here: ?tab=lineup&swap=Player&with=Replacement
  validateSearch: (search: Record<string, unknown>): LeagueSearch => {
    const out: LeagueSearch = {};
    if (typeof search["tab"] === "string") out.tab = search["tab"];
    if (typeof search["swap"] === "string") out.swap = search["swap"];
    if (typeof search["with"] === "string") out.with = search["with"];
    return out;
  },
  component: LeaguePage,
});

const pct = (n: number) => `${Math.round(n * 100)}%`;
const signed = (n: number) => `${n >= 0 ? "+" : ""}${(n * 100).toFixed(1)} pts`;

function LeaguePage() {
  const { leagueId } = Route.useParams();
  const search = Route.useSearch();
  const analyze = useServerFn(getAnalysis);
  const [tab, setTab] = useState(search.tab === "lineup" ? "lineup" : "moves");

  const forceRef = useRef(false);
  const { data, isLoading, isFetching, refetch, error, updating, stale, lastUpdated } = useCachedQuery({
    cacheKey: `analysis:${leagueId}`,
    queryKey: ["analysis", leagueId],
    queryFn: () => {
      const force = forceRef.current;
      forceRef.current = false;
      return analyze({ data: { leagueId, force } });
    },
    refetchOnWindowFocus: false,
  });
  const hardRefresh = () => {
    forceRef.current = true;
    return refetch();
  };

  if (isLoading) {
    return (
      <main className="mx-auto max-w-6xl space-y-4 px-6 py-10">
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-10">
        <h1 className="text-2xl font-bold">We could not load this league</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {error instanceof Error ? error.message : "Try refreshing in a moment."}
        </p>
        <Button className="mt-4" onClick={() => refetch()}>
          Try again
        </Button>
      </main>
    );
  }

  const me = data.myTeam;

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow text-primary">Week {data.league.current_week}</p>
          <div className="mt-2 flex items-center gap-3">
            <h1 className="text-2xl font-bold">{data.league.name}</h1>
            <LeagueColorPicker leagueId={leagueId} current={(data.league as { color?: string | null }).color ?? null} />
          </div>
          <div className="mt-1">
            <CacheStatus updating={updating} stale={stale} lastUpdated={lastUpdated} />
          </div>
          {me && (
            <p className="mt-1 text-sm text-muted-foreground">
              {me.name} · {me.record} · {me.pointsFor.toFixed(1)} points for
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge variant="secondary" className="text-[10px]">
              {data.formatLabel}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              {data.scoringLabel}
            </Badge>
            <ProjectionSourcePicker
              leagueId={leagueId}
              platform={data.league.platform}
              current={data.league.projection_source}
              label={data.projectionLabel}
            />
          </div>
        </div>
        <Button variant="outline" onClick={() => hardRefresh()} disabled={isFetching}>
          {isFetching ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          Refresh
        </Button>
      </div>

      {data.league.platform === "manual" && <ManualUpkeep leagueId={leagueId} />}

      {me && !data.mySurvival && (
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <OddsCard label="Title odds" value={pct(me.titleOdds)} tone="primary" />
          <OddsCard label="Playoff odds" value={pct(me.playoffOdds)} />
          <OddsCard
            label="Projected finish"
            value={`${me.projWins.toFixed(1)}-${me.projLosses.toFixed(1)}`}
          />
        </div>
      )}

      {me && data.mySurvival && (
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <OddsCard label="Survive this week" value={pct(data.mySurvival.surviveWeekOdds)} tone="primary" />
          <OddsCard label="Last team standing" value={pct(data.mySurvival.winOdds)} />
          <OddsCard
            label="Weeks you should last"
            value={`${data.mySurvival.expectedWeeksLeft}`}
          />
        </div>
      )}

      {!!data.alerts?.length && (
        <section className="mt-6 space-y-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-destructive" />
            <h2 className="text-sm font-bold text-destructive">Alerts</h2>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {data.alerts.map((a) => (
              <div
                key={a.id}
                className={`flex items-start justify-between gap-3 rounded-xl border border-border bg-card p-4 ${
                  a.severity === "high" ? "border-l-4 border-l-destructive" : ""
                }`}
              >
                <div>
                  <p className="text-sm font-medium">{a.message}</p>
                  <p className="text-xs text-muted-foreground capitalize">
                    {a.position} · {a.kind}
                  </p>
                </div>
                {a.action && (
                  <Button size="sm" variant="outline" onClick={() => setTab("moves")}>
                    {a.action.label}
                  </Button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <Tabs value={tab} onValueChange={setTab} className="mt-8">
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="lineup">Lineup</TabsTrigger>
          <TabsTrigger value="moves">Moves</TabsTrigger>
          <TabsTrigger value="league">League</TabsTrigger>
          <TabsTrigger value="live">Live</TabsTrigger>
        </TabsList>

        <TabsContent value="live" className="mt-6">
          <GameDayBoard leagueId={leagueId} />
        </TabsContent>

        <TabsContent value="moves" className="mt-6 space-y-3">
          {data.myStrategy && data.myBadge && (
            <div className="rounded-xl bg-card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge>{data.myBadge.label}</Badge>
                <Badge variant="secondary">
                  {data.myStrategy.label}
                </Badge>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{data.myStrategy.rationale}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Targeting {data.myStrategy.wants} and moving on from {data.myStrategy.gives}.
              </p>
            </div>
          )}
          {!data.suggestions.length && (
            <p className="text-sm text-muted-foreground">
              No moves worth making right now — your lineup is already the strongest one available.
            </p>
          )}
          {data.suggestions.map((s) => (
            <MoveCard key={s.id} leagueId={leagueId} suggestion={s} onApplied={() => refetch()} />
          ))}

          <Section title="Waiver wire">
            <WaiverPanel leagueId={leagueId} onAdded={() => refetch()} />
          </Section>

          <Section title="Trades">
            <div className="space-y-6">
              <TradeBuilder leagueId={leagueId} />
              <TradePanel leagueId={leagueId} />
              <DraftPicksPanel leagueId={leagueId} />
            </div>
          </Section>
        </TabsContent>

        <TabsContent value="lineup" className="mt-6 space-y-4">
          {search.swap && (
            <div className="flex items-start gap-3 rounded-xl bg-card p-4">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
              <p className="text-sm">
                <span className="font-medium">{search.swap}</span> can't play this week.
                {search.with ? (
                  <>
                    {" "}
                    Best replacement: <span className="font-medium">{search.with}</span>.
                  </>
                ) : (
                  " No bench replacement is available at that spot."
                )}
              </p>
            </div>
          )}
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Starters are based on projected points for this week.
            </p>
            <SetBestLineupButton leagueId={leagueId} onApplied={() => refetch()} />
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            <PlayerList title="Best starting lineup" players={data.lineup} />
            <PlayerList title="Bench" players={data.bench} />
          </div>
        </TabsContent>

        <TabsContent value="league" className="mt-6 space-y-6">
          {data.contestFormat !== "points" && (
            <Section title="Standings">
              <div className="overflow-x-auto">
                <StandingsTable
                  leagueId={leagueId}
                  standings={data.standings}
                  showWeeklyHighs={data.weeklyHighBonus}
                />
              </div>
            </Section>
          )}

          {data.pointsStandings && (
            <Section title={data.contestFormat === "points" ? "Standings" : "Points standings"}>
              <div className="overflow-x-auto">
                <PointsStandingsTable
                  rows={data.pointsStandings}
                  topN={data.pointsPlayoff.teams}
                  showWeeklyHighs={data.weeklyHighBonus}
                />
              </div>
            </Section>
          )}

          {data.contestFormat !== "points" && (
          <Section title="Scoreboard">
            <div className="space-y-3">
              {!data.scoreboard.length && (
                <p className="text-sm text-muted-foreground">No matchups posted for this week yet.</p>
              )}
              {data.scoreboard.map((m, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between rounded-xl bg-card p-5"
                >
                  <TeamScore
                    name={m.home.name}
                    points={m.home.score}
                    winning={m.home.score >= m.away.score}
                  />
                  <span className="px-4 text-xs text-muted-foreground">vs</span>
                  <TeamScore
                    name={m.away.name}
                    points={m.away.score}
                    winning={m.away.score > m.home.score}
                    alignRight
                  />
                </div>
              ))}
            </div>
          </Section>
          )}

          <Section title="League rules">
            <ContestSettings
              leagueId={leagueId}
              contestFormat={data.contestFormat}
              pointsPlayoff={data.pointsPlayoff}
              weeklyHighBonus={data.weeklyHighBonus}
              weeklyHighLabel={data.weeklyHighLabel}
            />
          </Section>

          <Section title="Position grades">
            <div className="space-y-3">
              {data.grades.map((g) => (
                <div key={g.position} className="rounded-xl bg-card p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-lg font-semibold">{g.position}</p>
                      <p className="text-xs text-muted-foreground">
                        {g.myPoints.toFixed(1)} proj pts vs {g.leagueAverage.toFixed(1)} league average
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="stat-num text-3xl text-primary">{g.grade}</p>
                      <p className="text-xs text-muted-foreground">{g.verdict}</p>
                    </div>
                  </div>
                  <Progress
                    className="mt-3"
                    value={Math.max(
                      4,
                      Math.min(100, (g.myPoints / Math.max(g.leagueAverage * 2, 1)) * 100),
                    )}
                  />
                </div>
              ))}
            </div>
          </Section>

          <Section title="Playoff picture">
            <PlayoffPanel leagueId={leagueId} />
          </Section>

          <Section title="Trends">
            <TrendsPanel leagueId={leagueId} />
          </Section>

          <Section title="Draft">
            <DraftPanel leagueId={leagueId} />
          </Section>
        </TabsContent>
      </Tabs>
    </main>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-bold tracking-wide text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

function OddsCard({ label, value, tone }: { label: string; value: string; tone?: "primary" }) {
  return (
    <div className="rounded-xl bg-card p-5">
      <p className="eyebrow text-muted-foreground">{label}</p>
      <p className={`stat-num mt-1 text-4xl ${tone === "primary" ? "text-primary" : ""}`}>{value}</p>
    </div>
  );
}

function TeamScore({
  name,
  points,
  winning,
  alignRight,
}: {
  name: string;
  points: number;
  winning: boolean;
  alignRight?: boolean;
}) {
  return (
    <div className={alignRight ? "text-right" : ""}>
      <p className="font-semibold">{name}</p>
      <p className={`stat-num text-2xl ${winning ? "text-primary" : "text-muted-foreground"}`}>
        {points.toFixed(1)}
      </p>
    </div>
  );
}

function PlayerList({
  title,
  players,
}: {
  title: string;
  players: { name: string; position: string; slot?: string; proj: number; status?: string; nflTeam?: string | null; byeWeek?: number | null }[];
}) {
  return (
    <section className="rounded-xl bg-card p-5">
      <h2 className="text-lg font-bold">{title}</h2>
      <ul className="mt-3 space-y-2">
        {players.map((p, i) => (
          <li key={`${p.name}-${i}`} className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2">
              <span className="eyebrow text-muted-foreground">{p.slot ?? p.position}</span>
              <span>{p.name}</span>
              {p.status && p.status !== "Active" && (
                <Badge variant={statusTone[p.status] ?? "secondary"} className="text-[10px]">
                  {p.status}
                </Badge>
              )}
              {p.byeWeek && (
                <Badge variant="outline" className="text-[10px]">
                  bye {p.byeWeek}
                </Badge>
              )}
              {p.nflTeam && <span className="text-xs text-muted-foreground">{p.nflTeam}</span>}
            </span>
            <span className="stat-num">{p.proj.toFixed(1)}</span>
          </li>
        ))}
        {!players.length && <li className="text-sm text-muted-foreground">Nothing here.</li>}
      </ul>
    </section>
  );
}


/** Guillotine bidding needs real balances, so let managers keep them current. */
function FaabBudgetStrip({
  leagueId,
  budget,
  remaining,
  teamId,
}: {
  leagueId: string;
  budget: number;
  remaining: number | null;
  teamId: string | null;
}) {
  const save = useServerFn(updateFaab);
  const queryClient = useQueryClient();
  const [budgetValue, setBudgetValue] = useState(String(budget));
  const [remainingValue, setRemainingValue] = useState(remaining == null ? "" : String(remaining));

  const mutation = useMutation({
    mutationFn: () =>
      save({
        data: {
          leagueId,
          budget: Number(budgetValue) || budget,
          ...(teamId && remainingValue !== ""
            ? { teamId, remaining: Math.max(0, Math.round(Number(remainingValue))) }
            : {}),
        },
      }),
    onSuccess: () => {
      toast.success("Budget saved.");
      queryClient.invalidateQueries({ queryKey: ["waivers", leagueId] });
      queryClient.invalidateQueries({ queryKey: ["analysis", leagueId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save the budget."),
  });

  return (
    <div className="mt-4 flex flex-wrap items-end gap-3 rounded-lg bg-muted/30 p-3">
      <div>
        <label className="eyebrow text-muted-foreground">League budget</label>
        <Input
          value={budgetValue}
          onChange={(e) => setBudgetValue(e.target.value)}
          inputMode="numeric"
          className="mt-1 w-28"
        />
      </div>
      <div>
        <label className="eyebrow text-muted-foreground">Your money left</label>
        <Input
          value={remainingValue}
          onChange={(e) => setRemainingValue(e.target.value)}
          inputMode="numeric"
          placeholder={String(budget)}
          className="mt-1 w-28"
        />
      </div>
      <Button size="sm" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
        {mutation.isPending ? <Loader2 className="size-3 animate-spin" /> : "Save"}
      </Button>
      <p className="text-xs text-muted-foreground">
        Sleeper leagues fill this in automatically on each sync.
      </p>
    </div>
  );
}

const POSITIONS = ["ALL", "QB", "RB", "WR", "TE", "K", "DEF", "DL", "LB", "DB"];

const SORTS = [
  { id: "impact", label: "Title impact" },
  { id: "points", label: "Points" },
  { id: "bid", label: "Bid" },
  { id: "value", label: "Trade value" },
  { id: "ktc", label: "Market value" },
  { id: "gems", label: "Undervalued" },
] as const;

function WaiverPanel({ leagueId, onAdded }: { leagueId: string; onAdded?: () => void }) {
  const load = useServerFn(getWaiverBoard);
  const add = useServerFn(applyMoveFn);
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [position, setPosition] = useState("ALL");
  const [sort, setSort] = useState<(typeof SORTS)[number]["id"]>("impact");

  const { data, isFetching } = useQuery({
    queryKey: ["waivers", leagueId, search, position],
    queryFn: () => load({ data: { leagueId, search, position } }),
    refetchOnWindowFocus: false,
  });

  const addMutation = useMutation({
    mutationFn: (v: { name: string; drop: string | null }) =>
      add({ data: { leagueId, kind: "waiver", addName: v.name, dropName: v.drop } }),
    onSuccess: (_r, v) => {
      toast.success(v.drop ? `Added ${v.name}, dropped ${v.drop}` : `${v.name} added to your bench`);
      queryClient.invalidateQueries({ queryKey: ["analysis", leagueId] });
      queryClient.invalidateQueries({ queryKey: ["waivers", leagueId] });
      onAdded?.();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not add player."),
  });

  const rows = [...(data?.rows ?? [])].sort((a, b) => {
    if (sort === "points") return b.projWeek - a.projWeek;
    if (sort === "bid") return b.bid - a.bid;
    if (sort === "value") return b.tradeValue - a.tradeValue;
    if (sort === "ktc") return (b.ktcValue ?? -1) - (a.ktcValue ?? -1);
    if (sort === "gems")
      return (
        Number(b.undervalued) - Number(a.undervalued) ||
        b.projValue - (b.ktcValue ?? b.projValue) - (a.projValue - (a.ktcValue ?? a.projValue))
      );
    // Rebuilding teams care about who is worth keeping, not this week's bump.
    if (data?.strategy === "sell")
      return (
        (b.longTermValue ?? 0) - (a.longTermValue ?? 0) ||
        (b.ktcValue ?? b.projValue) - (a.ktcValue ?? a.projValue)
      );
    return (b.titleDelta ?? -1) - (a.titleDelta ?? -1) || b.tradeValue - a.tradeValue;
  });

  const rosterFull = !!data && data.rosterSize >= data.rosterLimit;

  return (
    <section className="rounded-xl bg-card p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Waiver wire</h2>
          <p className="text-xs text-muted-foreground">
            Everyone still unowned in this league, with what they are worth and what they do to your
            title chances.
          </p>
          {data?.strategyNote && (
            <p className="mt-1 text-xs text-muted-foreground">{data.strategyNote}</p>
          )}
        </div>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search a player"
          className="w-full sm:w-64"
        />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {POSITIONS.map((p) => (
          <Button
            key={p}
            size="sm"
            variant={position === p ? "default" : "outline"}
            onClick={() => setPosition(p)}
          >
            {p}
          </Button>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="eyebrow text-muted-foreground">Sort by</span>
        {SORTS.map((s) => (
          <Button
            key={s.id}
            size="sm"
            variant={sort === s.id ? "secondary" : "ghost"}
            onClick={() => setSort(s.id)}
          >
            {s.label}
          </Button>
        ))}
      </div>

      {data && (
        <p className="mt-3 text-xs text-muted-foreground">
          {data.hasMyTeam
            ? `Roster ${data.rosterSize} of ${data.rosterLimit}.${rosterFull ? " Full — an add will drop the suggested player." : ""}`
            : "Mark one team as yours to see title impact and bids."}
          {data.estimatedRosterSpots
            ? " Some rival rosters are estimated, so this list is approximate."
            : ""}
        </p>
      )}

      {data?.isSurvivalLeague && (
        <FaabBudgetStrip
          leagueId={leagueId}
          budget={data.faabBudget}
          remaining={data.myFaabRemaining}
          teamId={data.myTeamId}
        />
      )}

      <ul className="mt-4 space-y-1">
        {isFetching && !data && <li className="text-sm text-muted-foreground">Loading…</li>}
        {rows.map((p) => (
          <li key={p.id} className="border-t border-border py-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="eyebrow text-muted-foreground">{p.position}</span>
                  <span className="font-medium">{p.name}</span>
                  {p.undervalued && (
                    <Badge className="text-[10px]">Undervalued</Badge>
                  )}
                  {p.status && p.status !== "Active" && (
                    <Badge variant={statusTone[p.status] ?? "secondary"} className="text-[10px]">
                      {p.status}
                    </Badge>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {p.nflTeam ?? "FA"}
                    {p.byeWeek ? ` · bye ${p.byeWeek}` : ""}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    <span className="stat-num text-foreground">{p.projWeek.toFixed(1)}</span> pts/wk ·{" "}
                    <span className="stat-num text-foreground">{p.projSeason.toFixed(0)}</span> season
                  </span>
                  <span>
                    Trade value{" "}
                    <span className={`stat-num ${p.tradeValue > 0 ? "text-foreground" : ""}`}>
                      {p.tradeValue > 0 ? "+" : ""}
                      {p.tradeValue.toFixed(1)}
                    </span>
                  </span>
                  {p.ktcValue !== null && (
                    <span>
                      Market{" "}
                      <span className="stat-num text-foreground">{p.ktcValue.toLocaleString()}</span>
                      {p.undervalued && (
                        <span className="text-primary"> · worth {p.projValue.toLocaleString()}</span>
                      )}
                    </span>
                  )}
                  {!p.bids && (
                    <span>
                      Bid{" "}
                      <span className="stat-num text-foreground">
                        {p.bid > 0 ? `${p.bid}%` : "no bid"}
                      </span>
                    </span>
                  )}
                  {p.longTermValue !== null && (
                    <span>
                      Keep value{" "}
                      <span className="stat-num text-foreground">{p.longTermValue.toFixed(0)}</span>/100
                    </span>
                  )}
                  {p.titleDelta !== null && (
                    <span className={p.titleDelta > 0 ? "text-primary" : ""}>
                      Title {p.titleDelta > 0 ? "+" : ""}
                      {(p.titleDelta * 100).toFixed(1)} pts · playoffs {(p.playoffDelta ?? 0) > 0 ? "+" : ""}
                      {((p.playoffDelta ?? 0) * 100).toFixed(1)}
                    </span>
                  )}
                  {p.suggestedDrop && <span>Drop {p.suggestedDrop}</span>}
                </div>
                {p.bids && (
                  <div className="mt-2 rounded-lg bg-muted/30 p-2">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="rounded-md border border-border px-2 py-1">
                        Passive{" "}
                        <span className="stat-num text-foreground">${p.bids.passive}</span>
                      </span>
                      <span className="rounded-md bg-primary px-2 py-1 text-primary-foreground">
                        Optimal <span className="stat-num">${p.bids.optimal}</span>
                      </span>
                      <span className="rounded-md border border-border px-2 py-1">
                        Aggressive{" "}
                        <span className="stat-num text-foreground">${p.bids.aggressive}</span>
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{p.bids.reason}</p>
                  </div>
                )}
              </div>
              <Button
                size="sm"
                variant={p.titleDelta && p.titleDelta > 0 ? "default" : "outline"}
                disabled={addMutation.isPending && addMutation.variables?.name === p.name}
                onClick={() => {
                  if (rosterFull && !p.suggestedDrop) {
                    toast.error("Your roster is full. Drop someone on the Lineup tab first.");
                    return;
                  }
                  addMutation.mutate({ name: p.name, drop: p.suggestedDrop });
                }}
              >
                {addMutation.isPending && addMutation.variables?.name === p.name ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  "Add"
                )}
              </Button>
            </div>
          </li>
        ))}
        {data && !rows.length && (
          <li className="text-sm text-muted-foreground">No available players match that.</li>
        )}
      </ul>
    </section>
  );
}

function TradePanel({ leagueId }: { leagueId: string }) {
  const evaluate = useServerFn(evaluateTradeFn);
  const save = useServerFn(logTrade);
  const [give, setGive] = useState("");
  const [get, setGet] = useState("");
  const [saved, setSaved] = useState(false);

  const run = useMutation({
    mutationFn: () =>
      evaluate({
        data: {
          leagueId,
          giveNames: give.split(",").map((s) => s.trim()).filter(Boolean),
          getNames: get.split(",").map((s) => s.trim()).filter(Boolean),
        },
      }),
    onSuccess: () => setSaved(false),
  });

  const store = useMutation({
    mutationFn: (status: "proposed" | "accepted") => {
      const r = run.data!;
      return save({
        data: {
          leagueId,
          gave: give
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
            .map((name) => ({ name, position: "-", proj: 0 })),
          got: r.incoming,
          pointsDelta: r.pointsDelta,
          titleOddsBefore: r.beforeTitleOdds,
          titleOddsAfter: r.afterTitleOdds,
          playoffOddsBefore: r.beforePlayoffOdds,
          playoffOddsAfter: r.afterPlayoffOdds,
          winsBefore: r.beforeWins,
          winsAfter: r.afterWins,
          verdict: r.verdict,
          status,
        },
      });
    },
    onSuccess: () => {
      setSaved(true);
      toast.success("Saved to your trade history.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save that trade."),
  });

  return (
    <section className="rounded-xl bg-card p-6">
      <h2 className="text-2xl font-bold">Evaluate a trade</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Enter the players on each side and we will re-run the rest of the season to see what it does
        to your title odds.
      </p>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="give">You give</Label>
          <Input id="give" value={give} onChange={(e) => setGive(e.target.value)} placeholder="Player, Player" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="get">You get</Label>
          <Input id="get" value={get} onChange={(e) => setGet(e.target.value)} placeholder="Player, Player" />
        </div>
      </div>
      <Button className="mt-5" disabled={run.isPending || !give || !get} onClick={() => run.mutate()}>
        {run.isPending ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
        Check this trade
      </Button>

      {run.error && (
        <p className="mt-4 text-sm text-destructive">
          {run.error instanceof Error ? run.error.message : "Could not evaluate that trade."}
        </p>
      )}

      {run.data && (
        <div className="mt-6 rounded-lg bg-background/50 p-5">
          <Badge
            variant={run.data.verdict === "accept" ? "default" : "secondary"}
          >
            {run.data.verdict}
          </Badge>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <Stat
              label="Title odds"
              before={pct(run.data.beforeTitleOdds)}
              after={pct(run.data.afterTitleOdds)}
            />
            <Stat
              label="Playoff odds"
              before={pct(run.data.beforePlayoffOdds)}
              after={pct(run.data.afterPlayoffOdds)}
            />
            <Stat
              label="Projected wins"
              before={run.data.beforeWins.toFixed(1)}
              after={run.data.afterWins.toFixed(1)}
            />
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Weekly points change: {run.data.pointsDelta >= 0 ? "+" : ""}
            {run.data.pointsDelta.toFixed(1)}
          </p>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button size="sm" disabled={store.isPending || saved} onClick={() => store.mutate("accepted")}>
              {store.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              I made this trade
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={store.isPending || saved}
              onClick={() => store.mutate("proposed")}
            >
              Save as an idea
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                const text = `Trade offer: I give ${give || "?"} and get ${get || "?"}. Projected title odds ${pct(run.data.beforeTitleOdds)} → ${pct(run.data.afterTitleOdds)} (${run.data.verdict}).`;
                navigator.clipboard.writeText(text).then(() => toast.success("Trade text copied"));
              }}
            >
              <Copy className="size-4 mr-1" />
              Copy text
            </Button>
            <Button asChild size="sm" variant="ghost">
              <Link to="/trades">See trade history</Link>
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

/** Season-long total points table, shown on points and hybrid leagues. */
function PointsStandingsTable({
  rows,
  topN,
  showWeeklyHighs,
}: {
  rows: {
    teamId: string;
    name: string;
    isMine: boolean;
    totalPoints: number;
    weeklyAverage: number;
    highWeek: number | null;
    gapToLeader: number;
    weeklyHighs: number;
    firstOdds: number;
    topThreeOdds: number;
    topNOdds: number | null;
    rank: number;
    gapHistory: { week: number; gap: number }[];
  }[];
  topN: number | null;
  showWeeklyHighs: boolean;
}) {
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-muted-foreground">
        <tr>
          <th className="py-2">#</th>
          <th className="py-2">Team</th>
          <th className="py-2">Total</th>
          <th className="py-2">Avg</th>
          <th className="py-2">High week</th>
          <th className="py-2">Behind</th>
          {showWeeklyHighs && <th className="py-2">Weekly highs</th>}
          <th className="py-2">1st</th>
          <th className="py-2">Top 3</th>
          {topN ? <th className="py-2">Top {topN}</th> : null}
          <th className="py-2">Gap trend</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((t) => (
          <tr key={t.teamId} className={`border-t border-border ${t.isMine ? "bg-primary/5 font-semibold" : ""}`}>
            <td className="stat-num py-3">{t.rank}</td>
            <td className="py-3">{t.name}</td>
            <td className="stat-num py-3">{t.totalPoints.toFixed(1)}</td>
            <td className="stat-num py-3">{t.weeklyAverage.toFixed(1)}</td>
            <td className="stat-num py-3">{t.highWeek === null ? "—" : t.highWeek.toFixed(1)}</td>
            <td className="stat-num py-3">{t.gapToLeader === 0 ? "—" : t.gapToLeader.toFixed(1)}</td>
            {showWeeklyHighs && <td className="stat-num py-3">{t.weeklyHighs}</td>}
            <td className="stat-num py-3 text-primary">{pct(t.firstOdds)}</td>
            <td className="stat-num py-3">{pct(t.topThreeOdds)}</td>
            {topN ? <td className="stat-num py-3">{pct(t.topNOdds ?? 0)}</td> : null}
            <td className="py-3">
              {t.gapHistory.length > 1 ? (
                <MiniSparkline points={t.gapHistory.map((g) => -g.gap)} />
              ) : (
                <span className="text-xs text-muted-foreground">—</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function StandingsTable({
  leagueId,
  standings,
  showWeeklyHighs,
}: {
  leagueId: string;
  showWeeklyHighs?: boolean;
  standings: {
    id: string;
    name: string;
    isMine: boolean;
    record: string;
    pointsFor: number;
    playoffOdds: number;
    titleOdds: number;
    weeklyHighs?: number;
    badge?: TeamBadgeValue;
  }[];
}) {
  const load = useServerFn(getTrendsFn);
  const { data: trends } = useQuery({
    queryKey: ["trends", leagueId],
    queryFn: () => load({ data: { leagueId } }),
    refetchOnWindowFocus: false,
  });

  const teamTrends = new Map(trends?.series?.map((s) => [s.teamId, s.points]) ?? []);

  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-muted-foreground">
        <tr>
          <th className="py-2">Team</th>
          <th className="py-2">Record</th>
          <th className="py-2">Points</th>
          {showWeeklyHighs && <th className="py-2">Weekly highs</th>}
          <th className="py-2">Playoffs</th>
          <th className="py-2">Title</th>
          <th className="py-2">Trend</th>
        </tr>
      </thead>
      <tbody>
        {standings.map((t) => {
          const points = teamTrends.get(t.id) ?? [];
          const start = points[0]?.titleOdds ?? t.titleOdds;
          const end = points[points.length - 1]?.titleOdds ?? t.titleOdds;
          const up = end >= start;
          return (
            <tr key={t.id} className={`border-t border-border ${t.isMine ? "bg-primary/5 font-semibold" : ""}`}>
              <td className="py-3">
                <span className="flex flex-wrap items-center gap-2">
                  {t.name}
                  <TeamBadge badge={t.badge} />
                </span>
              </td>
              <td className="stat-num py-3">{t.record}</td>
              <td className="stat-num py-3">{t.pointsFor.toFixed(1)}</td>
              {showWeeklyHighs && <td className="stat-num py-3">{t.weeklyHighs ?? 0}</td>}
              <td className="stat-num py-3">{pct(t.playoffOdds)}</td>
              <td className="stat-num py-3 text-primary">{pct(t.titleOdds)}</td>
              <td className="py-3">
                {points.length > 1 ? (
                  <div className="flex items-center gap-1">
                    {up ? <ChevronUp className="size-4 text-primary" /> : <ChevronDown className="size-4 text-destructive" />}
                    <MiniSparkline points={points.map((p) => p.titleOdds)} />
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function MiniSparkline({ points }: { points: number[] }) {
  const width = 60;
  const height = 20;
  const max = Math.max(...points, 0.01);
  const min = Math.min(...points, 0);
  const xFor = (i: number) => (i / Math.max(points.length - 1, 1)) * width;
  const yFor = (v: number) => height - ((v - min) / Math.max(max - min, 0.001)) * height;
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"} ${xFor(i)} ${yFor(p)}`).join(" ");
  return (
    <svg width={width} height={height} className="text-primary">
      <path d={d} fill="none" stroke="currentColor" strokeWidth={2} />
    </svg>
  );
}

function MoveCard({
  leagueId,
  suggestion,
  onApplied,
}: {
  leagueId: string;
  suggestion: {
    id: string;
    kind: string;
    headline: string;
    detail: string;
    titleDelta: number;
    playoffDelta: number;
    pointsDelta: number;
    addName?: string;
    dropName?: string;
    strategyLabel?: string;
    rationale?: string;
    dynastyDelta?: number;
    acceptance?: number;
    acceptanceBand?: string;
    acceptanceReason?: string;
    partnerPointsDelta?: number;

  };
  onApplied: () => void;
}) {
  const apply = useServerFn(applyMoveFn);
  const mutation = useMutation({
    mutationFn: () =>
      apply({
        data: {
          leagueId,
          kind: suggestion.kind === "waiver_add" ? "waiver" : "start-sit",
          addName: suggestion.addName ?? "",
          dropName: suggestion.dropName,
        },
      }),
    onSuccess: () => {
      toast.success("Move applied");
      onApplied();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not apply move."),
  });

  const canApply =
    (suggestion.kind === "waiver_add" || suggestion.kind === "start_sit") &&
    suggestion.addName;

  return (
    <article className="rounded-xl bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">
              {suggestion.kind.replace(/_/g, " ")}
            </Badge>
            {suggestion.strategyLabel && (
              <Badge variant="outline">
                {suggestion.strategyLabel}
              </Badge>
            )}
            {suggestion.dynastyDelta != null && suggestion.dynastyDelta !== 0 && (
              <Badge variant={suggestion.dynastyDelta > 0 ? "default" : "secondary"}>
                {suggestion.dynastyDelta > 0 ? "+" : ""}
                {suggestion.dynastyDelta.toLocaleString()} future value
              </Badge>
            )}
          </div>
          <h3 className="mt-2 text-xl font-semibold">{suggestion.headline}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{suggestion.detail}</p>
          {suggestion.acceptanceBand && (
            <p className="mt-1 text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">
                {suggestion.acceptanceBand}
                {suggestion.acceptance != null
                  ? ` (${Math.round(suggestion.acceptance * 100)}%)`
                  : ""}{" "}
                they accept
              </span>
              {suggestion.partnerPointsDelta != null && (
                <>
                  {" "}
                  · their lineup {suggestion.partnerPointsDelta >= 0 ? "+" : ""}
                  {suggestion.partnerPointsDelta.toFixed(1)} pts/week
                </>
              )}
            </p>
          )}
          {suggestion.rationale && (
            <p className="mt-1 text-xs text-muted-foreground">{suggestion.rationale}</p>
          )}
        </div>
        <div className="text-right">
          <p className="eyebrow text-muted-foreground">Title odds</p>

          <p
            className={`stat-num text-2xl ${suggestion.titleDelta >= 0 ? "text-primary" : "text-destructive"}`}
          >
            {signed(suggestion.titleDelta)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Playoffs {signed(suggestion.playoffDelta)} · {suggestion.pointsDelta >= 0 ? "+" : ""}
            {suggestion.pointsDelta.toFixed(1)} proj pts
          </p>
        </div>
      </div>
      {canApply && (
        <div className="mt-4">
          <Button size="sm" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            Apply this move
          </Button>
        </div>
      )}
    </article>
  );
}

function SetBestLineupButton({ leagueId, onApplied }: { leagueId: string; onApplied: () => void }) {
  const setBest = useServerFn(setBestLineupFn);
  const mutation = useMutation({
    mutationFn: () => setBest({ data: { leagueId } }),
    onSuccess: () => {
      toast.success("Best lineup set");
      onApplied();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not set lineup."),
  });

  return (
    <Button size="sm" variant="outline" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
      {mutation.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
      Set best lineup
    </Button>
  );
}

function PlayoffPanel({ leagueId }: { leagueId: string }) {
  const load = useServerFn(getPlayoffPictureFn);
  const { data, isLoading } = useQuery({
    queryKey: ["playoff", leagueId],
    queryFn: () => load({ data: { leagueId } }),
    refetchOnWindowFocus: false,
  });

  if (isLoading) return <Skeleton className="h-64 w-full rounded-xl" />;
  if (!data) return <p className="text-sm text-muted-foreground">Could not load playoff picture.</p>;

  return (
    <div className="space-y-6">
      {data.myScenario && (
        <section className="rounded-xl bg-card p-5">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Trophy className="size-5 text-primary" />
            Your playoff path
          </h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatBox label="Clinch playoffs" value={`${data.myScenario.clinchPlayoffRecord?.toFixed(1) ?? "—"} wins`} />
            <StatBox label="Clinch bye" value={`${data.myScenario.clinchByeRecord?.toFixed(1) ?? "—"} wins`} />
            <StatBox label="Elimination risk" value={`${data.myScenario.eliminationRecord?.toFixed(1) ?? "—"} wins`} />
            <StatBox label="Magic number" value={data.myScenario.magicNumberPlayoff?.toFixed(1) ?? "—"} />
          </div>
        </section>
      )}

      <section className="rounded-xl bg-card p-5">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <Shield className="size-5 text-primary" />
          Projected seeds
        </h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-2">Seed</th>
                <th className="py-2">Team</th>
                <th className="py-2">Proj wins</th>
                <th className="py-2">Playoffs</th>
                <th className="py-2">Title</th>
              </tr>
            </thead>
            <tbody>
              {data.seeds.map((s) => (
                <tr key={s.teamId} className={`border-t border-border ${s.isMine ? "bg-primary/5 font-semibold" : ""}`}>
                  <td className="py-3">{s.seed}</td>
                  <td className="py-3">{s.name}</td>
                  <td className="stat-num py-3">{s.projWins.toFixed(1)}</td>
                  <td className="stat-num py-3">{pct(s.playoffOdds)}</td>
                  <td className="stat-num py-3 text-primary">{pct(s.titleOdds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {!!data.rootingInterests?.length && (
        <section className="rounded-xl bg-card p-5">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Users className="size-5 text-primary" />
            Rooting interests
          </h2>
          <ul className="mt-4 space-y-2">
            {data.rootingInterests.map((r, i) => (
              <li key={i} className="text-sm">
                <span className="font-medium">
                  {r.rootFor === "home" ? r.homeName : r.rootFor === "away" ? r.awayName : "Either side"}
                </span>
                <span className="text-muted-foreground"> — {r.reason}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-background/50 p-4">
      <p className="eyebrow text-xs text-muted-foreground">{label}</p>
      <p className="stat-num mt-1 text-xl">{value}</p>
    </div>
  );
}

function TrendsPanel({ leagueId }: { leagueId: string }) {
  const load = useServerFn(getTrendsFn);
  const { data, isLoading } = useQuery({
    queryKey: ["trends", leagueId],
    queryFn: () => load({ data: { leagueId } }),
    refetchOnWindowFocus: false,
  });

  if (isLoading) return <Skeleton className="h-64 w-full rounded-xl" />;
  if (!data?.series?.length) return <p className="text-sm text-muted-foreground">No trend data yet. Snapshots are saved each time you refresh the league page.</p>;

  const width = 600;
  const height = 240;
  const padding = 40;
  const allOdds = data.series.flatMap((s) => s.points.map((p) => p.titleOdds));
  const maxOdds = Math.max(...allOdds, 0.01);
  const minWeek = Math.min(...data.weeks);
  const maxWeek = Math.max(...data.weeks);

  const xFor = (week: number) =>
    padding + ((week - minWeek) / Math.max(maxWeek - minWeek, 1)) * (width - padding * 2);
  const yFor = (odds: number) => height - padding - (odds / maxOdds) * (height - padding * 2);

  const TEAM_COLORS = ["text-primary", "text-chart-2", "text-chart-3", "text-chart-4", "text-chart-5"];
  const colorFor = (i: number) => TEAM_COLORS[i % TEAM_COLORS.length];

  return (
    <section className="rounded-xl bg-card p-5">
      <h2 className="text-lg font-bold">Title odds over time</h2>
      <p className="text-xs text-muted-foreground">Tracked each week when you load this league.</p>
      <svg viewBox={`0 0 ${width} ${height}`} className="mt-4 w-full">
        {data.weeks.map((w) => (
          <line
            key={w}
            x1={xFor(w)}
            y1={padding}
            x2={xFor(w)}
            y2={height - padding}
            stroke="currentColor"
            className="text-border"
            strokeDasharray="2 2"
          />
        ))}
        <text x={padding} y={height - 10} className="text-[10px] fill-muted-foreground">
          Week {minWeek}
        </text>
        <text x={width - padding - 30} y={height - 10} className="text-[10px] fill-muted-foreground">
          Week {maxWeek}
        </text>
        {data.series.map((s, i) => {
          const d = s.points.map((p, idx) => `${idx === 0 ? "M" : "L"} ${xFor(p.week)} ${yFor(p.titleOdds)}`).join(" ");
          const color = colorFor(i);
          return (
            <g key={s.teamId}>
              <path d={d} fill="none" stroke="currentColor" strokeWidth={s.isMine ? 3 : 2} className={color} />
              {s.points.map((p) => (
                <circle key={p.week} cx={xFor(p.week)} cy={yFor(p.titleOdds)} r={s.isMine ? 4 : 3} className={`fill-current ${color}`} />
              ))}
            </g>
          );
        })}
      </svg>
      <div className="mt-4 flex flex-wrap gap-3">
        {data.series.map((s, i) => {
          const start = s.points[0]?.titleOdds ?? 0;
          const end = s.points[s.points.length - 1]?.titleOdds ?? 0;
          const up = end >= start;
          return (
            <div key={s.teamId} className="flex items-center gap-2 text-sm">
              <span className={`inline-block size-2 rounded-full bg-current ${colorFor(i)}`} />
              <span className={s.isMine ? "font-semibold" : ""}>{s.name}</span>
              {up ? <ChevronUp className="size-3 text-primary" /> : <ChevronDown className="size-3 text-destructive" />}
              <span className="text-xs text-muted-foreground">{pct(end)}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function DraftPanel({ leagueId }: { leagueId: string }) {
  const load = useServerFn(getDraftRecapFn);
  const importDraft = useServerFn(importSleeperDraftFn);
  const [sleeperId, setSleeperId] = useState("");
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["draft", leagueId],
    queryFn: () => load({ data: { leagueId } }),
    refetchOnWindowFocus: false,
  });
  const importMutation = useMutation({
    mutationFn: () => importDraft({ data: { leagueId, sleeperLeagueId: sleeperId } }),
    onSuccess: () => {
      toast.success("Draft imported");
      refetch();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not import draft."),
  });

  if (isLoading) return <Skeleton className="h-64 w-full rounded-xl" />;

  return (
    <div className="space-y-6">
      {!data?.picks?.length && (
        <section className="rounded-xl bg-card p-5">
          <h2 className="text-lg font-bold">Import draft results</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            For Sleeper leagues, paste the Sleeper league ID to pull the full draft board.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Input
              value={sleeperId}
              onChange={(e) => setSleeperId(e.target.value)}
              placeholder="Sleeper league ID"
              className="w-full sm:w-64"
            />
            <Button disabled={!sleeperId || importMutation.isPending} onClick={() => importMutation.mutate()}>
              {importMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : "Import"}
            </Button>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            For other platforms, upload a screenshot of your draft board on the Connect page and it will be graded here.
          </p>
        </section>
      )}

      {!!data?.grades?.length && (
        <section className="rounded-xl bg-card p-5">
          <h2 className="text-lg font-bold">Draft grades</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.grades.map((g) => (
              <div key={g.teamId} className={`rounded-lg border border-border p-4 ${g.isMine ? "bg-primary/5" : ""}`}>
                <div className="flex items-center justify-between">
                  <p className={`font-semibold ${g.isMine ? "text-primary" : ""}`}>{g.teamName}</p>
                  <p className="stat-num text-2xl">{g.grade}</p>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Best: {g.bestPick.player_name} · Worst: {g.worstPick.player_name}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {!!data?.picks?.length && (
        <section className="rounded-xl bg-card p-5">
          <h2 className="text-lg font-bold">Draft board</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-2">Pick</th>
                  <th className="py-2">Team</th>
                  <th className="py-2">Player</th>
                  <th className="py-2">Pos</th>
                  <th className="py-2">Proj</th>
                </tr>
              </thead>
              <tbody>
                {data.picks.map((p) => (
                  <tr key={p.pick_number} className={`border-t border-border ${p.isMine ? "bg-primary/5 font-semibold" : ""}`}>
                    <td className="py-2">{p.pick_number}</td>
                    <td className="py-2">{p.teamName}</td>
                    <td className="py-2">{p.player_name}</td>
                    <td className="py-2">{p.position}</td>
                    <td className="stat-num py-2">{Number(p.proj_points_season).toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function Stat({ label, before, after }: { label: string; before: string; after: string }) {
  return (
    <div>
      <p className="eyebrow text-muted-foreground">{label}</p>
      <p className="stat-num mt-1 text-xl">
        <span className="text-muted-foreground">{before}</span>
        <span className="mx-2 text-muted-foreground">→</span>
        <span className="text-primary">{after}</span>
      </p>
    </div>
  );
}

/** How the league is won, and whether it pays a weekly top-scorer bonus. */
function ContestSettings({
  leagueId,
  contestFormat,
  pointsPlayoff,
  weeklyHighBonus,
  weeklyHighLabel,
}: {
  leagueId: string;
  contestFormat: "h2h" | "points" | "hybrid";
  pointsPlayoff: { teams: number | null; afterWeek: number | null };
  weeklyHighBonus: boolean;
  weeklyHighLabel: string | null;
}) {
  const save = useServerFn(updateLeagueSettings);
  const queryClient = useQueryClient();
  const [label, setLabel] = useState(weeklyHighLabel ?? "");

  const mutation = useMutation({
    mutationFn: (patch: Record<string, unknown>) => save({ data: { leagueId, ...patch } as never }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["analysis", leagueId] });
      queryClient.invalidateQueries({ queryKey: ["gameday"] });
      toast.success("League rules updated");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save that"),
  });

  return (
    <div className="space-y-4 rounded-xl bg-card p-5">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm text-muted-foreground" htmlFor="contest-format">
          How the league is won
        </label>
        <select
          id="contest-format"
          value={contestFormat}
          disabled={mutation.isPending}
          onChange={(e) => mutation.mutate({ contestFormat: e.target.value })}
          className="rounded-lg border border-border bg-transparent px-3 py-1.5 text-sm"
        >
          {CONTEST_FORMATS.map((key) => (
            <option key={key} value={key}>
              {CONTEST_LABELS[key]}
            </option>
          ))}
        </select>
        <span className="text-xs text-muted-foreground">{CONTEST_DESCRIPTIONS[contestFormat]}</span>
      </div>

      {contestFormat !== "h2h" && (
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm text-muted-foreground" htmlFor="points-playoff">
            Points playoffs
          </label>
          <input
            id="points-playoff"
            type="number"
            min={0}
            max={32}
            defaultValue={pointsPlayoff.teams ?? 0}
            disabled={mutation.isPending}
            onBlur={(e) => mutation.mutate({ pointsPlayoffTeams: Number(e.target.value) || 0 })}
            className="w-20 rounded-lg border border-border bg-transparent px-3 py-1.5 text-sm"
          />
          <span className="text-xs text-muted-foreground">teams qualify (0 = no playoffs), after week</span>
          <input
            aria-label="Qualifying week"
            type="number"
            min={1}
            max={18}
            defaultValue={pointsPlayoff.afterWeek ?? ""}
            disabled={mutation.isPending}
            onBlur={(e) =>
              mutation.mutate({ pointsPlayoffWeek: e.target.value ? Number(e.target.value) : null })
            }
            className="w-20 rounded-lg border border-border bg-transparent px-3 py-1.5 text-sm"
          />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={weeklyHighBonus}
            disabled={mutation.isPending}
            onChange={(e) => mutation.mutate({ weeklyHighBonus: e.target.checked })}
          />
          Weekly high bonus
        </label>
        <input
          aria-label="Weekly high payout"
          placeholder="e.g. $20"
          value={label}
          disabled={mutation.isPending || !weeklyHighBonus}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={() => mutation.mutate({ weeklyHighLabel: label })}
          className="w-28 rounded-lg border border-border bg-transparent px-3 py-1.5 text-sm"
        />
      </div>
    </div>
  );
}

/** Which projection set this league's numbers come from. */
function ProjectionSourcePicker({
  leagueId,
  platform,
  current,
  label,
}: {
  leagueId: string;
  platform: string;
  current: string;
  label: string;
}) {
  const save = useServerFn(updateLeagueSettings);
  const queryClient = useQueryClient();
  const platformName = platform.toLowerCase() === "espn" ? "ESPN" : "Sleeper";
  const canUsePlatform = ["sleeper", "espn"].includes(platform.toLowerCase());

  const mutation = useMutation({
    mutationFn: (projectionSource: "platform" | "app" | "user") =>
      save({ data: { leagueId, projectionSource } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["analysis", leagueId] });
      queryClient.invalidateQueries({ queryKey: ["gameday"] });
      toast.success("Projection source updated");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save that"),
  });

  return (
    <select
      aria-label="Projection source"
      value={current}
      disabled={mutation.isPending}
      onChange={(e) => mutation.mutate(e.target.value as "platform" | "app" | "user")}
      className="rounded-full border border-border bg-transparent px-2 py-[2px] text-[10px] text-muted-foreground"
      title={label}
    >
      {canUsePlatform && <option value="platform">{platformName} projections</option>}
      <option value="app">App projections</option>
      <option value="user">My projections</option>
    </select>
  );
}

function LeagueColorPicker({ leagueId, current }: { leagueId: string; current: string | null }) {
  const save = useServerFn(updateLeagueSettings);
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(current);

  const mutation = useMutation({
    mutationFn: (color: string) => save({ data: { leagueId, color } }),
    onSuccess: (_r, color) => {
      setValue(color);
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ["analysis", leagueId] });
      queryClient.invalidateQueries({ queryKey: ["gameday"] });
      toast.success("League color updated");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save the color"),
  });

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Change league color"
        onClick={() => setOpen((o) => !o)}
        className="size-5 rounded-full ring-2 ring-border"
        style={{ backgroundColor: leagueColor(value, leagueId) }}
      />
      {open && (
        <div className="absolute left-0 top-7 z-30 flex gap-2 rounded-lg bg-popover p-2 shadow-lg">
          {LEAGUE_COLOR_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              title={LEAGUE_COLOR_LABELS[key]}
              aria-label={LEAGUE_COLOR_LABELS[key]}
              disabled={mutation.isPending}
              onClick={() => mutation.mutate(key)}
              className={`size-5 rounded-full ${value === key ? "ring-2 ring-foreground" : "ring-1 ring-border"}`}
              style={{ backgroundColor: leagueColor(key) }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
