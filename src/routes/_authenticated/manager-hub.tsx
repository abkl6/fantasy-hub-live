import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Activity, ArrowRight, BellRing, ChevronDown, ChevronUp, Repeat2, ShieldAlert, Sparkles, Trash2, Trophy, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { TeamBadge } from "@/components/TeamBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { deleteLeague, getManagerHubFn } from "@/lib/fantasy.functions";

export const Route = createFileRoute("/_authenticated/manager-hub")({
  head: () => ({
    meta: [
      { title: "Manager Hub — Gridiron Edge" },
      { name: "description", content: "Your highest-impact moves, roster risks and player exposure across every fantasy league." },
    ],
  }),
  component: ManagerHub,
});

const PLATFORM: Record<string, string> = { sleeper: "Sleeper", yahoo: "Yahoo", espn: "ESPN", nfl: "NFL.com", ffpc: "FFPC", manual: "Manual" };

function Percent({ value }: { value: number }) {
  return <span className="font-display font-bold tabular-nums">{(value * 100).toFixed(1)}%</span>;
}

type HubLeague = {
  id: string;
  name: string;
  platform: string;
  teamName: string;
  record: string;
  titleOdds: number;
  playoffOdds: number;
};

function LeagueCard({ league }: { league: HubLeague }) {
  const queryClient = useQueryClient();
  const runDelete = useServerFn(deleteLeague);
  const [confirming, setConfirming] = useState(false);
  const mutation = useMutation({
    mutationFn: () => runDelete({ data: { leagueId: league.id } }),
    onSuccess: () => {
      toast.success(`${league.name} deleted`);
      queryClient.invalidateQueries();
    },
    onError: (err) => {
      setConfirming(false);
      toast.error(err instanceof Error ? err.message : "Could not delete the league.");
    },
  });

  return (
    <article className="rounded-xl border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div><Badge variant="secondary">{PLATFORM[league.platform] ?? league.platform}</Badge><h3 className="mt-2 font-bold">{league.name}</h3><p className="text-xs text-muted-foreground">{league.teamName} · {league.record}</p></div>
        <div className="text-right text-xs"><p className="text-muted-foreground">Title</p><Percent value={league.titleOdds} /></div>
      </div>
      <div className="mt-4 flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">Playoffs <Percent value={league.playoffOdds} /></p>
        <div className="flex items-center gap-2">
          {confirming ? (
            <>
              <Button size="sm" variant="destructive" disabled={mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? "Deleting…" : "Confirm delete"}</Button>
              <Button size="sm" variant="ghost" disabled={mutation.isPending} onClick={() => setConfirming(false)}>Keep</Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setConfirming(true)} aria-label={`Delete ${league.name}`}><Trash2 className="size-4" /></Button>
              <Button asChild size="sm"><Link to="/league/$leagueId" params={{ leagueId: league.id }}>Manage</Link></Button>
            </>
          )}
        </div>
      </div>
    </article>
  );
}

type HubMove = {
  id: string;
  leagueId: string;
  leagueName: string;
  headline: string;
  detail: string;
  titleDelta: number;
  playoffDelta: number;
  giveValue?: number;
  getValue?: number;
  fairness?: "even" | "you-win" | "they-win";
  strategyLabel?: string;
  rationale?: string;
  dynastyDelta?: number;
  acceptance?: number;
  acceptanceBand?: string;
  partnerPointsDelta?: number;

};

function MoveRow({ move }: { move: HubMove }) {
  return (
    <div className="py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            {move.strategyLabel && <Badge variant="outline" className="uppercase">{move.strategyLabel}</Badge>}
            {move.dynastyDelta != null && move.dynastyDelta !== 0 && <Badge variant={move.dynastyDelta > 0 ? "default" : "secondary"}>{move.dynastyDelta > 0 ? "+" : ""}{move.dynastyDelta.toLocaleString()} future value</Badge>}
          </div>
          <p className="mt-1 text-sm font-semibold">{move.headline}</p>
          <p className="mt-1 text-xs text-muted-foreground">{move.detail}</p>
          {move.rationale && <p className="mt-1 text-xs text-muted-foreground">{move.rationale}</p>}
          {move.acceptanceBand && (
            <p className="mt-1 text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">
                {move.acceptanceBand}
                {move.acceptance != null ? ` (${Math.round(move.acceptance * 100)}%)` : ""} they accept
              </span>
              {move.partnerPointsDelta != null && (
                <> · their lineup {move.partnerPointsDelta >= 0 ? "+" : ""}{move.partnerPointsDelta.toFixed(1)} pts/week</>
              )}
            </p>
          )}
        </div>
        {(move.titleDelta > 0 || move.playoffDelta > 0) && <div className="flex shrink-0 flex-col items-end gap-1">{move.titleDelta > 0 && <Badge>+{(move.titleDelta * 100).toFixed(1)}% title</Badge>}{move.playoffDelta > 0 && <Badge variant="secondary">+{(move.playoffDelta * 100).toFixed(1)}% playoff</Badge>}</div>}
      </div>

      {move.bids && (
        <div className="mt-2 rounded-lg border border-border bg-muted/30 p-2">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-md border border-border px-2 py-1">Passive <span className="stat-num text-foreground">${move.bids.passive}</span></span>
            <span className="rounded-md bg-primary px-2 py-1 text-primary-foreground">Optimal <span className="stat-num">${move.bids.optimal}</span></span>
            <span className="rounded-md border border-border px-2 py-1">Aggressive <span className="stat-num text-foreground">${move.bids.aggressive}</span></span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{move.bids.reason}</p>
        </div>
      )}

      {move.giveValue != null && move.getValue != null && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="outline">You give {move.giveValue.toLocaleString()}</Badge>
          <Badge variant="outline">You get {move.getValue.toLocaleString()}</Badge>
          <Badge variant={move.fairness === "you-win" ? "default" : move.fairness === "they-win" ? "destructive" : "secondary"}>
            {move.fairness === "you-win" ? "Tilts your way" : move.fairness === "they-win" ? "Tilts their way" : "Fair both ways"}
          </Badge>
        </div>
      )}
      <Button asChild variant="link" size="sm" className="mt-1 h-auto p-0"><Link to="/league/$leagueId" params={{ leagueId: move.leagueId }}>{move.leagueName}<ArrowRight className="size-3" /></Link></Button>
    </div>
  );
}

type HubStandings = {
  leagueId: string;
  leagueName: string;
  platform: string;
  isDynasty: boolean;
  myTeamId: string | null;
  swing: number | null;
  swingFromWeek: number | null;
  teams: {
    id: string;
    name: string;
    isMine: boolean;
    record: string;
    titleOdds: number;
    playoffOdds: number;
    badge: import("@/lib/fantasy/team-class").TeamBadge;
    dynastyValue: number | null;
    dynastyRank: number | null;
  }[];
};

function StandingsRow({ team, index, isDynasty, bubble }: { team: HubStandings["teams"][number]; index: number; isDynasty: boolean; bubble: boolean }) {
  return (
    <tr className={`border-b border-border/60 last:border-0 ${team.isMine ? "bg-primary/10" : ""}`}>
      <td className="w-8 px-3 py-2 tabular-nums text-muted-foreground">{index + 1}</td>
      <td className="max-w-0 py-2 pr-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-medium">{team.name}</span>
          {team.isMine && <Badge className="shrink-0 text-[9px] uppercase">You</Badge>}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5">
          <TeamBadge badge={team.badge} />
          {bubble && <span className="shrink-0 text-[9px] uppercase text-muted-foreground">Bubble</span>}
        </div>
      </td>
      <td className="whitespace-nowrap py-2 pr-2 tabular-nums text-muted-foreground">{team.record}</td>
      <td className="whitespace-nowrap py-2 pr-2 text-right tabular-nums">{(team.titleOdds * 100).toFixed(1)}%</td>
      <td className="whitespace-nowrap py-2 pr-2 text-right tabular-nums">{(team.playoffOdds * 100).toFixed(0)}%</td>
      {isDynasty && (
        <td className="whitespace-nowrap py-2 pr-3 text-right tabular-nums">
          {team.dynastyValue === null ? "—" : <>{team.dynastyValue.toLocaleString()} <span className="text-muted-foreground">· {team.dynastyRank}{ordinal(team.dynastyRank)}</span></>}
        </td>
      )}
    </tr>
  );
}

function StandingsCard({ league }: { league: HubStandings }) {
  const [expanded, setExpanded] = useState(false);
  const myIndex = league.teams.findIndex((t) => t.isMine);
  const myTeam = myIndex >= 0 ? league.teams[myIndex] : undefined;
  const playoffCut = league.teams.filter((t) => t.playoffOdds >= 0.5).length;
  const bubbleOf = (team: HubStandings["teams"][number]) =>
    !team.isMine && team.playoffOdds > 0.05 && team.playoffOdds < 0.5 && playoffCut > 0 && Math.abs(team.playoffOdds - 0.5) <= 0.15;

  return (
    <div className="rounded-lg border">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Link to="/league/$leagueId" params={{ leagueId: league.leagueId }} className="truncate text-sm font-semibold transition-colors hover:text-primary">
            {league.leagueName}
          </Link>
          <Badge variant="secondary" className="shrink-0 text-[10px]">{PLATFORM[league.platform] ?? league.platform}</Badge>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {league.swing !== null && league.swingFromWeek !== null && (
            <Badge variant={league.swing >= 0 ? "default" : "destructive"}>
              {league.swing >= 0 ? "+" : ""}{(league.swing * 100).toFixed(1)}% title since wk {league.swingFromWeek}
            </Badge>
          )}
          <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => setExpanded((v) => !v)}>
            {expanded ? "Hide standings" : "Full standings"}
            {expanded ? <ChevronUp className="ml-1 size-3" /> : <ChevronDown className="ml-1 size-3" />}
          </Button>
        </div>
      </div>
      {myTeam && !expanded && (
        <button type="button" onClick={() => setExpanded(true)} className="flex w-full items-center gap-3 bg-primary/10 px-3 py-2.5 text-left text-xs transition-colors hover:bg-primary/15">
          <span className="w-6 shrink-0 font-display text-base font-bold tabular-nums">{myIndex + 1}<span className="text-[10px] text-muted-foreground">{ordinal(myIndex + 1)}</span></span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="truncate font-medium">{myTeam.name}</span>
              <Badge className="shrink-0 text-[9px] uppercase">You</Badge>
            </span>
            <span className="mt-0.5 block"><TeamBadge badge={myTeam.badge} /></span>
          </span>
          <span className="shrink-0 tabular-nums text-muted-foreground">{myTeam.record}</span>
          <span className="shrink-0 text-right tabular-nums">{(myTeam.titleOdds * 100).toFixed(1)}% <span className="text-muted-foreground">title</span></span>
          <span className="shrink-0 text-right tabular-nums">{(myTeam.playoffOdds * 100).toFixed(0)}% <span className="text-muted-foreground">playoffs</span></span>
          {league.isDynasty && (
            <span className="shrink-0 text-right tabular-nums">
              {myTeam.dynastyValue === null ? "—" : <>{myTeam.dynastyValue.toLocaleString()} <span className="text-muted-foreground">· {myTeam.dynastyRank}{ordinal(myTeam.dynastyRank)}</span></>}
            </span>
          )}
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      )}
      {expanded && (
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-left text-[10px] uppercase text-muted-foreground">
              <th className="px-3 py-1.5 font-medium">#</th>
              <th className="py-1.5 pr-2 font-medium">Team</th>
              <th className="py-1.5 pr-2 font-medium">Record</th>
              <th className="py-1.5 pr-2 text-right font-medium">Title</th>
              <th className="py-1.5 pr-2 text-right font-medium">Playoffs</th>
              {league.isDynasty && <th className="py-1.5 pr-3 text-right font-medium">Dynasty value</th>}
            </tr>
          </thead>
          <tbody>
            {league.teams.map((team, index) => (
              <StandingsRow key={team.id} team={team} index={index} isDynasty={league.isDynasty} bubble={bubbleOf(team)} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ordinal(rank: number | null) {
  if (!rank) return "";
  const mod10 = rank % 10;
  const mod100 = rank % 100;
  if (mod10 === 1 && mod100 !== 11) return "st";
  if (mod10 === 2 && mod100 !== 12) return "nd";
  if (mod10 === 3 && mod100 !== 13) return "rd";
  return "th";
}

function ManagerHub() {
  const fetchHub = useServerFn(getManagerHubFn);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["manager-hub"], queryFn: () => fetchHub() });
  const [standingsSort, setStandingsSort] = useState<"title" | "playoff" | "dynasty">("title");

  const sortedStandings = useMemo(() => {
    const rows = [...(data?.standings ?? [])];
    const mine = (league: (typeof rows)[number]) => league.teams.find((t) => t.isMine);
    return rows.sort((a, b) => {
      const value = (league: (typeof rows)[number]) => {
        const team = mine(league);
        if (standingsSort === "playoff") return team?.playoffOdds ?? -1;
        if (standingsSort === "dynasty") return team?.dynastyValue ?? -1;
        return team?.titleOdds ?? -1;
      };
      return value(b) - value(a);
    });
  }, [data, standingsSort]);

  const summary = useMemo(() => {
    const rows = data?.standings ?? [];
    const mineTeams = rows.map((league) => league.teams.find((t) => t.isMine)).filter((t) => !!t);
    return {
      bestTitle: mineTeams.length ? Math.max(...mineTeams.map((t) => t.titleOdds)) : null,
      playoffBound: mineTeams.filter((t) => t.playoffOdds >= 0.5).length,
      dynastyTotal: mineTeams.some((t) => t.dynastyValue !== null)
        ? mineTeams.reduce((sum, t) => sum + (t.dynastyValue ?? 0), 0)
        : null,
    };
  }, [data]);

  if (isLoading) return <main className="mx-auto max-w-6xl space-y-5 px-6 py-10"><Skeleton className="h-24 rounded-xl" /><Skeleton className="h-72 rounded-xl" /></main>;
  if (error || !data) return <main className="mx-auto max-w-6xl px-6 py-10"><p className="text-sm text-muted-foreground">{error instanceof Error ? error.message : "Manager Hub is unavailable."}</p><Button className="mt-4" onClick={() => refetch()}>Try again</Button></main>;

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="eyebrow text-primary">Cross-league command center</p><h1 className="mt-2 text-4xl font-bold uppercase">Manager Hub</h1><p className="mt-2 max-w-2xl text-sm text-muted-foreground">The moves and risks that matter most across every team you manage.</p></div>
        <Button asChild><Link to="/connect">Add a league</Link></Button>
      </div>

      {!data.leagues.length && <section className="mt-8 rounded-xl border border-dashed p-10 text-center"><h2 className="text-2xl font-bold uppercase">Build your hub</h2><p className="mt-2 text-sm text-muted-foreground">Add a league to see recommendations, alerts and exposure.</p><Button asChild className="mt-5"><Link to="/connect">Add your first league</Link></Button></section>}

      {!!data.leagues.length && <>
        <section className="mt-8 grid gap-4 sm:grid-cols-4">
          <div className="rounded-xl border bg-card p-5"><Users className="size-5 text-primary" /><p className="mt-3 text-3xl font-bold">{data.leagues.length}</p><p className="text-xs text-muted-foreground">Teams tracked</p></div>
          <div className="rounded-xl border bg-card p-5"><Repeat2 className="size-5 text-primary" /><p className="mt-3 text-3xl font-bold">{data.trades.length}</p><p className="text-xs text-muted-foreground">Trade ideas</p></div>
          <div className="rounded-xl border bg-card p-5"><Sparkles className="size-5 text-primary" /><p className="mt-3 text-3xl font-bold">{data.waivers.length}</p><p className="text-xs text-muted-foreground">Waiver targets</p></div>
          <div className="rounded-xl border bg-card p-5"><BellRing className="size-5 text-primary" /><p className="mt-3 text-3xl font-bold">{data.alerts.length}</p><p className="text-xs text-muted-foreground">Injury &amp; bye alerts</p></div>
        </section>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <section className="rounded-xl border bg-card p-5">
            <div className="flex items-center gap-2"><Repeat2 className="size-5 text-primary" /><h2 className="text-xl font-bold uppercase">Trade suggestions</h2></div>
            <p className="mt-1 text-xs text-muted-foreground">Swaps that turn surplus into a starting-lineup upgrade.</p>
            <div className="mt-3 divide-y divide-border">
              {!data.trades.length && <p className="py-4 text-sm text-muted-foreground">No trade currently improves a lineup enough to recommend.</p>}
              {data.trades.map((move) => <MoveRow key={`${move.leagueId}-${move.id}`} move={move} />)}
            </div>
          </section>

          <section className="rounded-xl border bg-card p-5">
            <div className="flex items-center gap-2"><Sparkles className="size-5 text-primary" /><h2 className="text-xl font-bold uppercase">Waiver wire</h2></div>
            <p className="mt-1 text-xs text-muted-foreground">Best available adds across every league, with the drop to make.</p>
            <div className="mt-3 divide-y divide-border">
              {!data.waivers.length && <p className="py-4 text-sm text-muted-foreground">Nobody on the wire beats your current roster.</p>}
              {data.waivers.map((move) => <MoveRow key={`${move.leagueId}-${move.id}`} move={move} />)}
            </div>
          </section>
        </div>

        <section className="mt-6 rounded-xl border bg-card p-5">
          <div className="flex items-center gap-2"><ShieldAlert className="size-5 text-primary" /><h2 className="text-xl font-bold uppercase">Injury updates</h2></div>
          <p className="mt-1 text-xs text-muted-foreground">Injuries, byes and news on players you actually roster.</p>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {!data.alerts.length && <p className="py-4 text-sm text-muted-foreground">No urgent injuries, byes or roster risks.</p>}
            {data.alerts.slice(0, 10).map((alert) => <Link key={`${alert.leagueId}-${alert.id}`} to="/league/$leagueId" params={{ leagueId: alert.leagueId }} className="flex items-start justify-between gap-3 rounded-lg border p-3">
              <div><p className="text-sm font-semibold">{alert.playerName} <span className="font-normal text-muted-foreground">· {alert.position}</span></p><p className="mt-1 text-xs text-muted-foreground">{alert.message} · {alert.leagueName}</p></div><Badge variant={alert.severity === "high" ? "destructive" : "outline"}>{alert.severity}</Badge>
            </Link>)}
          </div>
        </section>

        <section className="mt-6 rounded-xl border bg-card p-5">
          <div className="flex items-center gap-2"><Activity className="size-5 text-primary" /><h2 className="text-xl font-bold uppercase">Player exposure</h2></div>
          <p className="mt-1 text-xs text-muted-foreground">Your most repeated players and concentrated injury risk.</p>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {data.exposure.slice(0, 12).map((player) => <div key={`${player.name}-${player.position}`} className="flex items-center justify-between rounded-lg border p-3"><div><p className="text-sm font-semibold">{player.name} <span className="text-xs font-normal text-muted-foreground">{player.position}{player.nflTeam ? ` · ${player.nflTeam}` : ""}</span></p><p className="text-xs text-muted-foreground">{player.leagueNames.join(" · ")}</p></div><div className="text-right"><p className="font-display font-bold">{player.leagues}/{player.totalLeagues}</p><p className={`text-[10px] uppercase ${player.status === "Active" ? "text-muted-foreground" : "text-destructive"}`}>{player.status}</p></div></div>)}
          </div>
        </section>

        <section className="mt-6 rounded-xl border bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2"><Trophy className="size-5 text-primary" /><h2 className="text-xl font-bold uppercase">League standings</h2></div>
              <p className="mt-1 text-xs text-muted-foreground">Every league at a glance — your row is highlighted, with title, playoff and dynasty value for every team.</p>
            </div>
            <div className="flex gap-1">
              {([["title", "Title chance"], ["playoff", "Playoff chance"], ["dynasty", "Dynasty value"]] as const).map(([key, label]) => (
                <Button key={key} size="sm" variant={standingsSort === key ? "default" : "outline"} onClick={() => setStandingsSort(key)}>{label}</Button>
              ))}
            </div>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border p-3"><p className="text-[10px] uppercase text-muted-foreground">Best title chance</p><p className="mt-1 font-display text-lg font-bold tabular-nums">{summary.bestTitle === null ? "—" : `${(summary.bestTitle * 100).toFixed(1)}%`}</p></div>
            <div className="rounded-lg border p-3"><p className="text-[10px] uppercase text-muted-foreground">Playoff-bound leagues</p><p className="mt-1 font-display text-lg font-bold tabular-nums">{summary.playoffBound}/{data.standings.length}</p></div>
            <div className="rounded-lg border p-3"><p className="text-[10px] uppercase text-muted-foreground">Total dynasty value</p><p className="mt-1 font-display text-lg font-bold tabular-nums">{summary.dynastyTotal === null ? "—" : summary.dynastyTotal.toLocaleString()}</p></div>
          </div>

          <div className="mt-4 space-y-3">
            {sortedStandings.map((league) => <StandingsCard key={league.leagueId} league={league} />)}
          </div>
        </section>

        <section className="mt-6">
          <div className="flex items-center gap-2"><Trophy className="size-5 text-primary" /><h2 className="text-xl font-bold uppercase">League shortcuts</h2></div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {data.leagues.map((league) => <LeagueCard key={league.id} league={league} />)}
          </div>
        </section>
      </>}
    </main>
  );
}