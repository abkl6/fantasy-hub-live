import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Activity, ArrowRight, BellRing, LineChart, Repeat2, ShieldAlert, Sparkles, Trash2, Trophy, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

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
};

function MoveRow({ move }: { move: HubMove }) {
  return (
    <div className="py-3">
      <div className="flex items-start justify-between gap-3">
        <div><p className="text-sm font-semibold">{move.headline}</p><p className="mt-1 text-xs text-muted-foreground">{move.detail}</p></div>
        {(move.titleDelta > 0 || move.playoffDelta > 0) && <div className="flex shrink-0 flex-col items-end gap-1">{move.titleDelta > 0 && <Badge>+{(move.titleDelta * 100).toFixed(1)}% title</Badge>}{move.playoffDelta > 0 && <Badge variant="secondary">+{(move.playoffDelta * 100).toFixed(1)}% playoff</Badge>}</div>}
      </div>
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

type OddsSeries = {
  leagueId: string;
  leagueName: string;
  teamName: string;
  points: { week: number; titleOdds: number; playoffOdds: number }[];
};

function OddsRow({ row }: { row: OddsSeries }) {
  const latest = row.points[row.points.length - 1];
  const first = row.points[0];
  if (!latest || !first) return null;
  const swing = latest.titleOdds - first.titleOdds;
  return (
    <div className="rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><p className="text-sm font-semibold">{row.leagueName}</p><p className="text-xs text-muted-foreground">{row.teamName} · week {latest.week}</p></div>
        <div className="flex items-center gap-4 text-right text-xs">
          <div><p className="text-muted-foreground">Title</p><Percent value={latest.titleOdds} /></div>
          <div><p className="text-muted-foreground">Playoffs</p><Percent value={latest.playoffOdds} /></div>
          {row.points.length > 1 && <Badge variant={swing >= 0 ? "default" : "destructive"}>{swing >= 0 ? "+" : ""}{(swing * 100).toFixed(1)}% since wk {first.week}</Badge>}
        </div>
      </div>
      <div className="mt-3 flex items-end gap-1" aria-hidden>
        {row.points.map((point) => (
          <div key={point.week} className="flex-1" title={`Week ${point.week}`}>
            <div className="flex h-16 items-end gap-[2px]">
              <div className="w-1/2 rounded-t bg-primary" style={{ height: `${Math.max(2, point.titleOdds * 100)}%` }} />
              <div className="w-1/2 rounded-t bg-muted-foreground/40" style={{ height: `${Math.max(2, point.playoffOdds * 100)}%` }} />
            </div>
            <p className="mt-1 text-center text-[10px] text-muted-foreground">{point.week}</p>
          </div>
        ))}
      </div>
      <p className="mt-1 text-[10px] uppercase text-muted-foreground">Solid = title odds · faded = playoff odds</p>
    </div>
  );
}

function ManagerHub() {
  const fetchHub = useServerFn(getManagerHubFn);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["manager-hub"], queryFn: () => fetchHub() });

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
          <div className="flex items-center gap-2"><LineChart className="size-5 text-primary" /><h2 className="text-xl font-bold uppercase">Weekly odds</h2></div>
          <p className="mt-1 text-xs text-muted-foreground">How your title and playoff chances have moved week to week.</p>
          <div className="mt-3 space-y-3">
            {data.weeklyOdds.map((row) => <OddsRow key={row.leagueId} row={row} />)}
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