import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Loader2, RefreshCw, Send, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { listStrategyRules, updateStrategyRule } from "@/lib/rules.functions";
import {
  adminResyncLeague,
  adminViewAsUser,
  amIAdmin,
  getAdminData,
  getAdminErrors,
  getAdminNotifications,
  getAdminOverview,
  applyCalibrationNow,
  getCalibration,
  getDataQuality,
  getSyncHealth,
  recomputeProjections,
  refreshImpliedTotals,
  runWeeklyResults,
  saveImpliedTotal,
  resolveUnmatchedPlayer,
  saveDefenseRank,
  saveScheduleRow,
  searchPlayersForMatch,
  sendTestNotification,
  setBatchPublished,
  uploadProjectionBatch,
} from "@/lib/admin.functions";
import { refreshScheduleStrength, uploadPriorStrength } from "@/lib/projections.functions";

const TITLE = "Admin — Gridiron Edge";
const DESCRIPTION = "Internal console for members, league sync health, the projection database, alerts and errors.";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminPage,
});

const when = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "never";

function Tile({ label, value, tone }: { label: string; value: string | number; tone?: "bad" | undefined }) {
  return (
    <div className="rounded-xl bg-card p-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={`font-display text-2xl font-bold tabular-nums ${tone === "bad" ? "text-destructive" : ""}`}>{value}</p>
    </div>
  );
}

function OverviewTab() {
  const load = useServerFn(getAdminOverview);
  const q = useQuery({ queryKey: ["admin", "overview"], queryFn: () => load() });
  if (q.isLoading) return <Loader2 className="size-4 animate-spin" aria-hidden="true" />;
  if (!q.data) return <p className="text-sm text-destructive">Could not load the overview.</p>;
  const d = q.data;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <Tile label="Members" value={d.users} />
        <Tile label="Active this week" value={d.activeThisWeek} />
        <Tile label="Leagues" value={d.leagues} />
        <Tile label="Alerts sent 24h" value={d.notifications24h} />
        <Tile label="Errors 24h" value={d.errors24h} tone={d.errors24h ? "bad" : undefined} />
      </div>
      <div className="rounded-xl border border-border bg-card">
        <p className="px-3 pt-3 text-sm font-semibold">Scheduled refresh health</p>
        <p className="px-3 pb-3 pt-1 text-xs text-muted-foreground">
          Last successful league read {when(d.lastSyncAt ?? null)} ·{" "}
          <span className={d.staleLeagues ? "text-destructive" : undefined}>
            {d.staleLeagues} league{d.staleLeagues === 1 ? "" : "s"} over a day old
          </span>{" "}
          ·{" "}
          <span className={d.rejectedRuns24h ? "text-destructive" : undefined}>
            {d.rejectedRuns24h} scheduled run{d.rejectedRuns24h === 1 ? "" : "s"} turned away in 24h
          </span>
        </p>
      </div>
      <div className="rounded-xl bg-card">
        <p className="px-3 pt-3 text-sm font-semibold">Leagues by platform</p>
        <div className="mt-2 divide-y divide-border">
          {d.platforms.map((p) => (
            <div key={p.platform} className="flex items-center justify-between px-3 py-2 text-sm">
              <span className="font-semibold capitalize">{p.platform}</span>
              <span className="text-xs text-muted-foreground">
                {p.leagues} league{p.leagues === 1 ? "" : "s"} · last sync {when(p.lastSync)}
                {p.failing ? ` · ${p.failing} failing` : ""}
              </span>
            </div>
          ))}
          {!d.platforms.length && <p className="px-3 py-3 text-sm text-muted-foreground">No leagues yet.</p>}
        </div>
      </div>
      <div className="rounded-xl bg-card">
        <p className="px-3 pt-3 text-sm font-semibold">Compute time by cached view</p>
        <div className="mt-2 divide-y divide-border">
          {(d.computeTimes ?? []).map((c) => (
            <div key={c.kind} className="flex items-center justify-between px-3 py-2 text-sm">
              <span className="font-semibold capitalize">{c.kind.replace("-", " ")}</span>
              <span className="text-xs text-muted-foreground">
                median {(c.medianMs / 1000).toFixed(2)}s · worst {(c.worstMs / 1000).toFixed(2)}s ·{" "}
                {c.runs} run{c.runs === 1 ? "" : "s"} · {c.fresh} still fresh
              </span>
            </div>
          ))}
          {!(d.computeTimes ?? []).length && (
            <p className="px-3 py-3 text-sm text-muted-foreground">Nothing computed yet.</p>
          )}
        </div>
      </div>
      {d.queue ? (
        <div className="rounded-xl border border-border bg-card">
          <p className="px-3 pt-3 text-sm font-semibold">Background work</p>
          <p className="px-3 pb-3 pt-1 text-xs text-muted-foreground">
            {d.queue.queued} waiting · {d.queue.running} running · {d.queue.failed} failed · last
            finished{" "}
            {d.queue.lastRunAt ? new Date(d.queue.lastRunAt).toLocaleString() : "never"}
          </p>
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">{d.newUsers7d} new member(s) in the last 7 days.</p>


    </div>
  );
}

function SyncTab() {
  const load = useServerFn(getSyncHealth);
  const resync = useServerFn(adminResyncLeague);
  const viewAs = useServerFn(adminViewAsUser);
  const qc = useQueryClient();
  const [viewing, setViewing] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["admin", "sync"], queryFn: () => load() });
  const viewQuery = useQuery({
    queryKey: ["admin", "view-as", viewing],
    queryFn: () => viewAs({ data: { userId: viewing! } }),
    enabled: !!viewing,
  });
  const run = useMutation({
    mutationFn: (leagueId: string) => resync({ data: { leagueId } }),
    onSuccess: (r) => {
      if (r.ok) toast.success("League re-synced");
      else toast.error(r.error ?? "Re-sync failed");
      qc.invalidateQueries({ queryKey: ["admin"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Re-sync failed"),
  });

  if (q.isLoading) return <Loader2 className="size-4 animate-spin" aria-hidden="true" />;

  return (
    <div className="space-y-3">
      <div className="divide-y divide-border overflow-hidden rounded-xl bg-card">
        {(q.data?.leagues ?? []).map((l) => (
          <div key={l.id} className="flex flex-wrap items-center gap-3 px-3 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-semibold">{l.name}</span>
                <Badge
                  variant={l.status === "error" ? "destructive" : l.status === "ok" ? "secondary" : "outline"}
                >
                  {l.status}
                </Badge>
              </div>
              <p className="truncate text-xs text-muted-foreground">
                {l.platform} · {l.ownerName} · week {l.week} · synced {when(l.lastSyncedAt)}
              </p>
              {l.error && <p className="truncate text-xs text-destructive">{l.error}</p>}
            </div>
            <Button size="sm" variant="secondary" disabled={run.isPending} onClick={() => run.mutate(l.id)}>
              <RefreshCw className={`size-4 ${run.isPending ? "animate-spin" : ""}`} aria-hidden="true" />
              Re-sync
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setViewing(l.userId)}>
              View as user
            </Button>
          </div>
        ))}
        {!(q.data?.leagues ?? []).length && <p className="px-3 py-3 text-sm text-muted-foreground">No leagues yet.</p>}
      </div>

      {viewing && (
        <div className="rounded-xl bg-card p-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">
              Viewing {viewQuery.data?.profile?.display_name ?? "member"} (read-only)
            </p>
            <Button size="sm" variant="ghost" onClick={() => setViewing(null)}>
              Close
            </Button>
          </div>
          <div className="mt-2 divide-y divide-border">
            {(viewQuery.data?.leagues ?? []).map((l) => (
              <div key={l.id} className="py-2 text-sm">
                <p className="font-semibold">{l.name}</p>
                <p className="text-xs text-muted-foreground">
                  {l.platform} · {l.teams} teams · my team {l.myTeam?.name ?? "not set"} · synced {when(l.last_synced_at)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function UnmatchedRow({ row, onDone }: { row: { id: string; raw_name: string; position: string | null }; onDone: () => void }) {
  const search = useServerFn(searchPlayersForMatch);
  const resolve = useServerFn(resolveUnmatchedPlayer);
  const [term, setTerm] = useState(row.raw_name);
  const [hits, setHits] = useState<{ id: string; full_name: string; position: string }[]>([]);

  return (
    <div className="px-3 py-3">
      <p className="text-sm font-semibold">
        {row.raw_name} <span className="text-xs font-normal text-muted-foreground">{row.position ?? ""}</span>
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Input value={term} onChange={(e) => setTerm(e.target.value)} className="h-8 max-w-xs" />
        <Button
          size="sm"
          variant="secondary"
          onClick={async () => {
            const r = await search({ data: { search: term } });
            setHits(r.players);
            if (!r.players.length) toast.info("No player matched that name");
          }}
        >
          Find
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={async () => {
            await resolve({ data: { id: row.id, dismiss: true } });
            onDone();
          }}
        >
          Dismiss
        </Button>
      </div>
      {hits.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {hits.map((p) => (
            <Button
              key={p.id}
              size="sm"
              variant="outline"
              onClick={async () => {
                await resolve({ data: { id: row.id, playerId: p.id } });
                toast.success(`Linked to ${p.full_name}`);
                onDone();
              }}
            >
              {p.full_name} · {p.position}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

function DataTab() {
  const load = useServerFn(getAdminData);
  const upload = useServerFn(uploadProjectionBatch);
  const publish = useServerFn(setBatchPublished);
  const recompute = useServerFn(recomputeProjections);
  const refreshStrength = useServerFn(refreshScheduleStrength);
  const uploadPrior = useServerFn(uploadPriorStrength);
  const saveSchedule = useServerFn(saveScheduleRow);
  const saveDefense = useServerFn(saveDefenseRank);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin", "data"], queryFn: () => load() });
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin", "data"] });

  const [label, setLabel] = useState("");
  const [source, setSource] = useState("baseline");
  const [week, setWeek] = useState("");
  const [published, setPublished] = useState(true);
  const [busy, setBusy] = useState(false);

  const [sched, setSched] = useState({ week: "", team: "", opponent: "" });
  const [def, setDef] = useState({ week: "", team: "", rank: "", points: "" });

  const season = q.data?.season ?? new Date().getUTCFullYear();

  const onFile = async (file: File) => {
    setBusy(true);
    try {
      const csv = await file.text();
      const r = await upload({
        data: {
          csv,
          label: label || file.name,
          source,
          season,
          week: week ? Number(week) : null,
          published,
        },
      });
      toast.success(`${r.matched} players updated · ${r.unmatched} unmatched`);
      setLabel("");
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  const onPriorFile = async (file: File) => {
    setBusy(true);
    try {
      const r = await uploadPrior({ data: { csv: await file.text(), season } });
      toast.success(
        `${r.rows} team ratings seeded from last season${r.skippedCount ? ` · ${r.skippedCount} rows skipped` : ""}`,
      );
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };


  return (
    <div className="space-y-4">
      <section className="rounded-xl bg-card p-3">
        <p className="text-sm font-semibold">Projection upload</p>
        <div className="mt-2 grid gap-2 md:grid-cols-4">
          <div>
            <Label className="text-xs">Label</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Week 3 baseline" className="h-8" />
          </div>
          <div>
            <Label className="text-xs">Source</Label>
            <Input value={source} onChange={(e) => setSource(e.target.value)} className="h-8" />
          </div>
          <div>
            <Label className="text-xs">Week (optional)</Label>
            <Input value={week} onChange={(e) => setWeek(e.target.value)} inputMode="numeric" className="h-8" />
          </div>
          <div className="flex items-end gap-2">
            <Switch id="pub" checked={published} onCheckedChange={setPublished} />
            <Label htmlFor="pub" className="text-xs">Publish on upload</Label>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <Button asChild size="sm" variant="secondary" disabled={busy}>
            <label>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" aria-hidden="true" />}
              Choose CSV
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onFile(f);
                  e.target.value = "";
                }}
              />
            </label>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              const r = await recompute();
              toast.success(`Re-applied ${r.batches} published upload(s) to ${r.players} rows`);
              refresh();
            }}
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            Recompute
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              try {
                const r = await refreshStrength({ data: {} });
                toast.success(`Schedule strength worked out — ${r.rows} team ratings saved`);
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Could not work that out");
              }
            }}
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            Schedule strength
          </Button>
          <Button asChild size="sm" variant="ghost" disabled={busy}>
            <label>
              <Upload className="size-4" aria-hidden="true" />
              Last season&apos;s points allowed
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onPriorFile(f);
                  e.target.value = "";
                }}
              />
            </label>
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Points allowed columns: nfl_team, position_group, points_allowed_per_game, games. This
          season&apos;s own results are blended in, fully from eight games on.
        </p>

        <div className="mt-3 divide-y divide-border">
          {(q.data?.batches ?? []).map((b) => (
            <div key={b.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{b.label}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {b.source} · {b.season}{b.week ? ` wk ${b.week}` : ""} · {b.matched_count}/{b.row_count} matched · {when(b.created_at)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{b.published ? "Published" : "Draft"}</span>
                <Switch
                  checked={b.published}
                  onCheckedChange={async (v) => {
                    await publish({ data: { batchId: b.id, published: v } });
                    refresh();
                  }}
                />
              </div>
            </div>
          ))}
          {!(q.data?.batches ?? []).length && <p className="py-2 text-sm text-muted-foreground">No uploads yet.</p>}
        </div>
      </section>

      <section className="rounded-xl bg-card">
        <div className="flex items-center gap-2 px-3 pt-3 text-sm font-semibold">
          Unmatched players <Badge variant="secondary">{(q.data?.queue ?? []).length}</Badge>
        </div>
        <div className="mt-1 divide-y divide-border">
          {(q.data?.queue ?? []).map((row) => (
            <UnmatchedRow key={row.id} row={row} onDone={refresh} />
          ))}
          {!(q.data?.queue ?? []).length && <p className="px-3 py-3 text-sm text-muted-foreground">Nothing waiting.</p>}
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl bg-card p-3">
          <p className="text-sm font-semibold">Schedule ({season})</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {(q.data?.scheduleWeeks ?? []).map((w) => `wk ${w.week}: ${w.teams}`).join(" · ") || "No schedule rows yet."}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Input placeholder="Week" value={sched.week} onChange={(e) => setSched({ ...sched, week: e.target.value })} className="h-8 w-20" />
            <Input placeholder="Team" value={sched.team} onChange={(e) => setSched({ ...sched, team: e.target.value })} className="h-8 w-24" />
            <Input placeholder="Opponent" value={sched.opponent} onChange={(e) => setSched({ ...sched, opponent: e.target.value })} className="h-8 w-24" />
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                try {
                  await saveSchedule({
                    data: {
                      season,
                      week: Number(sched.week),
                      nflTeam: sched.team,
                      opponent: sched.opponent || null,
                    },
                  });
                  toast.success("Schedule saved");
                  setSched({ week: "", team: "", opponent: "" });
                  refresh();
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Could not save that row");
                }
              }}
            >
              Save
            </Button>
          </div>
        </div>

        <div className="rounded-xl bg-card p-3">
          <p className="text-sm font-semibold">Defense ranks ({season})</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Input placeholder="Week" value={def.week} onChange={(e) => setDef({ ...def, week: e.target.value })} className="h-8 w-20" />
            <Input placeholder="Team" value={def.team} onChange={(e) => setDef({ ...def, team: e.target.value })} className="h-8 w-24" />
            <Input placeholder="Rank" value={def.rank} onChange={(e) => setDef({ ...def, rank: e.target.value })} className="h-8 w-20" />
            <Input placeholder="Pts allowed" value={def.points} onChange={(e) => setDef({ ...def, points: e.target.value })} className="h-8 w-28" />
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                try {
                  await saveDefense({
                    data: {
                      season,
                      week: Number(def.week || 0),
                      nflTeam: def.team,
                      rank: Number(def.rank),
                      pointsAllowed: Number(def.points || 0),
                    },
                  });
                  toast.success("Defense rank saved");
                  setDef({ week: "", team: "", rank: "", points: "" });
                  refresh();
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Could not save that rank");
                }
              }}
            >
              Save
            </Button>
          </div>
          <div className="mt-2 max-h-48 divide-y divide-border overflow-auto">
            {(q.data?.defense ?? []).map((d) => (
              <p key={d.id} className="py-1 text-xs text-muted-foreground">
                #{d.rank} {d.nfl_team} · wk {d.week} · {Number(d.points_allowed).toFixed(1)} allowed
              </p>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function NotificationsTab() {
  const load = useServerFn(getAdminNotifications);
  const test = useServerFn(sendTestNotification);
  const q = useQuery({ queryKey: ["admin", "notifications"], queryFn: () => load() });
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          variant="secondary"
          onClick={async () => {
            const r = await test({ data: {} });
            toast[r.sent ? "success" : "error"](
              r.sent ? "Test alert sent to your devices" : "No device is registered for alerts",
            );
          }}
        >
          <Send className="size-4" aria-hidden="true" />
          Send test to me
        </Button>
        <span className="text-xs text-muted-foreground">{q.data?.devices ?? 0} registered device(s)</span>
      </div>
      <div className="divide-y divide-border overflow-hidden rounded-xl bg-card">
        {(q.data?.log ?? []).map((row) => (
          <div key={row.id} className="px-3 py-2">
            <p className="text-sm font-semibold">{row.title}</p>
            <p className="truncate text-xs text-muted-foreground">
              {row.ownerName} · {row.kind} · {when(row.created_at)} — {row.body}
            </p>
          </div>
        ))}
        {!(q.data?.log ?? []).length && <p className="px-3 py-3 text-sm text-muted-foreground">Nothing sent yet.</p>}
      </div>
    </div>
  );
}

function ErrorsTab() {
  const load = useServerFn(getAdminErrors);
  const [platform, setPlatform] = useState("all");
  const q = useQuery({ queryKey: ["admin", "errors", platform], queryFn: () => load({ data: { platform } }) });
  const platforms = ["all", "sleeper", "yahoo", "espn", "nfl", "ffpc", "manual"];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {platforms.map((p) => (
          <Button key={p} size="sm" variant={p === platform ? "secondary" : "ghost"} onClick={() => setPlatform(p)}>
            {p}
          </Button>
        ))}
      </div>
      <div className="divide-y divide-border overflow-hidden rounded-xl bg-card">
        {(q.data?.leagueErrors ?? []).map((l) => (
          <div key={l.id} className="px-3 py-2">
            <p className="text-sm font-semibold">
              <AlertTriangle className="mr-1 inline size-4 text-destructive" aria-hidden="true" />
              {l.name} · {l.platform}
            </p>
            <p className="text-xs text-destructive">{l.last_sync_error}</p>
          </div>
        ))}
        {(q.data?.errors ?? []).map((e) => (
          <div key={e.id} className="px-3 py-2">
            <p className="text-sm font-semibold">
              {e.source} {e.platform ? `· ${e.platform}` : ""}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {when(e.created_at)} — {e.message}
            </p>
          </div>
        ))}
        {!(q.data?.errors ?? []).length && !(q.data?.leagueErrors ?? []).length && (
          <p className="px-3 py-3 text-sm text-muted-foreground">No failures recorded.</p>
        )}
      </div>
    </div>
  );
}

function AdminPage() {
  const check = useServerFn(amIAdmin);
  const navigate = useNavigate();
  const gate = useQuery({ queryKey: ["admin", "gate"], queryFn: () => check() });

  useEffect(() => {
    if (gate.data && !gate.data.admin) navigate({ to: "/manager-hub", replace: true });
  }, [gate.data, navigate]);

  if (gate.isLoading) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-6">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      </main>
    );
  }
  if (!gate.data?.admin) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-6">
        <p className="text-sm text-muted-foreground">This area is for admins only.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <h1 className="text-2xl font-bold">Admin</h1>
      <Tabs defaultValue="overview" className="mt-4">
        <TabsList className="flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="sync">Sync health</TabsTrigger>
          <TabsTrigger value="data">Data</TabsTrigger>
          <TabsTrigger value="quality">Data quality</TabsTrigger>
          <TabsTrigger value="accuracy">Accuracy</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="rules">Rules</TabsTrigger>
          <TabsTrigger value="errors">Errors</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="mt-4"><OverviewTab /></TabsContent>
        <TabsContent value="sync" className="mt-4"><SyncTab /></TabsContent>
        <TabsContent value="data" className="mt-4"><DataTab /></TabsContent>
        <TabsContent value="quality" className="mt-4"><QualityTab /></TabsContent>
        <TabsContent value="accuracy" className="mt-4"><AccuracyTab /></TabsContent>
        <TabsContent value="notifications" className="mt-4"><NotificationsTab /></TabsContent>
        <TabsContent value="rules" className="mt-4"><RulesTab /></TabsContent>
        <TabsContent value="errors" className="mt-4"><ErrorsTab /></TabsContent>
      </Tabs>
    </main>
  );
}

/** The strategy rules behind every recommendation: toggle, reweight, reword. */
function RulesTab() {
  const load = useServerFn(listStrategyRules);
  const save = useServerFn(updateStrategyRule);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin", "rules"], queryFn: () => load() });
  const mutation = useMutation({
    mutationFn: (input: {
      id: string;
      enabled?: boolean;
      weight?: number;
      rule?: string;
      rationale?: string;
    }) => save({ data: input }),
    onSuccess: () => {
      toast.success("Rule saved.");
      void qc.invalidateQueries({ queryKey: ["admin", "rules"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (q.isLoading) return <Loader2 className="size-4 animate-spin" aria-hidden="true" />;

  return (
    <div className="space-y-3">
      {(q.data?.rules ?? []).map((r) => (
        <div key={r.id} className="rounded-xl bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="eyebrow text-muted-foreground">{r.category}</p>
              <p className="text-sm font-semibold">{r.rule}</p>
              <p className="mt-1 text-xs text-muted-foreground">{r.rationale}</p>
            </div>
            <Switch
              checked={r.enabled}
              onCheckedChange={(enabled) => mutation.mutate({ id: r.id, enabled })}
              aria-label={`Enable ${r.rule}`}
            />
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Label htmlFor={`weight-${r.id}`} className="text-xs">
              Weight
            </Label>
            <Input
              id={`weight-${r.id}`}
              className="h-8 w-24"
              defaultValue={String(r.weight)}
              onBlur={(e) => {
                const weight = Number(e.target.value);
                if (Number.isFinite(weight) && weight !== r.weight) {
                  mutation.mutate({ id: r.id, weight });
                }
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/** How well the app's calls have matched what actually happened. */
function AccuracyTab() {
  const load = useServerFn(getCalibration);
  const apply = useServerFn(applyCalibrationNow);
  const qc = useQueryClient();
  const season = new Date().getUTCFullYear();
  const [week, setWeek] = useState("1");
  const q = useQuery({
    queryKey: ["admin", "accuracy", season],
    queryFn: () => load({ data: { season } }),
  });

  const run = useMutation({
    mutationFn: () => apply({ data: { season, week: Number(week) || 1 } }),
    onSuccess: (r) => {
      toast.success(r.changed ? r.reason : "Nothing needed changing.");
      qc.invalidateQueries({ queryKey: ["admin", "accuracy", season] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (q.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const data = q.data;
  if (!data) return <p className="text-sm text-muted-foreground">No accuracy data yet.</p>;

  return (
    <div className="space-y-6">
      <section className="rounded-xl bg-card p-4">
        <h3 className="text-sm font-semibold">Matchup calls by week</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Lower is better. {data.verdict.reason}
        </p>
        <div className="mt-3 flex flex-wrap gap-3">
          {data.brier.length === 0 && (
            <span className="text-xs text-muted-foreground">No graded weeks yet.</span>
          )}
          {data.brier.map((b) => (
            <div key={b.week} className="rounded-lg border border-border px-3 py-2">
              <p className="text-xs text-muted-foreground">Week {b.week}</p>
              <p className="stat-num text-lg">{b.brier.toFixed(3)}</p>
              <p className="text-[11px] text-muted-foreground">{b.samples} calls</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl bg-card p-4">
        <h3 className="text-sm font-semibold">Projection error by position</h3>
        <div className="mt-3 flex flex-wrap gap-3">
          {data.mae.length === 0 && (
            <span className="text-xs text-muted-foreground">No graded projections yet.</span>
          )}
          {data.mae.map((m) => (
            <div key={m.position} className="rounded-lg border border-border px-3 py-2">
              <p className="text-xs text-muted-foreground">{m.position}</p>
              <p className="stat-num text-lg">{m.mae.toFixed(2)}</p>
              <p className="text-[11px] text-muted-foreground">{m.samples} players</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl bg-card p-4">
        <h3 className="text-sm font-semibold">Self-correction</h3>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <div>
            <Label htmlFor="cal-week" className="text-xs">Week</Label>
            <Input
              id="cal-week"
              value={week}
              onChange={(e) => setWeek(e.target.value)}
              className="w-20"
            />
          </div>
          <Button onClick={() => run.mutate()} disabled={run.isPending}>
            Grade and adjust
          </Button>
        </div>
        <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
          {data.adjustments.map((a, i) => (
            <li key={`${a.week}-${a.position}-${i}`}>
              Week {a.week} · {a.position}: {a.previous.toFixed(2)} → {a.next.toFixed(2)} — {a.reason}
            </li>
          ))}
          {data.adjustments.length === 0 && <li>No adjustments made yet.</li>}
        </ul>
      </section>
    </div>
  );
}

/** Player identifier coverage, scoring gaps, and this week's Vegas totals. */
function QualityTab() {
  const load = useServerFn(getDataQuality);
  const pullOdds = useServerFn(refreshImpliedTotals);
  const saveOdds = useServerFn(saveImpliedTotal);
  const runWeek = useServerFn(runWeeklyResults);
  const qc = useQueryClient();
  const season = new Date().getUTCFullYear();
  const q = useQuery({
    queryKey: ["admin", "quality", season],
    queryFn: () => load({ data: { season } }),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin", "quality", season] });

  const [week, setWeek] = useState("1");
  const [team, setTeam] = useState("");
  const [implied, setImplied] = useState("");

  const odds = useMutation({
    mutationFn: () => pullOdds({ data: { season, weeks: [Number(week) || 1] } }),
    onSuccess: (r) => {
      toast.success(`Saved ${r.rows} team totals.`);
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const edit = useMutation({
    mutationFn: () =>
      saveOdds({
        data: { season, week: Number(week) || 1, nflTeam: team, implied: Number(implied) || 0 },
      }),
    onSuccess: () => {
      toast.success("Saved.");
      setTeam("");
      setImplied("");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const weekly = useMutation({
    mutationFn: () => runWeek({ data: { season, week: Number(week) || 1 } }),
    onSuccess: (r) =>
      toast.success(
        `${r.actuals} results stored, ${r.blended} players blended, ${r.reconciliation.flagged} scoring gaps.`,
      ),
    onError: (e: Error) => toast.error(e.message),
  });

  if (q.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const data = q.data;
  if (!data) return null;
  const pct = (n: number) => (data.players ? Math.round((n / data.players) * 100) : 0);

  return (
    <div className="space-y-6">
      <section className="rounded-xl bg-card p-5">
        <h2 className="font-semibold">Player IDs</h2>
        <p className="text-sm text-muted-foreground">
          {data.players} players. Imports match on these before falling back to names.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(
            [
              ["Sleeper", data.coverage.sleeper],
              ["ESPN", data.coverage.espn],
              ["Yahoo", data.coverage.yahoo],
              ["Market value", data.coverage.ktc],
            ] as const
          ).map(([label, count]) => (
            <div key={label} className="rounded-lg bg-muted/40 p-3">
              <p className="text-sm text-muted-foreground">{label}</p>
              <p className="stat-num text-xl">{pct(count)}%</p>
              <p className="text-xs text-muted-foreground">{count} matched</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl bg-card p-5">
        <h2 className="font-semibold">Rest-of-season blend</h2>
        <p className="text-sm text-muted-foreground">
          {data.blend.players} players blended, {data.blend.averageGames} games each on average.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div>
            <Label htmlFor="quality-week">Week</Label>
            <Input
              id="quality-week"
              value={week}
              onChange={(e) => setWeek(e.target.value)}
              className="w-24"
            />
          </div>
          <Button onClick={() => weekly.mutate()} disabled={weekly.isPending}>
            {weekly.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            Run week jobs
          </Button>
          <Button variant="outline" onClick={() => odds.mutate()} disabled={odds.isPending}>
            {odds.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            Pull Vegas totals
          </Button>
        </div>
      </section>

      <section className="rounded-xl bg-card p-5">
        <h2 className="font-semibold">Scoring gaps</h2>
        {data.gaps.length === 0 ? (
          <p className="text-sm text-muted-foreground">Every league adds up.</p>
        ) : (
          <ul className="mt-2 space-y-2 text-sm">
            {data.gaps.map((g) => (
              <li key={`${g.leagueId}-${g.week}`} className="rounded-lg bg-muted/40 p-3">
                <p className="font-medium">
                  {g.leagueName} — week {g.week}, {Math.round(g.diff * 10) / 10} pt gap
                </p>
                {g.topPlayerName && (
                  <p className="text-muted-foreground">
                    Biggest single difference: {g.topPlayerName} (
                    {Math.round(g.topPlayerDiff * 10) / 10} pts unscored)
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl bg-card p-5">
        <h2 className="font-semibold">Expected team points</h2>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <div>
            <Label htmlFor="quality-team">Team</Label>
            <Input
              id="quality-team"
              value={team}
              onChange={(e) => setTeam(e.target.value)}
              placeholder="MIA"
              className="w-24"
            />
          </div>
          <div>
            <Label htmlFor="quality-implied">Points</Label>
            <Input
              id="quality-implied"
              value={implied}
              onChange={(e) => setImplied(e.target.value)}
              placeholder="24.5"
              className="w-24"
            />
          </div>
          <Button variant="outline" onClick={() => edit.mutate()} disabled={!team || !implied}>
            Save
          </Button>
        </div>
        <ul className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          {data.implied.slice(0, 32).map((row) => (
            <li key={`${row.week}-${row.nfl_team}`} className="rounded-lg bg-muted/40 px-3 py-2">
              <span className="font-medium">{row.nfl_team}</span>{" "}
              <span className="stat-num">{Number(row.implied)}</span>{" "}
              <span className="text-xs text-muted-foreground">wk {row.week}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
