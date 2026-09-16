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
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { CacheStatus } from "@/components/CacheStatus";
import { DraftPicksPanel } from "@/components/DraftPicksPanel";
import { useCachedQuery } from "@/hooks/useCachedQuery";
import type { TeamBadge as TeamBadgeValue } from "@/lib/fantasy/team-class";
import { TeamBadge } from "@/components/TeamBadge";
import { TradeBuilder } from "@/components/TradeBuilder";
import { TrajectoryChip } from "@/components/TrajectoryChip";
import type { Trajectory as PlayerTrajectory } from "@/lib/fantasy/age-curve";
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
  getLeagueMeta,
  getPlayoffPictureFn,
  getScoringGapFn,
  getTrendsFn,
  getWaiverBoard,
  importSleeperDraftFn,
  logRecommendationActionFn,
  logRecommendationsShownFn,
  setBestLineupFn,
  updateFaab,
  updateLeagueSettings,

} from "@/lib/fantasy.functions";
import {
  listPlayerConstraintsFn,
  setPlayerConstraintFn,
  setTeamClassOverrideFn,
} from "@/lib/constraints.functions";
import { normalizeName } from "@/lib/fantasy/names";
import { logTrade } from "@/lib/platforms.functions";
import { LEAGUE_COLOR_KEYS, LEAGUE_COLOR_LABELS, leagueColor } from "@/lib/league-colors";
import { rankWaivers } from "@/lib/fantasy/waiver-rank";
import { isStreamedPosition } from "@/lib/fantasy/slot-fill";
import type { SlotFill, StreamSuggestion } from "@/lib/fantasy/slot-fill";
import {
  CONTEST_DESCRIPTIONS,
  CONTEST_FORMATS,
  CONTEST_LABELS,
  type ContestFormat,
} from "@/lib/fantasy/contest";
import {
  LEAGUE_TYPES,
  LEAGUE_TYPE_LABELS,
  LEAGUE_VARIANTS,
  LEAGUE_VARIANT_LABELS,
  type LeagueType,
  type LeagueVariant,
} from "@/lib/fantasy/league-type";

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
            <LeagueTypeBadge
              leagueId={leagueId}
              leagueType={data.leagueType}
              variant={data.variant}
            />
            <ProjectionSourcePicker
              leagueId={leagueId}
              platform={data.league.platform}
              current={data.league.projection_source}
              label={data.projectionLabel}
            />
            <ScheduleStrengthToggle
              leagueId={leagueId}
              on={data.sosAdjust}
              active={data.sosActive}
            />
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => recompute.mutate()} disabled={recompute.isPending || isFetching}>
            {recompute.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            Recompute
          </Button>
          <Button variant="outline" onClick={() => hardRefresh()} disabled={isFetching}>
            {isFetching ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            Refresh
          </Button>
        </div>

      </div>

      <ScoringGapBanner leagueId={leagueId} />

      {data.classLine && (
        <section className="mt-6 rounded-xl bg-card p-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{data.classLine.label}</Badge>
            <Badge variant="secondary">{data.classLine.badge}</Badge>
            {data.classLine.numbers.map((n) => (
              <span key={n} className="stat-num text-sm text-muted-foreground">
                {n}
              </span>
            ))}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{data.classLine.reason}</p>
          <ClassOverride
            leagueId={leagueId}
            current={data.classLine.override}
            onSaved={() => hardRefresh()}
          />
          <Link to="/how-advice-works" className="mt-2 inline-block text-xs text-muted-foreground underline">
            How advice works
          </Link>
        </section>
      )}

      {data.typeSource === "inferred" && (
        <LeagueTypePrompt
          leagueId={leagueId}
          leagueType={data.leagueType}
          variant={data.variant}
          sourceLabel={data.typeSourceLabel}
        />
      )}

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

      {data.showSurvival && !!data.survival?.length && (
        <p className="mt-3 text-sm text-muted-foreground">
          Weekly cut:{" "}
          <span className="font-medium text-foreground">
            {[...data.survival].sort((a, b) => a.surviveWeekOdds - b.surviveWeekOdds)[0]!.name}
          </span>{" "}
          is most likely to go out this week.
        </p>
      )}

      {data.league.sync_paused && (
        <div className="mt-6 flex items-start gap-3 rounded-xl border border-l-4 border-border border-l-destructive bg-card p-4">
          <AlertTriangle className="mt-0.5 size-4 text-destructive" />
          <div>
            <p className="text-sm font-medium">Sync paused — update manually</p>
            <p className="text-xs text-muted-foreground">
              We couldn't read this league from the platform, so what you see is the last good copy.
              {data.league.last_sync_error ? ` (${data.league.last_sync_error})` : ""}
            </p>
          </div>
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
          <ShownLogger
            leagueId={leagueId}
            teamId={data.myTeam?.id ?? null}
            week={data.league.current_week}
            teamClass={data.teamClass ?? "middle"}
            suggestions={data.suggestions ?? []}
          />
          {!data.suggestions.length && (
            <p className="text-sm text-muted-foreground">
              No moves worth making right now — your lineup is already the strongest one available.
            </p>
          )}
          {data.suggestions.map((s) => (
            <MoveCard
              key={s.id}
              leagueId={leagueId}
              week={data.league.current_week}
              teamId={data.myTeam?.id ?? null}
              teamClass={data.teamClass ?? "middle"}
              suggestion={s}
              onApplied={() => refetch()}
            />
          ))}

          {!!data.buySell?.length && (
            <Section title="Buy and sell">
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Where the market price and the actual production disagree at each position.
                </p>
                {data.buySell.map((row) => (
                  <div
                    key={`${row.name}-${row.position}`}
                    className="flex items-center justify-between gap-3 rounded-xl bg-card p-4"
                  >
                    <div>
                      <p className="text-sm font-medium">
                        {row.name}{" "}
                        <span className="text-xs text-muted-foreground">
                          {row.position}
                          {row.nflTeam ? ` · ${row.nflTeam}` : ""}
                        </span>
                      </p>
                      <p className="text-xs text-muted-foreground">{row.reason}</p>
                    </div>
                    <Badge variant={row.side === "buy" ? "default" : "secondary"}>
                      {row.side === "buy" ? "Buy" : "Sell"}
                    </Badge>
                  </div>
                ))}
              </div>
            </Section>
          )}

          <Section title="Waiver wire">
            <WaiverPanel leagueId={leagueId} eligible={data?.eligiblePositions ?? null} onAdded={() => refetch()} />
          </Section>

          <Section title="Trades">
            <div className="space-y-6">
              <TradeBuilder leagueId={leagueId} />
              <TradePanel leagueId={leagueId} />
              {data.showPickValues && <DraftPicksPanel leagueId={leagueId} />}
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
          {data.startSitLine ? (
            <p className="text-sm text-muted-foreground">{data.startSitLine}</p>
          ) : null}
          <PlayerTags
            leagueId={leagueId}
            names={[...data.lineup.map((p) => p.name), ...data.bench.map((p) => p.name)]}
          />
        </TabsContent>

        <TabsContent value="league" className="mt-6 space-y-6">
          {data.contestFormat !== "points" && (
            <Section title="Standings">
              <div className="overflow-x-auto">
                <StandingsTable
                  leagueId={leagueId}
                  standings={data.standings}
                  showWeeklyHighs={data.weeklyHighBonus}
                  showVictoryPoints={data.contestFormat === "vp"}
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
              leagueType={data.leagueType}
              variant={data.variant}
              typeSourceLabel={data.typeSourceLabel}
            />
          </Section>

          {data.showPickValues && data.valuesPending && (
            <Section title="Long-term value">
              <div className="rounded-xl bg-card p-5">
                <p className="text-sm text-muted-foreground">Loading market values…</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Fetching the dynasty market for this league. Values appear here shortly.
                </p>
              </div>
            </Section>
          )}

          {data.showPickValues && !data.valuesPending && !!data.dynasty?.length && (
            <Section title="Long-term value">
              <div className="rounded-xl bg-card p-5">
                <p className="text-xs text-muted-foreground">
                  Age curve and future value for everyone on your roster.
                </p>
                {data.dynasty.filter((r) => r.ageSource === "unknown").length > 0 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {data.dynasty.filter((r) => r.ageSource === "unknown").length} players with
                    unknown age —{" "}
                    <Link to="/admin" className="underline">
                      review unmatched names
                    </Link>
                    .
                  </p>
                )}
                {data.dynastyOutlook && (
                  <div className="mt-3 rounded-lg bg-secondary p-3 text-xs">
                    <p>
                      <span className="stat-num text-foreground">
                        {Math.round(data.dynastyOutlook.pastPeakShare * 100)}%
                      </span>{" "}
                      of your value is in players at or past their position peak ·{" "}
                      {data.dynastyOutlook.contentionWindow}
                    </p>
                    {data.dynastyOutlook.sellSoon.length > 0 && (
                      <p className="mt-1 text-muted-foreground">
                        Sell soon:{" "}
                        {data.dynastyOutlook.sellSoon
                          .map((s) => `${s.name} (${Math.round(s.change1 * 100)}% in a year)`)
                          .join(", ")}
                      </p>
                    )}
                  </div>
                )}
                <ul className="mt-3 space-y-1">
                  {data.dynasty.map((row) => (
                    <li
                      key={`${row.name}-${row.position}`}
                      className="flex items-center justify-between border-t border-border py-2 text-sm"
                    >
                      <span className="flex items-center gap-2">
                        <span className="eyebrow text-muted-foreground">{row.position}</span>
                        <span className="font-medium">{row.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {row.age ? `${row.age} yrs` : "age unknown"}
                        </span>
                        <TrajectoryChip trajectory={row.trajectory} playerName={row.name} />
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Future <span className="stat-num text-foreground">{row.longTermValue}</span>{" "}
                        · Overall{" "}
                        <span className="stat-num text-foreground">{row.blendedValue}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </Section>
          )}

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
  players: { name: string; position: string; slot?: string; proj: number; status?: string; nflTeam?: string | null; byeWeek?: number | null; trajectory?: PlayerTrajectory | null }[];
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
              <TrajectoryChip trajectory={p.trajectory} playerName={p.name} />
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
  { id: "impact", label: "Impact" },
  { id: "points", label: "Points" },
  { id: "value", label: "Trade value" },
  { id: "ktc", label: "Market value" },
  { id: "gems", label: "Undervalued" },
  { id: "bid", label: "Bid" },
] as const;

/**
 * Empty starting spots, and the one kicker / defence swap worth making. Built
 * from the league's own slot list, so a position the league never starts can
 * never show up here.
 */
function FillStrip({
  fills,
  stream,
  survival,
  onAdd,
  busy,
}: {
  fills: SlotFill[];
  stream: StreamSuggestion | null;
  survival: boolean;
  onAdd: (name: string, drop: string | null) => void;
  busy: boolean;
}) {
  if (!fills.length && !stream) return null;
  return (
    <div className="mt-4 rounded-xl border border-border p-4">
      <h3 className="text-sm font-bold">Fill empty slots</h3>
      <ul className="mt-2 space-y-2">
        {fills.map((fill) => (
          <li key={fill.slot + fill.playerId} className="flex flex-wrap items-center gap-3">
            <span className="eyebrow text-muted-foreground">{fill.slot}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">
                {fill.name}
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {fill.nflTeam ?? "FA"} · {fill.reason}
                </span>
              </p>
              <p className="text-xs text-muted-foreground">
                <span className="stat-num text-foreground">{fill.projWeek.toFixed(1)}</span> pts/wk
                {fill.pointsGain > 0 && (
                  <>
                    {" · lineup +"}
                    <span className="stat-num text-foreground">{fill.pointsGain.toFixed(1)}</span>
                  </>
                )}
                {survival && fill.survivalDelta !== null && (
                  <span className={fill.survivalDelta > 0 ? " text-primary" : ""}>
                    {" · survival "}
                    {fill.survivalDelta > 0 ? "+" : ""}
                    {(fill.survivalDelta * 100).toFixed(1)}%
                  </span>
                )}
                {fill.ruleNote ? ` · ${fill.ruleNote}` : ""}
              </p>
            </div>
            <span className="rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground">
              Bid <span className="stat-num">${fill.bid}</span>
              {fill.minimumBid ? " min" : ""}
            </span>
            <Button size="sm" disabled={busy} onClick={() => onAdd(fill.name, null)}>
              Add
            </Button>
          </li>
        ))}
      </ul>

      {stream && (
        <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-border pt-3">
          <span className="eyebrow text-muted-foreground">Stream {stream.position}</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              {stream.inName} for {stream.outName}
            </p>
            <p className="text-xs text-muted-foreground">{stream.reason}</p>
          </div>
          <span className="rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground">
            Bid <span className="stat-num">${stream.bid}</span> min
          </span>
          <Button size="sm" disabled={busy} onClick={() => onAdd(stream.inName, stream.outName)}>
            Swap
          </Button>
        </div>
      )}
    </div>
  );
}

function WaiverPanel({
  leagueId,
  eligible,
  onAdded,
}: {
  leagueId: string;
  eligible?: string[] | null;
  onAdded?: () => void;
}) {
  // Only offer chips for positions this league can actually start. Kickers and
  // defences live in the fill strip, never the list.
  const positions = (
    eligible?.length ? ["ALL", ...POSITIONS.filter((p) => p !== "ALL" && eligible.includes(p))] : POSITIONS
  ).filter((p) => !isStreamedPosition(p));
  const load = useServerFn(getWaiverBoard);
  const add = useServerFn(applyMoveFn);
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [position, setPosition] = useState("ALL");
  const [sort, setSort] = useState<(typeof SORTS)[number]["id"]>("impact");
  const [showInjured, setShowInjured] = useState(false);

  const { data, isFetching } = useQuery({
    queryKey: ["waivers", leagueId, search, position, sort, showInjured],
    queryFn: () => load({ data: { leagueId, search, position, sort, showInjured } }),
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

  const rows = rankWaivers(data?.rows ?? [], {
    sort,
    survival: !!data?.isSurvivalLeague,
    showInjured: true,
    strategy: data?.strategy ?? null,
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
        {positions.map((p) => (
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
            {s.id === "impact" && data?.isSurvivalLeague ? "Survival impact" : s.label}
          </Button>
        ))}
        <Button
          size="sm"
          variant={showInjured ? "secondary" : "ghost"}
          onClick={() => setShowInjured((v) => !v)}
        >
          {showInjured ? "Hiding nobody" : "Show injured"}
        </Button>
      </div>

      {data && (
        <p className="mt-3 text-xs text-muted-foreground">
          {data.hasMyTeam
            ? `Roster ${data.rosterSize} of ${data.rosterLimit}.${rosterFull ? " Full — an add will drop the suggested player." : ""}`
            : "Mark one team as yours to see title impact and bids."}
          {data.estimatedRosterSpots
            ? " Some rival rosters are estimated, so this list is approximate."
            : ""}
          {` Projections: ${data.projectionLabel.toLowerCase()}.`}
        </p>
      )}

      {data?.faabPlan?.line && (
        <p className="mt-2 text-xs text-muted-foreground">
          {data.faabPlan.line}. Spend up to{" "}
          <span className="stat-num text-foreground">${data.faabPlan.spendableNow}</span> now.
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

      <FillStrip
        fills={data?.fills ?? []}
        stream={data?.stream ?? null}
        survival={!!data?.isSurvivalLeague}
        onAdd={(name, drop) => addMutation.mutate({ name, drop })}
        busy={addMutation.isPending}
      />



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
                  {p.fromCutTeam && (
                    <Badge variant="secondary" className="text-[10px]">
                      From cut team
                    </Badge>
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
                  {p.longTermValue !== null && (
                    <span>
                      Keep value{" "}
                      <span className="stat-num text-foreground">{p.longTermValue.toFixed(0)}</span>/100
                    </span>
                  )}
                  {p.survivalDelta !== null && (
                    <span className={p.survivalDelta > 0 ? "text-primary" : ""}>
                      Survival {p.survivalDelta > 0 ? "+" : ""}
                      {(p.survivalDelta * 100).toFixed(1)}%
                    </span>
                  )}
                  {p.titleDelta !== null && (
                    <span className={p.titleDelta > 0 ? "text-primary" : ""}>
                      Title {p.titleDelta > 0 ? "+" : ""}
                      {(p.titleDelta * 100).toFixed(1)}% · playoffs {(p.playoffDelta ?? 0) > 0 ? "+" : ""}
                      {((p.playoffDelta ?? 0) * 100).toFixed(1)}%
                    </span>
                  )}
                  {p.suggestedDrop && <span>Drop {p.suggestedDrop}</span>}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-md border border-border px-2 py-1">
                    Passive <span className="stat-num text-foreground">${p.bidRec.passive}</span>
                  </span>
                  <span className="rounded-md bg-primary px-2 py-1 text-primary-foreground">
                    Bid <span className="stat-num">${p.bidRec.recommended}</span>
                  </span>
                  <span className="rounded-md border border-border px-2 py-1">
                    Aggressive <span className="stat-num text-foreground">${p.bidRec.aggressive}</span>
                  </span>
                  <span className="text-muted-foreground">max ${p.bidRec.ceiling}</span>
                </div>
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
  showVictoryPoints,
}: {
  leagueId: string;
  showWeeklyHighs?: boolean;
  showVictoryPoints?: boolean;
  standings: {
    id: string;
    name: string;
    isMine: boolean;
    record: string;
    pointsFor: number;
    playoffOdds: number;
    titleOdds: number;
    weeklyHighs?: number;
    vp?: number;
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
          {showVictoryPoints && <th className="py-2">VP</th>}
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
              {showVictoryPoints && <td className="stat-num py-3">{(t.vp ?? 0).toFixed(0)}</td>}
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

/** Records the suggestions the manager was actually shown, once per week. */
function ShownLogger({
  leagueId,
  teamId,
  week,
  teamClass,
  suggestions,
}: {
  leagueId: string;
  teamId: string | null;
  week: number;
  teamClass: string;
  suggestions: {
    id: string;
    kind: string;
    headline: string;
    detail: string;
    titleDelta: number;
    playoffDelta: number;
    pointsDelta: number;
    addName?: string;
    dropName?: string;
    impactLabel?: string;
    impact?: { dynastyValueDelta: number; dynastyRankDelta: number };
  }[];
}) {
  const logShown = useServerFn(logRecommendationsShownFn);
  const sent = useRef("");

  useEffect(() => {
    if (!suggestions.length) return;
    const stamp = `${leagueId}:${week}:${suggestions.map((s) => s.id).join(",")}`;
    if (sent.current === stamp) return;
    sent.current = stamp;
    void logShown({
      data: {
        items: suggestions.slice(0, 50).map((s) => ({
          leagueId,
          teamId,
          week,
          surface: "league",
          kind: s.kind,
          recKey: s.id,
          headline: s.headline,
          detail: s.detail,
          addName: s.addName ?? null,
          dropName: s.dropName ?? null,
          pointsDelta: s.pointsDelta,
          titleDelta: s.titleDelta,
          playoffDelta: s.playoffDelta,
          dynastyValueDelta: s.impact?.dynastyValueDelta ?? 0,
          dynastyRankDelta: s.impact?.dynastyRankDelta ?? 0,
          teamClass,
          impactLabel: s.impactLabel ?? null,
        })),
      },
    }).catch(() => {});
  }, [leagueId, teamId, week, teamClass, suggestions, logShown]);

  return null;
}

function MoveCard({
  leagueId,
  week,
  teamId,
  teamClass,
  suggestion,
  onApplied,
}: {
  leagueId: string;
  week: number;
  teamId: string | null;
  teamClass: string;
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
    impactLabel?: string;
    ruleNote?: string | null;
    impact?: {
      titleDelta: number;
      playoffDelta: number;
      pointsDelta: number;
      dynastyValueDelta: number;
      dynastyRankDelta: number;
    };
  };
  onApplied: () => void;
}) {
  const apply = useServerFn(applyMoveFn);
  const logAction = useServerFn(logRecommendationActionFn);
  const [decision, setDecision] = useState<"taken" | "ignored" | "dismissed" | null>(null);

  const logPayload = {
    leagueId,
    teamId,
    week,
    surface: "league",
    kind: suggestion.kind,
    recKey: suggestion.id,
    headline: suggestion.headline,
    detail: suggestion.detail,
    addName: suggestion.addName ?? null,
    dropName: suggestion.dropName ?? null,
    pointsDelta: suggestion.pointsDelta,
    titleDelta: suggestion.titleDelta,
    playoffDelta: suggestion.playoffDelta,
    dynastyValueDelta: suggestion.impact?.dynastyValueDelta ?? 0,
    dynastyRankDelta: suggestion.impact?.dynastyRankDelta ?? 0,
    teamClass,
    impactLabel: suggestion.impactLabel ?? null,
  };

  const record = useMutation({
    mutationFn: (action: "taken" | "ignored" | "dismissed") =>
      logAction({ data: { item: logPayload, action } }),
    onSuccess: (_r, action) => setDecision(action),
  });
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
      record.mutate("taken");
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
          {suggestion.ruleNote ? (
            <p className="mt-1 text-xs text-muted-foreground">Rule: {suggestion.ruleNote}</p>
          ) : null}
        </div>
        <div className="text-right">
          <p className="eyebrow text-muted-foreground">Impact</p>
          {suggestion.impactLabel ? (
            <p className="stat-num text-lg text-muted-foreground">{suggestion.impactLabel}</p>
          ) : null}

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
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {canApply && (
          <Button size="sm" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            Apply this move
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={record.isPending}
          onClick={() => record.mutate("taken")}
        >
          I did this
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={record.isPending}
          onClick={() => record.mutate("ignored")}
        >
          Not for me
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={record.isPending}
          onClick={() => record.mutate("dismissed")}
        >
          Hide
        </Button>
        {decision && (
          <span className="text-xs text-muted-foreground">
            {decision === "taken"
              ? "Saved — we'll grade it in next week's recap."
              : decision === "ignored"
                ? "Noted — we'll tell you how it would have gone."
                : "Hidden."}
          </span>
        )}
      </div>
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

/** Two selects for the league type and its variant, editable at any time. */
function allowedVariants(type: LeagueType): LeagueVariant[] {
  return LEAGUE_VARIANTS.filter((v) => {
    if (v === "empire") return type === "dynasty";
    if (v === "guillotine") return type === "redraft";
    return true;
  });
}

/** Meta query shared by the selects and the header badge — no full recompute. */
function useLeagueMeta(leagueId: string) {
  const fetchMeta = useServerFn(getLeagueMeta);
  return useQuery({
    queryKey: ["league-meta", leagueId],
    queryFn: () => fetchMeta({ data: { leagueId } }),
    staleTime: 30_000,
  });
}

function LeagueTypeSelects({
  leagueId,
  leagueType,
  variant,
  sourceLabel,
  onSaved,
}: {
  leagueId: string;
  leagueType: LeagueType;
  variant: LeagueVariant;
  sourceLabel?: string;
  onSaved?: () => void;
}) {
  const save = useServerFn(updateLeagueSettings);
  const queryClient = useQueryClient();
  const meta = useLeagueMeta(leagueId);
  const [local, setLocal] = useState<{ leagueType: LeagueType; variant: LeagueVariant }>({
    leagueType,
    variant,
  });
  const [saving, setSaving] = useState(false);

  // Take server values only once a refetch has settled and no save is in flight.
  useEffect(() => {
    if (saving || meta.isFetching || !meta.data) return;
    setLocal({ leagueType: meta.data.leagueType, variant: meta.data.variant });
  }, [saving, meta.isFetching, meta.data]);

  const label = sourceLabel ?? meta.data?.typeSourceLabel;

  const mutation = useMutation({
    mutationFn: (next: { leagueType: LeagueType; variant: LeagueVariant }) =>
      save({ data: { leagueId, ...next, typeSource: "user" } as never }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["league-meta", leagueId] }),
        queryClient.invalidateQueries({ queryKey: ["analysis", leagueId] }),
        queryClient.invalidateQueries({ queryKey: ["gameday"] }),
      ]);
      setSaving(false);
      toast.success("League type updated");
      onSaved?.();
    },
    onError: (e, _next, ctx) => {
      if (ctx) setLocal(ctx as { leagueType: LeagueType; variant: LeagueVariant });
      setSaving(false);
      toast.error(e instanceof Error ? e.message : "Could not save that");
    },
  });

  const apply = (next: { leagueType: LeagueType; variant: LeagueVariant }) => {
    const previous = local;
    const variantOk = allowedVariants(next.leagueType).includes(next.variant);
    const resolved = variantOk ? next : { ...next, variant: "none" as LeagueVariant };
    setLocal(resolved);
    setSaving(true);
    mutation.mutate(resolved, { onError: () => setLocal(previous) });
  };

  const variantChoices = allowedVariants(local.leagueType);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="text-sm text-muted-foreground" htmlFor="league-type">
        League type
      </label>
      <select
        id="league-type"
        value={local.leagueType}
        onChange={(e) => apply({ leagueType: e.target.value as LeagueType, variant: local.variant })}
        className="rounded-lg border border-border bg-transparent px-3 py-1.5 text-sm"
      >
        {LEAGUE_TYPES.map((key) => (
          <option key={key} value={key}>
            {LEAGUE_TYPE_LABELS[key]}
          </option>
        ))}
      </select>
      <label className="text-sm text-muted-foreground" htmlFor="league-variant">
        Variant
      </label>
      <select
        id="league-variant"
        value={local.variant}
        onChange={(e) => apply({ leagueType: local.leagueType, variant: e.target.value as LeagueVariant })}
        className="rounded-lg border border-border bg-transparent px-3 py-1.5 text-sm"
      >
        {variantChoices.map((key) => (
          <option key={key} value={key}>
            {LEAGUE_VARIANT_LABELS[key]}
          </option>
        ))}
      </select>
      {saving && <span className="text-xs text-muted-foreground">Saving…</span>}
      {label && <span className="text-xs text-muted-foreground">{label}</span>}
    </div>
  );
}

/** Header badge, fed by the light meta query so it updates instantly. */
function LeagueTypeBadge({
  leagueId,
  leagueType,
  variant,
}: {
  leagueId: string;
  leagueType: LeagueType;
  variant: LeagueVariant;
}) {
  const meta = useLeagueMeta(leagueId);
  const type = meta.data?.leagueType ?? leagueType;
  const v = meta.data?.variant ?? variant;
  return (
    <Badge variant="secondary" className="text-[10px]">
      {LEAGUE_TYPE_LABELS[type]}
      {v !== "none" ? ` · ${LEAGUE_VARIANT_LABELS[v]}` : ""}
    </Badge>
  );
}

/** Asks the manager to confirm a type we worked out rather than were told. */
function LeagueTypePrompt({
  leagueId,
  leagueType,
  variant,
  sourceLabel,
}: {
  leagueId: string;
  leagueType: LeagueType;
  variant: LeagueVariant;
  sourceLabel: string;
}) {
  const [editing, setEditing] = useState(false);
  const save = useServerFn(updateLeagueSettings);
  const queryClient = useQueryClient();
  const confirm = useMutation({
    mutationFn: () => save({ data: { leagueId, leagueType, variant } as never }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["analysis", leagueId] });
      toast.success("Thanks — locked in");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save that"),
  });

  return (
    <div className="mt-6 space-y-3 rounded-xl bg-card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm">
          Looks like a {LEAGUE_TYPE_LABELS[leagueType].toLowerCase()}
          {variant !== "none" ? ` ${LEAGUE_VARIANT_LABELS[variant].toLowerCase()}` : ""} league —
          correct?
        </p>
        <Button size="sm" onClick={() => confirm.mutate()} disabled={confirm.isPending}>
          Yes
        </Button>
        <Button size="sm" variant="outline" onClick={() => setEditing((v) => !v)}>
          Change
        </Button>
      </div>
      {editing && (
        <LeagueTypeSelects
          leagueId={leagueId}
          leagueType={leagueType}
          variant={variant}
          sourceLabel={sourceLabel}
          onSaved={() => setEditing(false)}
        />
      )}
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
  leagueType,
  variant,
  typeSourceLabel,
}: {
  leagueId: string;
  contestFormat: ContestFormat;
  pointsPlayoff: { teams: number | null; afterWeek: number | null };
  weeklyHighBonus: boolean;
  weeklyHighLabel: string | null;
  leagueType: LeagueType;
  variant: LeagueVariant;
  typeSourceLabel: string;
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
      <LeagueTypeSelects
        leagueId={leagueId}
        leagueType={leagueType}
        variant={variant}
        sourceLabel={typeSourceLabel}
      />
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

      <PlayoffSettings leagueId={leagueId} />
    </div>
  );
}

/** Playoff weeks, field size, byes and all-play weeks. */
function PlayoffSettings({ leagueId }: { leagueId: string }) {
  const save = useServerFn(updateLeagueSettings);
  const queryClient = useQueryClient();
  const meta = useLeagueMeta(leagueId);
  const playoff = meta.data?.playoff;

  const mutation = useMutation({
    mutationFn: (patch: Record<string, unknown>) => save({ data: { leagueId, ...patch } as never }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["league-meta", leagueId] }),
        queryClient.invalidateQueries({ queryKey: ["analysis", leagueId] }),
      ]);
      toast.success("Playoff rules updated");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save that"),
  });

  if (!playoff) return null;
  const source = (playoff.source ?? {}) as Record<string, string | undefined>;
  const label = (key: string) =>
    source[key] === "user" ? "set by you" : source[key] === "detected" ? "detected" : "default";

  return (
    <div className="space-y-3 border-t border-border pt-4">
      <p className="text-sm text-muted-foreground">Playoffs</p>
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm text-muted-foreground" htmlFor="playoff-start">
          Starts week
        </label>
        <input
          id="playoff-start"
          type="number"
          min={1}
          max={18}
          defaultValue={playoff.weekStart ?? ""}
          disabled={mutation.isPending}
          onBlur={(e) =>
            mutation.mutate({ playoffWeekStart: e.target.value ? Number(e.target.value) : null })
          }
          className="w-20 rounded-lg border border-border bg-transparent px-3 py-1.5 text-sm"
        />
        <span className="text-xs text-muted-foreground">{label("playoff_week_start")}</span>

        <label className="text-sm text-muted-foreground" htmlFor="playoff-teams">
          Teams
        </label>
        <input
          id="playoff-teams"
          type="number"
          min={0}
          max={32}
          defaultValue={playoff.teams}
          disabled={mutation.isPending}
          onBlur={(e) => mutation.mutate({ playoffTeams: Number(e.target.value) || 0 })}
          className="w-20 rounded-lg border border-border bg-transparent px-3 py-1.5 text-sm"
        />
        <span className="text-xs text-muted-foreground">{label("playoff_teams")}</span>

        <label className="text-sm text-muted-foreground" htmlFor="playoff-byes">
          Byes
        </label>
        <input
          id="playoff-byes"
          type="number"
          min={0}
          max={8}
          defaultValue={playoff.byes}
          disabled={mutation.isPending}
          onBlur={(e) => mutation.mutate({ playoffByes: Number(e.target.value) || 0 })}
          className="w-20 rounded-lg border border-border bg-transparent px-3 py-1.5 text-sm"
        />
        <span className="text-xs text-muted-foreground">{label("playoff_byes")}</span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={playoff.thirdPlaceGame}
            disabled={mutation.isPending}
            onChange={(e) => mutation.mutate({ thirdPlaceGame: e.target.checked })}
          />
          Third-place game
        </label>
        <label className="text-sm text-muted-foreground" htmlFor="all-play-weeks">
          All-play weeks
        </label>
        <input
          id="all-play-weeks"
          placeholder="e.g. 6, 12"
          defaultValue={playoff.allPlayWeeks.join(", ")}
          disabled={mutation.isPending}
          onBlur={(e) =>
            mutation.mutate({
              allPlayWeeks: (e.target.value.match(/\d{1,2}/g) ?? [])
                .map(Number)
                .filter((w) => w >= 1 && w <= 18),
            })
          }
          className="w-32 rounded-lg border border-border bg-transparent px-3 py-1.5 text-sm"
        />
        <span className="text-xs text-muted-foreground">{label("all_play_weeks")}</span>
      </div>

      {(playoff.divisions.length > 0 ||
        playoff.waiverRunTimes.length > 0 ||
        playoff.consolation.length > 0) && (
        <p className="text-xs text-muted-foreground">
          {[
            playoff.divisions.length ? `${playoff.divisions.length} divisions` : null,
            playoff.waiverType === "faab"
              ? `FAAB${playoff.waiverRunTimes.length ? ` (${playoff.waiverRunTimes.join(", ")})` : ""}`
              : null,
            ...playoff.consolation.map((c) =>
              c.weeks.length ? `${c.label}, weeks ${c.weeks[0]}–${c.weeks[c.weeks.length - 1]}` : c.label,
            ),
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
      {playoff.rulesText && (
        <p className="text-xs text-muted-foreground">{playoff.rulesText}</p>
      )}
    </div>
  );
}

/** Whether this league's numbers bend for how tough each week's opponent is. */
function ScheduleStrengthToggle({
  leagueId,
  on,
  active,
}: {
  leagueId: string;
  on: boolean;
  active: boolean;
}) {
  const save = useServerFn(updateLeagueSettings);
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (sosAdjust: boolean) => save({ data: { leagueId, sosAdjust } }),
    onSuccess: (_r, next) => {
      queryClient.invalidateQueries({ queryKey: ["analysis", leagueId] });
      queryClient.invalidateQueries({ queryKey: ["gameday"] });
      toast.success(
        next ? "Numbers now allow for schedule strength" : "Schedule strength is shown only",
      );
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save that"),
  });

  return (
    <button
      type="button"
      disabled={mutation.isPending}
      onClick={() => mutation.mutate(!on)}
      title={
        on && !active
          ? "Schedule strength has not been worked out for this season yet"
          : "Adjust projections for how tough each week's opponent is"
      }
      className={`rounded-full border px-2 py-[2px] text-[10px] ${
        on
          ? "border-primary/40 text-primary"
          : "border-border text-muted-foreground"
      }`}
    >
      {on ? (active ? "Schedule adjusted" : "Schedule adjusted (no data yet)") : "Schedule: shown only"}
    </button>
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

/** Warns when our maths and the platform's scoreboard disagree. */
function ScoringGapBanner({ leagueId }: { leagueId: string }) {
  const fetchGap = useServerFn(getScoringGapFn);
  const { data } = useQuery({
    queryKey: ["scoring-gap", leagueId],
    queryFn: () => fetchGap({ data: { leagueId } }),
    staleTime: 10 * 60 * 1000,
  });
  if (!data?.banner) return null;
  return (
    <section className="mt-6 rounded-xl border border-destructive/40 bg-destructive/10 p-4">
      <p className="text-sm font-medium">{data.banner.text}</p>
      {data.banner.detail && (
        <p className="mt-1 text-sm text-muted-foreground">{data.banner.detail}</p>
      )}
    </section>
  );
}

/** Lets a manager tell the app to treat the team as a contender or a rebuild. */
function ClassOverride({
  leagueId,
  current,
  onSaved,
}: {
  leagueId: string;
  current: "contender" | "middle" | "rebuilder" | null;
  onSaved: () => void;
}) {
  const save = useServerFn(setTeamClassOverrideFn);
  const [saving, setSaving] = useState<string | null>(null);

  const pick = async (value: "contender" | "middle" | "rebuilder" | "auto") => {
    setSaving(value);
    try {
      await save({ data: { leagueId, teamClass: value } });
      toast.success(value === "auto" ? "Back to the standings" : "Saved");
      onSaved();
    } catch {
      toast.error("Could not save that");
    } finally {
      setSaving(null);
    }
  };

  const options = [
    { id: "auto" as const, label: "Auto" },
    { id: "contender" as const, label: "Win now" },
    { id: "middle" as const, label: "Middle" },
    { id: "rebuilder" as const, label: "Rebuild" },
  ];

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">Treat my team as</span>
      {options.map((o) => (
        <Button
          key={o.id}
          size="sm"
          variant={(current ?? "auto") === o.id ? "secondary" : "ghost"}
          disabled={saving !== null}
          onClick={() => pick(o.id)}
        >
          {o.label}
        </Button>
      ))}
    </div>
  );
}

/** Marks players the app must never trade away, or should shop first. */
function PlayerTags({ leagueId, names }: { leagueId: string; names: string[] }) {
  const list = useServerFn(listPlayerConstraintsFn);
  const setTag = useServerFn(setPlayerConstraintFn);
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["player-constraints", leagueId],
    queryFn: () => list({ data: { leagueId } }),
  });

  const tagOf = (name: string) =>
    data?.players.find((p) => normalizeName(p.name) === normalizeName(name))?.tag ?? null;

  const choose = async (name: string, tag: "untouchable" | "shopping") => {
    const next = tagOf(name) === tag ? "none" : tag;
    await setTag({ data: { leagueId, playerName: name, tag: next } });
    await queryClient.invalidateQueries({ queryKey: ["player-constraints", leagueId] });
  };

  if (!names.length) return null;

  return (
    <section className="mt-6 rounded-xl bg-card p-5">
      <h2 className="text-sm font-semibold">Trade tags</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Off limits players never appear in trade ideas. On the block players go first.
      </p>
      <ul className="mt-3 space-y-1">
        {names.map((name) => {
          const tag = tagOf(name);
          return (
            <li key={name} className="flex items-center justify-between gap-3 border-t border-border py-2">
              <span className="truncate text-sm">{name}</span>
              <span className="flex shrink-0 gap-1">
                <Button
                  size="sm"
                  variant={tag === "untouchable" ? "secondary" : "ghost"}
                  onClick={() => choose(name, "untouchable")}
                >
                  Off limits
                </Button>
                <Button
                  size="sm"
                  variant={tag === "shopping" ? "secondary" : "ghost"}
                  onClick={() => choose(name, "shopping")}
                >
                  On the block
                </Button>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
